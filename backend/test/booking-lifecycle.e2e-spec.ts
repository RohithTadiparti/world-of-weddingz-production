import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource, In } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/config/app-config.service';
import { BookingStatus, PaymentMilestone, PaymentStatus, ProviderType, UserRole } from '../src/common/enums';
import { Booking } from '../src/modules/bookings/entities/booking.entity';
import { Payment } from '../src/modules/bookings/entities/payment.entity';
import { Quotation } from '../src/modules/bookings/entities/quotation.entity';
import { QuotationEvent } from '../src/modules/bookings/entities/quotation-event.entity';
import { User } from '../src/modules/auth/entities/user.entity';
import { Vendor } from '../src/modules/vendors/entities/vendor.entity';
import { WeddingEvent } from '../src/modules/events/entities/event.entity';

/**
 * The booking lifecycle rows against PostgreSQL: contact hidden from the
 * vendor (WOW-06/15), the request's date matching its event (14), the
 * negotiation history (16), the requote state machine and positive add-ons
 * (17), chat opening on the advance and closing on completion (18/19), and an
 * open issue blocking delivery acceptance (21).
 */
describe('Booking lifecycle against PostgreSQL', () => {
  let app: INestApplication;
  let db: DataSource;
  let bride: User;
  let vendorUser: User;
  let vendor: Vendor;
  let brideToken: string;
  let vendorToken: string;
  const stamp = Date.now();

  const http = () => request(app.getHttpServer());

  async function booking(over: Partial<Booking>): Promise<Booking> {
    const repo = db.getRepository(Booking);
    return repo.save(
      repo.create({
        userId: bride.id,
        bookedByUserId: bride.id,
        providerType: ProviderType.VENDOR,
        providerId: vendor.id,
        status: BookingStatus.REQUESTED,
        amount: '0.00',
        currency: 'INR',
        eventDate: '2027-02-14',
        ...over,
      }),
    );
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(DataSource);

    const users = db.getRepository(User);
    bride = await users.save(
      users.create({
        email: `lifecycle-bride-${stamp}@example.com`,
        phone: `98${String(stamp).slice(-8)}`,
        passwordHash: 'fixture',
        role: UserRole.BRIDE,
        isActive: true,
        isVerified: true,
      }),
    );
    vendorUser = await users.save(
      users.create({
        email: `lifecycle-vendor-${stamp}@example.com`,
        passwordHash: 'fixture',
        role: UserRole.VENDOR,
        isActive: true,
        isVerified: true,
      }),
    );
    vendor = await db.getRepository(Vendor).save(
      db.getRepository(Vendor).create({
        ownerUserId: vendorUser.id,
        name: 'Lifecycle Photography',
        categories: [],
        isApproved: true,
      }),
    );
    const jwt = new JwtService({ secret: app.get(AppConfigService).auth.jwtSecret });
    brideToken = jwt.sign({ sub: bride.id, tv: 0 });
    vendorToken = jwt.sign({ sub: vendorUser.id, tv: 0 });
  }, 60000);

  afterAll(async () => {
    if (db && vendor) {
      const ids = (await db.getRepository(Booking).find({ where: { providerId: vendor.id } })).map((b) => b.id);
      if (ids.length) {
        await db.getRepository(QuotationEvent).delete({ bookingId: In(ids) });
        await db.getRepository(Quotation).delete({ bookingId: In(ids) });
        await db.getRepository(Payment).delete({ bookingId: In(ids) });
        await db.query(`DELETE FROM "support_cases" WHERE "subjectId" = ANY($1)`, [ids]).catch(() => undefined);
        await db.query(`DELETE FROM "messages" WHERE "conversationId" IN (SELECT id FROM "conversations" WHERE "bookingId" = ANY($1))`, [ids]).catch(() => undefined);
        await db.query(`DELETE FROM "conversations" WHERE "bookingId" = ANY($1)`, [ids]).catch(() => undefined);
        await db.getRepository(Booking).delete({ id: In(ids) });
      }
      await db.getRepository(WeddingEvent).delete({ userId: bride.id });
      await db.getRepository(Vendor).delete(vendor.id);
    }
    if (db && bride) await db.getRepository(User).delete([bride.id, vendorUser.id]);
    await app?.close();
  });

  it('hides the customer email and phone from the vendor booking list (WOW-06, row 15)', async () => {
    await booking({ expectedBudget: '15000.00' });
    const res = await http().get('/api/bookings/incoming').set('Authorization', `Bearer ${vendorToken}`).expect(200);
    const rows = res.body.data as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.clientEmail ?? null).toBeNull();
      expect(row.clientPhone ?? null).toBeNull();
      expect(JSON.stringify(row)).not.toContain(bride.email);
    }
  });

  it('refuses a request whose date does not match its event, and accepts one that does (row 14)', async () => {
    const events = db.getRepository(WeddingEvent);
    const event = await events.save(
      events.create({ userId: bride.id, name: 'Sangeet', eventDate: '2027-03-01' } as Partial<WeddingEvent>),
    );
    const refused = await http()
      .post('/api/bookings')
      .set('Authorization', `Bearer ${brideToken}`)
      .send({ providerType: 'vendor', providerId: vendor.id, eventId: event.id, eventDate: '2027-03-02' })
      .expect(400);
    expect(JSON.stringify(refused.body)).toContain('Sangeet is on 2027-03-01');

    const created = await http()
      .post('/api/bookings')
      .set('Authorization', `Bearer ${brideToken}`)
      .send({
        providerType: 'vendor',
        providerId: vendor.id,
        eventId: event.id,
        eventDate: '2027-03-01',
        requestedTime: '19:15',
      })
      .expect(201);
    expect(created.body).toMatchObject({ eventDate: '2027-03-01', requestedTime: '19:15', slotId: null });
  });

  it('runs listed 25,000 / budget 20,000 / counter 22,000 / requote through the state machine (rows 16, 17)', async () => {
    const created = await http()
      .post('/api/bookings')
      .set('Authorization', `Bearer ${brideToken}`)
      .send({ providerType: 'vendor', providerId: vendor.id, eventDate: '2027-04-10', expectedBudget: 20000 })
      .expect(201);
    const id = created.body.id as string;
    // The listed price the customer picked, as a catalogue request would carry it.
    await db.getRepository(Booking).update(id, { estimatedAmount: '25000.00' });
    await db.getRepository(QuotationEvent).save(
      db.getRepository(QuotationEvent).create({
        bookingId: id,
        kind: 'listed_price',
        amount: '25000.00',
        currency: 'INR',
        actorRole: 'provider',
        occurredAt: new Date(Date.now() - 60_000),
      }),
    );

    // Before any quotation, "Accept" agrees the budget, never the listing.
    await http()
      .put(`/api/bookings/${id}/accept`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ amount: 25000 })
      .expect(400);

    const quote = await http()
      .post(`/api/bookings/${id}/quotations`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ amount: 22000 })
      .expect(201);
    await http()
      .put(`/api/bookings/quotations/${quote.body.id}/reject`)
      .set('Authorization', `Bearer ${brideToken}`)
      .send({ note: 'Please requote' })
      .expect(200);

    // Requote requested: Accept is refused at any price; the row says so.
    const refused = await http()
      .put(`/api/bookings/${id}/accept`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ amount: 20000 })
      .expect(400);
    expect(JSON.stringify(refused.body)).toContain('asked for a requote');
    const incoming = await http().get('/api/bookings/incoming').set('Authorization', `Bearer ${vendorToken}`).expect(200);
    expect((incoming.body.data as Booking[]).find((b) => b.id === id)).toMatchObject({
      status: 'requested',
      requoteRequested: true,
      amount: '0.00',
    });

    // The requote goes through, and the customer accepts it.
    const requote = await http()
      .post(`/api/bookings/${id}/quotations`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ amount: 21000 })
      .expect(201);
    const accepted = await http()
      .put(`/api/bookings/quotations/${requote.body.id}/accept`)
      .set('Authorization', `Bearer ${brideToken}`)
      .send({})
      .expect(200);
    expect(accepted.body).toMatchObject({ amount: '21000.00', status: 'payment_pending' });

    const summary = await http().get(`/api/bookings/${id}/summary`).set('Authorization', `Bearer ${vendorToken}`).expect(200);
    const entries = summary.body.negotiation.entries as { kind: string; amount: string; status: string; at: string }[];
    expect(entries.map((e) => [e.kind, e.amount])).toEqual([
      ['listed_price', '25000.00'],
      ['budget', '20000.00'],
      ['quotation_sent', '22000.00'],
      ['quotation_rejected', '22000.00'],
      ['quotation_sent', '21000.00'],
      ['quotation_accepted', '21000.00'],
    ]);
    expect(entries.every((e) => Boolean(e.at))).toBe(true);
    expect(summary.body.negotiation.finalPrice).toMatchObject({ amount: '21000.00', source: 'quotation' });
  });

  it('opens chat for both sides after the advance and closes it on completion (rows 18, 19)', async () => {
    const b = await booking({ status: BookingStatus.PAYMENT_PENDING, amount: '30000.00', eventDate: '2027-05-01' });

    const before = await http().get(`/api/bookings/${b.id}/chat`).set('Authorization', `Bearer ${brideToken}`).expect(200);
    expect(before.body).toMatchObject({ canSend: false, open: false });

    await http()
      .put(`/api/bookings/${b.id}/pay`)
      .set('Authorization', `Bearer ${brideToken}`)
      .send({ milestone: 'advance', method: 'card' })
      .expect(200);

    for (const token of [brideToken, vendorToken]) {
      const state = await http().get(`/api/bookings/${b.id}/chat`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(state.body).toMatchObject({ canSend: true, open: true });
    }
    await http().post(`/api/bookings/${b.id}/messages`).set('Authorization', `Bearer ${brideToken}`).send({ body: 'Hello from the couple' }).expect(201);
    await http().post(`/api/bookings/${b.id}/messages`).set('Authorization', `Bearer ${vendorToken}`).send({ body: 'Hello from the vendor' }).expect(201);
    const thread = await http().get(`/api/bookings/${b.id}/messages`).set('Authorization', `Bearer ${brideToken}`).expect(200);
    expect((thread.body.data as { body: string }[]).map((m) => m.body).sort()).toEqual([
      'Hello from the couple',
      'Hello from the vendor',
    ]);

    // The advance leaving escrow (work started, payout owed) keeps it open.
    await db.getRepository(Payment).update(
      { bookingId: b.id, milestone: PaymentMilestone.ADVANCE },
      { status: PaymentStatus.PENDING_PAYOUT },
    );
    await db.getRepository(Booking).update(b.id, { status: BookingStatus.IN_PROGRESS });
    const midJob = await http().get(`/api/bookings/${b.id}/chat`).set('Authorization', `Bearer ${vendorToken}`).expect(200);
    expect(midJob.body.canSend).toBe(true);

    await db.getRepository(Booking).update(b.id, { status: BookingStatus.COMPLETED });
    for (const token of [brideToken, vendorToken]) {
      const state = await http().get(`/api/bookings/${b.id}/chat`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(state.body.canSend).toBe(false);
    }
    await http().post(`/api/bookings/${b.id}/messages`).set('Authorization', `Bearer ${brideToken}`).send({ body: 'late' }).expect(403);
  });

  it('refuses a zero add-on price (row 17)', async () => {
    const b = await booking({ status: BookingStatus.CONFIRMED, amount: '10000.00', eventDate: '2027-06-01' });
    await db.getRepository(Payment).save(
      db.getRepository(Payment).create({
        bookingId: b.id,
        userId: bride.id,
        amount: '3000.00',
        commissionAmount: '300.00',
        payoutAmount: '2700.00',
        currency: 'INR',
        status: PaymentStatus.HELD_IN_ESCROW,
        milestone: PaymentMilestone.ADVANCE,
        provider: 'mock',
        providerRef: `ref-${stamp}`,
      } as Partial<Payment>),
    );
    await http()
      .post(`/api/bookings/${b.id}/addons`)
      .set('Authorization', `Bearer ${brideToken}`)
      .send({ title: 'Drone coverage', proposedPrice: 0 })
      .expect(400);
    await http()
      .post(`/api/bookings/${b.id}/addons`)
      .set('Authorization', `Bearer ${brideToken}`)
      .send({ title: 'Drone coverage', proposedPrice: 5000 })
      .expect(201);
  });

  it('blocks accepting the delivery while an issue is open (row 21)', async () => {
    const b = await booking({
      status: BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
      amount: '10000.00',
      eventDate: '2027-07-01',
      deliveredAt: new Date(),
    });
    await http()
      .post('/api/verification/cases')
      .set('Authorization', `Bearer ${brideToken}`)
      .send({
        subjectType: 'booking',
        subjectId: b.id,
        title: 'Album missing pages',
        description: 'Half of the reception photographs were not delivered.',
      })
      .expect(201);
    const refused = await http()
      .put(`/api/bookings/${b.id}/confirm-delivery`)
      .set('Authorization', `Bearer ${brideToken}`)
      .send({})
      .expect(400);
    expect(JSON.stringify(refused.body)).toContain('open case');
  });
});
