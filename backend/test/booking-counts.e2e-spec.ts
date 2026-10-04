import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/config/app-config.service';
import { BookingStatus, ProviderType, UserRole } from '../src/common/enums';
import { Booking } from '../src/modules/bookings/entities/booking.entity';
import { User } from '../src/modules/auth/entities/user.entity';
import { Vendor } from '../src/modules/vendors/entities/vendor.entity';

describe('Booking count queries against PostgreSQL', () => {
  let app: INestApplication;
  let db: DataSource;
  let user: User;
  let vendor: Vendor;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get(DataSource);

    const users = db.getRepository(User);
    user = await users.save(users.create({
      email: `booking-count-${Date.now()}@example.com`,
      passwordHash: 'fixture',
      role: UserRole.VENDOR,
      isActive: true,
      isVerified: true,
    }));
    vendor = await db.getRepository(Vendor).save(db.getRepository(Vendor).create({
      ownerUserId: user.id,
      name: 'Booking Count Test',
      categories: [],
    }));

    const bookings = db.getRepository(Booking);
    await bookings.save(bookings.create({
      userId: user.id,
      bookedByUserId: user.id,
      providerType: ProviderType.VENDOR,
      providerId: vendor.id,
      status: BookingStatus.REQUESTED,
      eventDate: '2026-10-01',
      slotId: null,
    }));
  }, 60000);

  afterAll(async () => {
    if (db && vendor) await db.getRepository(Booking).delete({ providerId: vendor.id });
    if (db && vendor) await db.getRepository(Vendor).delete(vendor.id);
    if (db && user) await db.getRepository(User).delete(user.id);
    await app?.close();
  });

  it('counts request-on-date rows using a PostgreSQL enum-compatible predicate', async () => {
    const jwt = new JwtService({ secret: app.get(AppConfigService).auth.jwtSecret });
    const token = jwt.sign({ sub: user.id, tv: 0 });
    const response = await request(app.getHttpServer())
      .get('/api/bookings/incoming/counts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({ all: 1, requests: 1, request_on_date: 1 });
  });
});