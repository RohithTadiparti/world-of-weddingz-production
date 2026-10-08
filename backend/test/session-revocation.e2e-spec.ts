import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { AppConfigService } from '../src/config/app-config.service';
import { BookingStatus, ProviderType, UserRole } from '../src/common/enums';
import { User } from '../src/modules/auth/entities/user.entity';
import { RefreshSession } from '../src/modules/auth/entities/refresh-session.entity';
import { Booking } from '../src/modules/bookings/entities/booking.entity';

/**
 * Refresh-token reuse detection, suspension, erasure guard and the 429
 * envelope, against a real Postgres and Redis.
 */
describe('Sessions and account lifecycle (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  const created: string[] = [];
  const password = 'Password123';
  const http = () => request(app.getHttpServer());

  async function makeUser(role: UserRole): Promise<User> {
    const users = db.getRepository(User);
    const user = await users.save(
      users.create({
        email: `wow.e2e.sess.${randomUUID().slice(0, 8)}@gmail.com`,
        passwordHash: await bcrypt.hash(password, 4),
        role,
        isActive: true,
        isVerified: true,
      }),
    );
    created.push(user.id);
    return user;
  }

  /** A native-client login, so the refresh token comes back in the body. */
  async function login(user: User) {
    const res = await http()
      .post('/api/auth/login')
      .set('X-Client-Platform', 'android')
      .send({ email: user.email, password })
      .expect(200);
    return res.body as { accessToken: string; refreshToken: string };
  }

  const refresh = (token: string) =>
    http().post('/api/auth/refresh').set('X-Client-Platform', 'android').send({ refreshToken: token });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    db = app.get(DataSource);
  }, 60000);

  afterAll(async () => {
    if (db && created.length) {
      await db.getRepository(Booking).delete(created.map((id) => ({ userId: id })));
      await db.getRepository(RefreshSession).delete(created.map((id) => ({ userId: id })));
      await db.getRepository(User).delete(created);
    }
    await app?.close();
  });

  it('refuses a replayed refresh token without minting a session', async () => {
    const user = await makeUser(UserRole.BRIDE);
    const r0 = (await login(user)).refreshToken;

    const first = await refresh(r0).expect(200);
    const r1 = first.body.refreshToken as string;
    expect(r1).not.toBe(r0);

    // Moments later: refused as a lost race, nothing issued, login intact.
    const replay = await refresh(r0).expect(401);
    expect(replay.body.error.code).toBe('REFRESH_SUPERSEDED');
    expect(replay.body.accessToken).toBeUndefined();

    const second = await refresh(r1).expect(200);
    const r2 = second.body.refreshToken as string;

    // Past the grace window, a replay is theft: the whole family goes.
    await db
      .getRepository(RefreshSession)
      .update({ userId: user.id, revokedReason: 'rotated' }, { revokedAt: new Date(Date.now() - 60_000) });
    const theft = await refresh(r0).expect(401);
    expect(theft.body.error.code).toBeUndefined();
    await refresh(r2).expect(401);
  });

  it('ends the whole login on logout', async () => {
    const user = await makeUser(UserRole.GROOM);
    const r0 = (await login(user)).refreshToken;
    const r1 = (await refresh(r0).expect(200)).body.refreshToken as string;

    await http()
      .post('/api/auth/logout')
      .set('X-Client-Platform', 'android')
      .send({ refreshToken: r1 })
      .expect((res) => expect(res.status).toBeLessThan(300));

    await refresh(r1).expect(401);
  });

  it('needs a fresh sign-in after suspension and reactivation', async () => {
    const user = await makeUser(UserRole.BRIDE);
    const admin = await makeUser(UserRole.ADMIN);
    const tokens = await login(user);
    const adminToken = new JwtService({ secret: app.get(AppConfigService).auth.jwtSecret }).sign(
      { sub: admin.id, tv: 0, role: UserRole.ADMIN, email: admin.email, authMethod: 'zoho' },
      { expiresIn: '5m' },
    );
    const setActive = (isActive: boolean) =>
      http()
        .put(`/api/admin/users/${user.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive })
        .expect(200);

    await http().get('/api/auth/me').set('Authorization', `Bearer ${tokens.accessToken}`).expect(200);
    await setActive(false);
    await setActive(true);

    await http().get('/api/auth/me').set('Authorization', `Bearer ${tokens.accessToken}`).expect(401);
    await refresh(tokens.refreshToken).expect(401);
    await login(user);
  });

  it.each([BookingStatus.REQUESTED, BookingStatus.QUOTATION_SENT, BookingStatus.QUOTATION_ACCEPTED])(
    'refuses to erase an account with a %s booking',
    async (status) => {
      const user = await makeUser(UserRole.BRIDE);
      const bookings = db.getRepository(Booking);
      await bookings.save(
        bookings.create({
          userId: user.id,
          bookedByUserId: user.id,
          providerType: ProviderType.VENDOR,
          providerId: randomUUID(),
          status,
        }),
      );
      const { accessToken } = await login(user);

      const res = await http()
        .post('/api/users/me/erase')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ password })
        .expect(400);
      expect(res.body.error.message).toBe(
        'You have bookings still in progress. Settle or cancel them before deleting your account.',
      );
    },
  );

  it('answers 429 in the standard error envelope with Retry-After', async () => {
    // The capture endpoint allows 20 a minute; it 404s when capture is off,
    // which is irrelevant here — the throttle runs first.
    let last: request.Response | undefined;
    for (let i = 0; i < 25; i += 1) {
      last = await http().get('/api/test-deliveries/latest?channel=mail&destination=x@gmail.com');
      if (last.status === 429) break;
    }
    expect(last?.status).toBe(429);
    expect(last?.headers['retry-after']).toBeDefined();
    expect(last?.body.error).toEqual({
      message: 'Too many requests. Please wait a moment and try again.',
      error: 'Too Many Requests',
      statusCode: 429,
    });
  });
});
