import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { isValidAadhaar } from '../src/common/util/government-id';

/**
 * A valid Aadhaar number nobody has used yet.
 *
 * The check digit is found by asking the platform's own validator rather than
 * reimplementing Verhoeff in the fixture — a second copy of that table is a
 * second chance to get it wrong, in the one place a mistake would look like a
 * bug in the thing under test.
 *
 * One document, one profile is enforced by a unique index, so each call has to
 * produce a number no earlier call did.
 */
let aadhaarSeed = 0;

function freshAadhaar(): string {
  aadhaarSeed += 1;

  const body = `2${String(Date.now()).slice(-7)}${String(
    aadhaarSeed,
  ).padStart(3, '0')}`;

  for (let check = 0; check < 10; check += 1) {
    const candidate = `${body}${check}`;

    if (isValidAadhaar(candidate)) {
      return candidate;
    }
  }

  throw new Error(`no valid check digit for ${body}`);
}

/**
 * Generate unique 10-digit Indian-style mobile numbers for every E2E run.
 *
 * The backend enforces phone uniqueness. Fixed numbers such as
 * 9876543210 / 9876543211 caused the full suite to receive 409 after an
 * earlier successful E2E run had already created those users.
 */
const phoneSeed = Number(String(Date.now()).slice(-8));

function freshPhone(offset: number): string {
  const value = (phoneSeed + offset) % 100_000_000;

  return `98${String(value).padStart(8, '0')}`;
}

/**
 * Functional / integration (DFT) tests. These hit real HTTP endpoints against a
 * real Postgres + Redis, so run them with the test stack up:
 *
 *   docker compose -f docker/docker-compose.test.yml up -d
 *   npm run migration:run
 *   npm run test:e2e
 */
