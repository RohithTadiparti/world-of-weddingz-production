import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomInt, randomUUID } from 'crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { AppConfigService } from '../src/config/app-config.service';
import { UserRole } from '../src/common/enums';
import { User } from '../src/modules/auth/entities/user.entity';
import { AgentProfile } from '../src/modules/agents/entities/agent-profile.entity';

/**
 * Administrator lists against a real Postgres: contact details masked while
 * search still runs on the stored values (ISS-11), and rejected agencies kept
 * out of the pending queue and its badge (ISS-10).
 */
describe('Admin lists (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let adminToken: string;
  const created: string[] = [];
  const tag = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());
  const get = (url: string) => http().get(url).set('Authorization', `Bearer ${adminToken}`);

  async function makeUser(role: UserRole, extra: Partial<User> = {}): Promise<User> {
    const users = db.getRepository(User);
    const user = await users.save(
      users.create({
        email: `wow.e2e.lists.${tag}.${randomUUID().slice(0, 6)}@gmail.com`,
        passwordHash: await bcrypt.hash('Password123', 4),
        role,
        isActive: true,
        isVerified: true,
        ...extra,
      }),
    );
    created.push(user.id);
    return user;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    db = app.get(DataSource);

    const admin = await makeUser(UserRole.ADMIN);
    adminToken = new JwtService({ secret: app.get(AppConfigService).auth.jwtSecret }).sign(
      { sub: admin.id, tv: 0, role: UserRole.ADMIN, email: admin.email, authMethod: 'zoho' },
      { expiresIn: '5m' },
    );
  }, 60000);

  afterAll(async () => {
    if (db && created.length) {
      await db.getRepository(AgentProfile).delete(created.map((id) => ({ ownerUserId: id })));
      await db.getRepository(User).delete(created);
    }
    await app?.close();
  });

  it('finds an account by full or partial email or mobile, and returns it masked', async () => {
    const mobile = `9${String(randomInt(100_000_000, 999_999_999))}`;
    const person = await makeUser(UserRole.BRIDE, { phone: `+91 ${mobile}` });

    const email = String(person.email);
    for (const q of [email, email.slice(0, 22).toUpperCase(), mobile, mobile.slice(-6)]) {
      const res = await get('/api/admin/directory').query({ q }).expect(200);
      const row = res.body.data.find((r: { id: string }) => r.id === person.id);
      expect(row).toBeDefined();
      expect(row.email).toBe('w***@gmail.com');
      expect(row.phone).toBe(`********${mobile.slice(-4)}`);
      expect(JSON.stringify(res.body)).not.toContain(email);
      expect(JSON.stringify(res.body)).not.toContain(mobile);
    }

    // Wildcards in the search box are literal, not "match everything".
    const wild = await get('/api/admin/directory').query({ q: '%' }).expect(200);
    expect(wild.body.data.find((r: { id: string }) => r.id === person.id)).toBeUndefined();

    // The account detail masks too; the audited reveal has the whole value.
    const detail = await get(`/api/admin/accounts/${person.id}`).expect(200);
    expect(detail.body.user.email).toBe('w***@gmail.com');
    const revealed = await get(`/api/admin/accounts/${person.id}/contact`).expect(200);
    expect(revealed.body).toMatchObject({ id: person.id, email });
  });

  it('masks the users list and the officer roster, and searches the roster server-side', async () => {
    const officer = await makeUser(UserRole.IN_PERSON);

    const users = await get('/api/admin/users').query({ role: UserRole.IN_PERSON, limit: 100 }).expect(200);
    expect(JSON.stringify(users.body)).not.toContain(String(officer.email));

    const roster = await get('/api/admin/officers').query({ q: String(officer.email) }).expect(200);
    expect(roster.body.map((o: { id: string }) => o.id)).toEqual([officer.id]);
    expect(roster.body[0].email).toBe('w***@gmail.com');

    const none = await get('/api/admin/officers').query({ q: `nobody-${tag}` }).expect(200);
    expect(none.body).toEqual([]);
  });

  it('keeps rejected agencies out of the pending queue and its badge', async () => {
    const agencies = db.getRepository(AgentProfile);
    const waitingOwner = await makeUser(UserRole.AGENT);
    const rejectedOwner = await makeUser(UserRole.AGENT);
    const waiting = await agencies.save(
      agencies.create({
        ownerUserId: waitingOwner.id,
        agencyName: `Waiting ${tag}`,
        city: 'Hyderabad',
        contactPhone: '9876543210',
        isApproved: false,
      }),
    );
    const rejected = await agencies.save(
      agencies.create({
        ownerUserId: rejectedOwner.id,
        agencyName: `Rejected ${tag}`,
        city: 'Hyderabad',
        isApproved: false,
        rejectionReason: 'The registered address could not be found',
      }),
    );

    const pending = await get('/api/admin/agents/pending').expect(200);
    const pendingIds = pending.body.map((a: { id: string }) => a.id);
    expect(pendingIds).toContain(waiting.id);
    expect(pendingIds).not.toContain(rejected.id);
    expect(pending.body.find((a: { id: string }) => a.id === waiting.id).contactPhone).toBe(
      '******3210',
    );

    const refused = await get('/api/admin/agents/rejected').expect(200);
    const refusedRow = refused.body.find((a: { id: string }) => a.id === rejected.id);
    expect(refusedRow).toMatchObject({ rejectionReason: 'The registered address could not be found' });
    expect(refused.body.map((a: { id: string }) => a.id)).not.toContain(waiting.id);

    const counts = await get('/api/admin/pending-counts').expect(200);
    expect(counts.body.agents).toBe(pending.body.length);
  });
});
