import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource, In } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { AppConfigService } from '../src/config/app-config.service';
import { ApplicantType, BusinessStatus, UserRole, VerificationStatus } from '../src/common/enums';
import { User } from '../src/modules/auth/entities/user.entity';
import { Vendor } from '../src/modules/vendors/entities/vendor.entity';
import { VerificationRequest } from '../src/modules/verification/entities/verification-request.entity';
import { SupportCase } from '../src/modules/verification/entities/support-case.entity';
import { Notification } from '../src/modules/notifications/entities/notification.entity';
import { BusinessLifecycleService } from '../src/modules/vendors/business-lifecycle.service';
import { VerificationService } from '../src/modules/verification/verification.service';

/**
 * The vendor verification cycle and the support case flows against a real
 * Postgres (rows 11, 22, 23, 24, 25, 26, 27): status transitions, fresh
 * allocation after a resubmission, tracking notifications that never carry
 * findings, unread counts that reach zero, and the support actions for each
 * role.
 */
describe('Vendor verification and support flows (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  const tag = randomUUID().slice(0, 8);
  const users: User[] = [];
  const tokens = new Map<string, string>();
  let admin: User;
  let vendor: User;
  let officer1: User;
  let officer2: User;
  let business: Vendor;
  const http = () => request(app.getHttpServer());
  const as = (user: User) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${tokens.get(user.id)}`),
    put: (url: string, body: object = {}) =>
      http().put(url).set('Authorization', `Bearer ${tokens.get(user.id)}`).send(body),
    post: (url: string, body: object = {}) =>
      http().post(url).set('Authorization', `Bearer ${tokens.get(user.id)}`).send(body),
  });

  async function makeUser(role: UserRole): Promise<User> {
    const repo = db.getRepository(User);
    const user = await repo.save(
      repo.create({
        email: `wow.e2e.vq.${tag}.${randomUUID().slice(0, 6)}@gmail.com`,
        passwordHash: await bcrypt.hash('Password123', 4),
        role,
        isActive: true,
        isVerified: true,
      }),
    );
    users.push(user);
    const jwt = new JwtService({ secret: app.get(AppConfigService).auth.jwtSecret });
    tokens.set(user.id, jwt.sign({ sub: user.id, tv: 0, role, email: user.email, authMethod: 'zoho' }));
    return user;
  }

  const vendorNotes = () =>
    db.getRepository(Notification).find({ where: { userId: vendor.id }, order: { createdAt: 'ASC' } });
  const request_ = () =>
    db.getRepository(VerificationRequest).findOneOrFail({ where: { subjectId: business.id } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    db = app.get(DataSource);

    admin = await makeUser(UserRole.ADMIN);
    vendor = await makeUser(UserRole.VENDOR);
    officer1 = await makeUser(UserRole.IN_PERSON);
    officer2 = await makeUser(UserRole.IN_PERSON);

    // The catalog side of completion is another module's concern; the listing
    // here is complete apart from it, so the check is satisfied directly.
    const lifecycle = app.get(BusinessLifecycleService);
    const real = lifecycle.completion.bind(lifecycle);
    jest.spyOn(lifecycle, 'completion').mockImplementation(async (actor, id) => ({
      ...(await real(actor, id)),
      blocking: [],
      canSubmit: true,
    }));

    const vendors = db.getRepository(Vendor);
    business = await vendors.save(
      vendors.create({
        ownerUserId: vendor.id,
        name: `Kitchen ${tag}`,
        categories: ['catering'],
        category: 'catering',
        description: 'Caterers for weddings',
        city: 'Hyderabad',
        registeredAddress: '12 MG Road, Hyderabad',
        panNumber: 'ABCDE1234F',
        contactPhone: '9876543210',
        complianceDocuments: ['https://example.com/doc.pdf'],
        portfolio: ['https://example.com/p.jpg'],
        status: BusinessStatus.FIRST_REVIEW,
      }),
    );
  }, 90000);

  afterAll(async () => {
    if (db) {
      const ids = users.map((u) => u.id);
      await db.getRepository(Notification).delete({ userId: In(ids) });
      await db.getRepository(SupportCase).delete({ raisedByUserId: In(ids) });
      if (business) {
        await db.getRepository(VerificationRequest).delete({ subjectId: business.id });
        await db.getRepository(Vendor).delete(business.id);
      }
      await db.getRepository(User).delete({ id: In(ids) });
    }
    await app?.close();
  });

  it('runs a correction cycle with a fresh allocation and tracking notifications (rows 11, 23, 25)', async () => {
    await as(vendor).post(`/api/vendors/${business.id}/submit-verification`).expect(200);
    let req = await request_();
    expect(req.status).toBe(VerificationStatus.NEW);

    await as(admin).put(`/api/verification/requests/${req.id}/allocate`, { officerUserId: officer1.id }).expect(200);
    await as(officer1).put(`/api/verification/requests/${req.id}/start`).expect(200);
    await as(officer1)
      .put(`/api/verification/requests/${req.id}/findings`, {
        visited: true,
        observations: 'SECRET-OBSERVATION the GST certificate is for another firm',
        issues: ['SECRET-ISSUE GST mismatch'],
        recommendation: 'revisit',
      })
      .expect(200);

    // The vendor's feed tracks every step and carries none of the findings.
    const stages = (await vendorNotes())
      .filter((n) => n.type === 'verification_progress')
      .map((n) => n.payload.stage);
    expect(stages).toEqual(['submitted', 'officer_assigned', 'visit_started', 'findings_submitted']);
    const feed = await as(vendor).get('/api/notifications').expect(200);
    expect(JSON.stringify(feed.body)).not.toContain('SECRET');
    expect(JSON.stringify(feed.body)).not.toContain(officer1.id);
    const mine = await as(vendor).get('/api/verification/me').expect(200);
    expect(JSON.stringify(mine.body)).not.toContain('SECRET');

    await as(admin).put(`/api/verification/requests/${req.id}/review`).expect(200);
    await as(admin)
      .put(`/api/verification/requests/${req.id}/request-correction`, {
        fields: ['gstNumber'],
        reason: 'Upload the GST certificate in your own name',
      })
      .expect(200);
    req = await request_();
    expect(req.status).toBe(VerificationStatus.ADDITIONAL_REVIEW);
    expect(req.assignedToUserId).toBeNull();
    expect((await db.getRepository(Vendor).findOneByOrFail({ id: business.id })).status).toBe(
      BusinessStatus.REVERIFICATION_REQUIRED,
    );

    // Nobody can be sent before the vendor resubmits.
    await as(admin).put(`/api/verification/requests/${req.id}/allocate`, { officerUserId: officer2.id }).expect(400);
    // And the previous officer's queue no longer holds it.
    const queue = await as(officer1).get('/api/verification/requests').expect(200);
    expect(queue.body.data.map((r: { id: string }) => r.id)).not.toContain(req.id);

    await as(vendor).put(`/api/vendors/${business.id}`, { gstNumber: '36ABCDE1234F1Z5' }).expect(200);
    const resubmitted = await as(vendor).post(`/api/vendors/${business.id}/submit-verification`).expect(200);
    expect(resubmitted.body.status).toBe(BusinessStatus.PENDING_VERIFICATION);
    req = await request_();
    expect(req.status).toBe(VerificationStatus.NEW);
    expect(req.assignedToUserId).toBeNull();
    expect(req.previousOfficerUserId).toBe(officer1.id);
    const adminFeed = await db.getRepository(Notification).find({ where: { userId: admin.id, type: 'verification_requested' as never } });
    expect(adminFeed.some((n) => n.payload.resubmitted === true)).toBe(true);

    // Fresh allocation: a new officer visits, writes up, and the administrator decides.
    await as(admin).put(`/api/verification/requests/${req.id}/allocate`, { officerUserId: officer2.id }).expect(200);
    await as(officer2)
      .put(`/api/verification/requests/${req.id}/findings`, {
        visited: true,
        observations: 'Certificate matches',
        issues: [],
        recommendation: 'approve',
      })
      .expect(200);
    await as(admin).put(`/api/verification/requests/${req.id}/decide`, { status: VerificationStatus.APPROVED }).expect(200);
    expect((await db.getRepository(Vendor).findOneByOrFail({ id: business.id })).status).toBe(BusinessStatus.LIVE);
  });

  it('brings the unread count to zero when the vendor reads their notifications (row 22)', async () => {
    const before = await as(vendor).get('/api/notifications/unread-count').expect(200);
    expect(before.body.unread).toBeGreaterThan(0);
    const feed = (await as(vendor).get('/api/notifications').expect(200)).body as { id: string; targetId: string | null }[];
    const subject = feed.find((n) => n.targetId)!;
    const read = await as(vendor).put(`/api/notifications/targets/${subject.targetId}/read`).expect(200);
    expect(read.body.unread).toBeLessThan(before.body.unread);
    for (const n of feed.filter((x) => !x.targetId)) await as(vendor).put(`/api/notifications/${n.id}/read`).expect(200);
    expect((await as(vendor).get('/api/notifications/unread-count').expect(200)).body.unread).toBe(0);
    // Another account cannot read the vendor's rows.
    await as(officer1).put(`/api/notifications/targets/${subject.targetId}/read`).expect(200);
  });

  it('resolves a granted business change request and cancels another (rows 24 and 26)', async () => {
    const raise = (title: string) =>
      as(vendor)
        .post('/api/verification/cases', {
          subjectType: 'vendor',
          subjectId: business.id,
          category: 'business_change',
          requestedFields: ['registeredAddress'],
          title,
          description: 'We have moved to a new address.',
        })
        .expect(201);
    const first = (await raise('Change request one')).body;
    const second = (await raise('Change request two')).body;

    await as(vendor).put(`/api/verification/cases/${second.id}/cancel-business-change`, {}).expect(403);
    const cancelled = await as(admin)
      .put(`/api/verification/cases/${second.id}/cancel-business-change`, { reason: 'Duplicate request' })
      .expect(200);
    expect(cancelled.body.status).toBe('cancelled');

    const granted = await as(admin)
      .put(`/api/verification/cases/${first.id}/grant-business-edit-access`, { fields: ['registeredAddress'] })
      .expect(200);
    expect(granted.body.status).toBe('resolved');
    // Granted cannot be cancelled afterwards.
    await as(admin).put(`/api/verification/cases/${first.id}/cancel-business-change`, {}).expect(400);

    const vendorView = (await as(vendor).get('/api/verification/cases?scope=raised').expect(200)).body.data as SupportCase[];
    const statuses = Object.fromEntries(vendorView.map((c) => [c.id, c.status]));
    expect(statuses[first.id]).toBe('resolved');
    expect(statuses[second.id]).toBe('cancelled');
    const adminView = (await as(admin).get(`/api/verification/cases/${first.id}`).expect(200)).body;
    expect(adminView.status).toBe('resolved');

    const types = (await vendorNotes()).filter((n) => n.type === 'business_change_update').map((n) => n.payload.status);
    expect(types).toEqual(expect.arrayContaining(['cancelled', 'edit_access_granted']));
    const audit = await db.query(`SELECT action FROM audit_events WHERE "resourceId" = $1`, [second.id]);
    expect(audit.map((r: { action: string }) => r.action)).toContain('case.cancelled');
  });

  it('reopens a refused listing through a support case the officer works and the administrator approves (row 27)', async () => {
    // Refuse the listing through the verification queue.
    const vendors = db.getRepository(Vendor);
    await vendors.update(business.id, { status: BusinessStatus.VERIFICATION_IN_PROGRESS, correctionFields: null });
    const requests = db.getRepository(VerificationRequest);
    await requests.delete({ subjectId: business.id });
    const refused = await app.get(VerificationService).raise(ApplicantType.VENDOR, vendor.id, business.id, business.name);
    await requests.update(refused.id, {
      status: VerificationStatus.REJECTED,
      remarks: 'Premises not found',
      assignedToUserId: officer1.id,
    });
    await vendors.update(business.id, { status: BusinessStatus.REJECTED });

    const raised = await as(vendor)
      .post('/api/verification/cases', {
        subjectType: 'vendor',
        subjectId: business.id,
        title: 'My listing was rejected',
        description: 'The premises exist; please look again.',
      })
      .expect(201);
    const caseId = raised.body.id as string;

    await as(admin).put(`/api/verification/cases/${caseId}/allocate`, { officerUserId: officer2.id }).expect(200);
    const officerView = (await as(officer2).get(`/api/verification/cases/${caseId}`).expect(200)).body;
    expect(officerView.business).toEqual(
      expect.objectContaining({ id: business.id, registeredAddress: '12 MG Road, Hyderabad', status: 'rejected' }),
    );

    await as(officer2)
      .put(`/api/verification/cases/${caseId}/findings`, { findings: 'INTERNAL-FINDING premises verified by phone' })
      .expect(200);
    // An officer's proposal needs a note; without one it is refused with a reason.
    await as(officer2)
      .put(`/api/verification/cases/${caseId}/settle`, { outcome: 'no_action', action: 'unlock_listing' })
      .expect(400);
    await as(officer2)
      .put(`/api/verification/cases/${caseId}/settle`, {
        outcome: 'no_action',
        action: 'unlock_listing',
        notes: 'Correct the registered address and resubmit.',
      })
      .expect(200);

    // The vendor reads the status, never the officer's findings.
    const raiserView = (await as(vendor).get(`/api/verification/cases/${caseId}`).expect(200)).body;
    expect(JSON.stringify(raiserView)).not.toContain('INTERNAL-FINDING');
    expect(raiserView.status).toBe('resolution_submitted');

    const approved = await as(admin).put(`/api/verification/cases/${caseId}/review`, { decision: 'approve' }).expect(200);
    expect(approved.body.status).toBe('resolved');
    expect((await vendors.findOneByOrFail({ id: business.id })).status).toBe(BusinessStatus.REVERIFICATION_REQUIRED);
    expect((await requests.findOneByOrFail({ id: refused.id })).status).toBe(VerificationStatus.ADDITIONAL_REVIEW);

    // The vendor can now correct and resubmit, and it waits for a fresh allocation.
    await as(vendor).put(`/api/vendors/${business.id}`, { registeredAddress: '14 MG Road, Hyderabad' }).expect(200);
    await as(vendor).post(`/api/vendors/${business.id}/submit-verification`).expect(200);
    const back = await requests.findOneByOrFail({ id: refused.id });
    expect(back.status).toBe(VerificationStatus.NEW);
    expect(back.assignedToUserId).toBeNull();
  });

  it('lets the vendor reply on and close their own case', async () => {
    const raised = (
      await as(vendor)
        .post('/api/verification/cases', { subjectType: 'account', title: 'Cannot see payouts', description: 'The payouts page is empty.' })
        .expect(201)
    ).body;
    await as(admin).put(`/api/verification/cases/${raised.id}/allocate`, { officerUserId: officer1.id }).expect(200);
    await as(officer1)
      .put(`/api/verification/cases/${raised.id}/await-information`, { reason: 'Please send a screenshot of the page.' })
      .expect(200);
    await as(officer2).put(`/api/verification/cases/${raised.id}/reply`, { message: 'Not mine' }).expect(403);
    const replied = await as(vendor).put(`/api/verification/cases/${raised.id}/reply`, { message: 'Screenshot attached' }).expect(200);
    expect(replied.body.status).toBe('in_progress');
    const officerFeed = await db.getRepository(Notification).find({ where: { userId: officer1.id, type: 'dispute_update' as never } });
    expect(officerFeed.some((n) => n.targetId === raised.id)).toBe(true);
    const closed = await as(vendor).put(`/api/verification/cases/${raised.id}/close`).expect(200);
    expect(closed.body.status).toBe('closed');
    await as(vendor).put(`/api/verification/cases/${raised.id}/reply`, { message: 'Too late' }).expect(400);
  });
});