describe('WOW API (e2e)', () => {
  let app: INestApplication;

  /**
   * Use a value that is unique to this Jest process/run.
   *
   * Every account registers with a Gmail address (EZ1-I104) and its own mobile
   * number (EZ1-I258), so the fixtures carry both. That matters beyond the
   * happy path: a rejection test has to fail on the rule it is named after,
   * and with any other address every registration is refused for the Gmail
   * rule before the rule under test is reached.
   */
  const unique = `${Date.now()}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const mail = (tag: string) => `wow.e2e.${tag}.${unique}@gmail.com`;
  const solo = {
    email: mail('solo'),
    password: 'Password123',
    accountType: 'individual',
    role: 'bride',
    displayName: 'Solo Sharma',
    phone: freshPhone(1),
  };

  const groom = {
    email: mail('groom'),
    password: 'Password123',
    accountType: 'individual',
    role: 'groom',
    displayName: 'Groom Reddy',
    phone: freshPhone(2),
  };

  const agent = {
    email: mail('agent'),
    password: 'Password123',
    accountType: 'agent',
    displayName: 'Anita Rao',
    phone: freshPhone(3),
  };

  const vendor = {
    email: mail('vendor'),
    password: 'Password123',
    accountType: 'vendor',
    displayName: 'Vikram Nair',
    phone: freshPhone(4),
  };

  let soloToken: string;
  let groomToken: string;
  let agentToken: string;
  let vendorToken: string;
  let groomProfileId: string;
  let soloProfileId: string;

  const http = () => request(app.getHttpServer());

  /**
   * Intake records how the family gave permission, so every agency-built
   * profile carries one of these.
   */
  const consent = (allowsCirculation = false) => ({
    method: 'in_person',
    givenByRelation: 'father',
    givenByName: 'Ramesh Sharma',
    givenAt: '2026-08-01',
    allowsCirculation,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    app.setGlobalPrefix('api');

    app.use(cookieParser());

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers one account of each persona', async () => {
    /*
     * TEMPORARY DIAGNOSTIC:
     * Capture the actual response from registration before we change any
     * backend registration logic.
     */
    const r1 = await http()
      .post('/api/auth/register')
      .send(solo);

    console.log('REGISTER STATUS:', r1.status);
    console.log(
      'REGISTER BODY:',
      JSON.stringify(r1.body, null, 2),
    );

    expect(r1.status).toBe(201);

    soloToken = r1.body.accessToken;

    expect(soloToken).toBeDefined();
    expect(r1.body.user.role).toBe('bride');

    // A self-registered user is never tied to an agency.
    expect(r1.body.user.managedByAgentId).toBeNull();

    expect(r1.body.user.permissions).toContain('booking:create');

    // The refresh token is an httpOnly cookie now, not a field in the body.
    expect(r1.body.refreshToken).toBeUndefined();

    expect(String(r1.headers['set-cookie'])).toContain('HttpOnly');

    const r2 = await http()
      .post('/api/auth/register')
      .send(groom)
      .expect(201);

    groomToken = r2.body.accessToken;

    expect(groomToken).toBeDefined();

    const r3 = await http()
      .post('/api/auth/register')
      .send(agent)
      .expect(201);

    agentToken = r3.body.accessToken;

    expect(agentToken).toBeDefined();

    expect(r3.body.user.role).toBe('agent');

    expect(r3.body.user.permissions).toContain(
      'managed_profile:manage',
    );

    const r4 = await http()
      .post('/api/auth/register')
      .send(vendor)
      .expect(201);

    vendorToken = r4.body.accessToken;

    expect(vendorToken).toBeDefined();

    expect(r4.body.user.role).toBe('vendor');

    // A vendor must never be handed buy-side capabilities.
    expect(r4.body.user.permissions).not.toContain(
      'booking:create',
    );

    expect(r4.body.user.permissions).not.toContain(
      'match:browse',
    );
  });

  it('refuses a registration name with digits or symbols in it', async () => {
    await http()
      .post('/api/auth/register')
      .send({ ...solo, email: mail('digits'), displayName: 'E2E Solo' })
      .expect(400);

    await http()
      .post('/api/auth/register')
      .send({ ...solo, email: mail('symbols'), displayName: 'Priya <script>' })
      .expect(400);
  });

  it('insists every new account carries a mobile number', async () => {
    // Every portal but Admin signs in with the number (EZ1-I258), so an
    // account created without one would have a sign-in route it can never
    // use. Individuals included: they used to be allowed an email alone.
    const { phone: _soloPhone, ...soloWithoutPhone } = solo;
    const refused = await http()
      .post('/api/auth/register')
      .send({ ...soloWithoutPhone, email: mail('nophone.solo') })
      .expect(400);
    expect(JSON.stringify(refused.body)).toContain('mobile number');

    const { phone: _agentPhone, ...agentWithoutPhone } = agent;

    await http()
      .post('/api/auth/register')
      .send({ ...agentWithoutPhone, email: mail('nophone.agent') })
      .expect(400);

    const { phone: _vendorPhone, ...vendorWithoutPhone } = vendor;

    await http()
      .post('/api/auth/register')
      .send({ ...vendorWithoutPhone, email: mail('nophone.vendor') })
      .expect(400);
  });

  it('refuses a second account on the same mobile number', async () => {
    await http()
      .post('/api/auth/register')
      .send({ ...solo, email: mail('samephone') })
      .expect(409);
  });

  it('accepts registration with any valid email provider', async () => {
    const accepted = await http()
      .post('/api/auth/register')
      .send({ ...solo, email: `wow.e2e.${unique}@example.com`, phone: freshPhone(5) })
      .expect(201);
    expect(accepted.body.user.email).toBe(`wow.e2e.${unique}@example.com`);
  });

  it('lets a solo user sign in on their own, with no agent involved', async () => {
    const res = await http()
      .post('/api/auth/login')
      .send({
        email: solo.email,
        password: solo.password,
      })
      .expect(200);

    soloToken = res.body.accessToken;

    expect(res.body.user.managedByAgentId).toBeNull();
  });

  describe('native clients and the refresh token', () => {
    const login = () => ({
      email: solo.email,
      password: solo.password,
    });

    it('hands the token to a native client, and sets no cookie', async () => {
      const res = await http()
        .post('/api/auth/login')
        .set('X-Client-Platform', 'ios')
        .send(login())
        .expect(200);

      expect(typeof res.body.refreshToken).toBe('string');
      expect(res.body.refreshToken.length).toBeGreaterThan(0);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('keeps the cookie, and the silence, for a browser', async () => {
      const res = await http()
        .post('/api/auth/login')
        .set('Origin', 'http://localhost:8085')
        .send(login())
        .expect(200);

      expect(res.body.refreshToken).toBeUndefined();

      expect(String(res.headers['set-cookie'])).toContain(
        'HttpOnly',
      );
    });

    it('refuses a browser that claims to be an app', async () => {
      const res = await http()
        .post('/api/auth/login')
        .set('Origin', 'http://localhost:8085')
        .set('X-Client-Platform', 'ios')
        .send(login())
        .expect(200);

      expect(res.body.refreshToken).toBeUndefined();

      expect(String(res.headers['set-cookie'])).toContain(
        'HttpOnly',
      );
    });

    it('refreshes from the body, with no cookie anywhere in the exchange', async () => {
      const first = await http()
        .post('/api/auth/login')
        .set('X-Client-Platform', 'android')
        .send(login())
        .expect(200);

      const second = await http()
        .post('/api/auth/refresh')
        .set('X-Client-Platform', 'android')
        .send({
          refreshToken: first.body.refreshToken,
        })
        .expect(200);

      expect(typeof second.body.accessToken).toBe('string');

      expect(second.body.refreshToken).not.toBe(
        first.body.refreshToken,
      );

      expect(second.headers['set-cookie']).toBeUndefined();
    });
  });

  it('refuses to mint privileged roles through registration', async () => {
    await http()
      .post('/api/auth/register')
      .send({ ...solo, email: mail('esc1'), role: 'admin' })
      .expect(400);

    await http()
      .post('/api/auth/register')
      .send({ email: mail('esc2'), password: 'Password123', accountType: 'admin' })
      .expect(400);

    await http()
      .post('/api/auth/register')
      .send({ ...solo, email: mail('esc3'), role: 'vendor' })
      .expect(400);
  });

  it('rejects registration with a bad payload (validation)', async () => {
    await http()
      .post('/api/auth/register')
      .send({
        email: 'not-an-email',
        password: 'x',
      })
      .expect(400);

    await http()
      .post('/api/auth/register')
      .send({ ...solo, email: mail('extra'), isVerified: true })
      .expect(400);

    await http()
      .post('/api/auth/register')
      .send({ ...solo, email: mail('weak'), password: 'alllowercase' })
      .expect(400);
  });

  it('rejects protected routes without a token', async () => {
    await http()
      .get('/api/users/me')
      .expect(401);
  });

  it('creates profiles for both individuals', async () => {
    const solo = await http()
      .put('/api/users/me/profile')
      .set('Authorization', `Bearer ${soloToken}`)
      .send({
        displayName: 'Solo',
        gender: 'Female',
        dateOfBirth: '1996-01-01',
        city: 'Mumbai',
      })
      .expect(200);

    soloProfileId = solo.body.id;

    const res = await http()
      .put('/api/users/me/profile')
      .set('Authorization', `Bearer ${groomToken}`)
      .send({
        displayName: 'Groom',
        gender: 'Male',
        dateOfBirth: '1994-01-01',
        city: 'Mumbai',
      })
      .expect(200);

    groomProfileId = res.body.id;
  });

  describe('agent stewardship', () => {
    it('blocks an unvetted agency from building profiles', async () => {
      await http()
        .post('/api/agents/profiles')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          displayName: 'Blocked',
          contactPhone: '+919876500000',
          consent: consent(),
        })
        .expect(403);
    });

    it('allows missing contact details but keeps all intake behind agency vetting', async () => {
      await http()
        .put('/api/agents/agency')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          agencyName: `E2E Agency ${unique}`,
          city: 'Mumbai',
        })
        .expect(200);

      await http()
        .post('/api/agents/profiles')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          displayName: 'No phone',
          consent: consent(),
        })
        // Contact details are optional at intake (they are needed only to send
        // an invitation), so this passes validation and reaches the vetting
        // check instead: this agency is still unvetted.
        .expect(403);

      await http()
        .post('/api/agents/profiles')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          displayName: 'No consent',
          contactPhone: '+919876500009',
        })
        // The agency gate deliberately runs before field-level intake
        // validation so an unvetted account cannot probe the managed-profile
        // workflow or learn which payloads would otherwise be accepted.
        .expect(403);
    });

    it('keeps stewardship away from ordinary individuals and providers', async () => {
      await http()
        .post('/api/agents/profiles')
        .set('Authorization', `Bearer ${soloToken}`)
        .send({
          displayName: 'Nope',
          contactPhone: '+919876500001',
          consent: consent(),
        })
        .expect(403);

      await http()
        .post('/api/agents/profiles')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          displayName: 'Nope',
          contactPhone: '+919876500002',
          consent: consent(),
        })
        .expect(403);
    });

    it('requires an agent to name a profile before browsing matches', async () => {
      await http()
        .get('/api/matches/suggestions')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(400);
    });
  });

  const verifyIdentity = async (
    profileId: string,
    token: string,
  ) => {
    const started = await http()
      .post(
        `/api/profiles/${profileId}/identity/aadhaar/send-otp`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({
        aadhaarNumber: freshAadhaar(),
      })
      .expect(200);

    await http()
      .post(
        `/api/profiles/${profileId}/identity/aadhaar/verify-otp`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({
        sessionId: started.body.sessionId,
        code: started.body.devCode,
      })
      .expect(200);
  };

  /*
   * Identity verification no longer gates an interest (EZ1-I70): an in-person
   * check is not part of the individual flow, so sending, accepting and fixing
   * all proceed without one. What still closes the door is an incomplete
   * profile — a half-filled biodata wastes the time of everyone it reaches.
   */
  it('will not let an incomplete profile send an interest', async () => {
    const reg = await http()
      .post('/api/auth/register')
      .send({ ...solo, email: mail('incomplete'), phone: freshPhone(6), displayName: 'Meera Iyer' })
      .expect(201);
    const token = reg.body.accessToken;

    // No city: saved, but not complete.
    await http()
      .put('/api/users/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Meera', gender: 'Female', dateOfBirth: '1997-03-01' })
      .expect(200);

    const refused = await http()
      .post('/api/matches/interest')
      .set('Authorization', `Bearer ${token}`)
      .send({ toProfileId: groomProfileId })
      .expect(403);
    expect(JSON.stringify(refused.body)).toContain('Complete the profile');
  });

  it('runs the interest to accept flow between two individuals', async () => {
    await verifyIdentity(soloProfileId, soloToken);
    await verifyIdentity(groomProfileId, groomToken);

    const sent = await http()
      .post('/api/matches/interest')
      .set('Authorization', `Bearer ${soloToken}`)
      .send({
        toProfileId: groomProfileId,
      })
      .expect(201);

    await http()
      .put(`/api/matches/${sent.body.id}/accept`)
      .set('Authorization', `Bearer ${groomToken}`)
      .expect(200);
  });

  it('never returns an exact date of birth to another user', async () => {
    const res = await http()
      .get('/api/matches/suggestions')
      .set('Authorization', `Bearer ${soloToken}`)
      .expect(200);

    for (const item of res.body.data ?? []) {
      expect(item.profile.dateOfBirth).toBeUndefined();
      expect(item.profile).toHaveProperty('ageRange');
    }
  });

  it('keeps provider personas out of the buy side and matchmaking', async () => {
    await http()
      .get('/api/matches/suggestions')
      .set('Authorization', `Bearer ${vendorToken}`)
      .expect(403);

    await http()
      .post('/api/bookings')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        providerType: 'vendor',
        providerId: groomProfileId,
        amount: 100,
      })
      .expect(403);

    await http()
      .post('/api/vendors')
      .set('Authorization', `Bearer ${soloToken}`)
      .send({
        name: 'Not mine',
        category: 'venue',
      })
      .expect(403);
  });

  it('keeps the wedding marketplace to the couple', async () => {
    const loginResponse = await http()
      .post('/api/auth/login')
      .send({
        email: agent.email,
        password: agent.password,
      })
      .expect(200);

    expect(loginResponse.body.user.permissions).not.toContain(
      'booking:create',
    );

    await http()
      .post('/api/bookings')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        providerType: 'vendor',
        providerId: groomProfileId,
        amount: 100,
      })
      .expect(403);

    await http()
      .post('/api/bookings')
      .set('Authorization', `Bearer ${soloToken}`)
      .send({
        providerType: 'vendor',
        providerId: groomProfileId,
        amount: 100,
        onBehalfOfUserId: groomProfileId,
      })
      .expect(400);
  });

  it('leaves the couple their own albums and assistant', async () => {
    await http()
      .get('/api/media/albums')
      .set('Authorization', `Bearer ${vendorToken}`)
      .expect(403);

    await http()
      .post('/api/ai/budget-insight')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        totalBudget: 100000,
      })
      .expect(403);

    await http()
      .get('/api/media/albums')
      .set('Authorization', `Bearer ${soloToken}`)
      .expect(200);
  });

  it('closes the admin surface to every non-admin persona', async () => {
    for (const token of [
      soloToken,
      groomToken,
      agentToken,
      vendorToken,
    ]) {
      await http()
        .get('/api/admin/analytics')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      await http()
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      await http()
        .get('/api/admin/audit')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      await http()
        .get('/api/admin/agents/pending')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    }
  });

  describe('password recovery', () => {
    it('never reveals whether an address is registered', async () => {
      await http()
        .post('/api/auth/password/forgot')
        .send({ email: mail('nobody') })
        .expect(200);
    });

    it('refuses an invalid reset token', async () => {
      await http()
        .post('/api/auth/password/reset')
        .send({
          token: 'x'.repeat(32),
          password: 'Password123',
        })
        .expect(400);
    });
  });

  it('refuses an unsigned payment webhook', async () => {
    await http()
      .post('/api/payments/webhook')
      .send({
        id: 'evt_1',
        event: 'payment.captured',
      })
      .expect(400);
  });

  it('refuses an invalid invitation token', async () => {
    await http()
      .get(`/api/auth/invitations/${'x'.repeat(32)}`)
      .expect(404);
  });

  it('refuses an invalid biodata share link', async () => {
    await http()
      .get(`/api/circulation/biodata/${'x'.repeat(32)}`)
      .expect(404);
  });

  it('keeps the network pool to approved agents', async () => {
    await http()
      .get('/api/circulation/pool')
      .set('Authorization', `Bearer ${soloToken}`)
      .expect(403);

    await http()
      .get('/api/circulation/pool')
      .set('Authorization', `Bearer ${vendorToken}`)
      .expect(403);
  });

  it('exposes public search endpoints', async () => {
    await http()
      .get('/api/vendors/search')
      .expect(200);

    await http()
      .get('/api/wedding-planners/search')
      .expect(200);

    await http()
      .get('/api/auth/account-types')
      .expect(200);
  });

  it('enforces the configured pagination ceiling', async () => {
    await http()
      .get('/api/vendors/search?limit=100000')
      .expect(400);
  });

  it('serves health readiness', async () => {
    await http()
      .get('/api/health')
      .expect(200);
  });

  it('closes matchmaking once a match is fixed, accepting included', async () => {
    const board = await http()
      .get('/api/matches/interests')
      .set('Authorization', `Bearer ${soloToken}`)
      .expect(200);

    const accepted = board.body.accepted?.[0];

    expect(accepted).toBeDefined();

    for (const token of [soloToken, groomToken]) {
      await http()
        .put(`/api/matches/${accepted.id}/match-fixed`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(200);
    }

    const status = await http()
      .get('/api/matches/status')
      .set('Authorization', `Bearer ${soloToken}`)
      .expect(200);

    expect(status.body.matchFixedState).toBe('confirmed');

    await http()
      .post('/api/matches/interest')
      .set('Authorization', `Bearer ${soloToken}`)
      .send({
        toProfileId: groomProfileId,
      })
      .expect(403);

    const after = await http()
      .get('/api/matches/interests')
      .set('Authorization', `Bearer ${soloToken}`)
      .expect(200);

    for (const row of after.body.received ?? []) {
      expect(row.actions.accept).toBe(false);
      expect(row.actions.decline).toBe(true);
    }
  });
});
