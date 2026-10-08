import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Like } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { AppConfigService } from '../src/config/app-config.service';
import { UserRole } from '../src/common/enums';
import { User } from '../src/modules/auth/entities/user.entity';
import { AuditEvent } from '../src/platform/audit/entities/audit-event.entity';
import { CapacitySnapshot } from '../src/modules/operations/entities/capacity-snapshot.entity';
import { OperationalAlert } from '../src/modules/operations/entities/operational-alert.entity';
import { OPERATIONAL_ALERT_AUDIT_ACTIONS } from '../src/modules/operations/alerts/alert-delivery.types';
import {
  CAPACITY_METRIC_KEYS,
  CONFIGURED_ESTIMATE_SOURCE,
  CapacityMetric,
  METRIC_UNITS,
} from '../src/modules/operations/capacity/capacity.types';

// Named so secret scanners do not read a metric key literal as a credential.
const LATENCY_METRIC = 'p95LatencyMs' as const;

/**
 * The administrator Infrastructure API against a real Postgres (UI-001).
 *
 * The suite owns the capacity_snapshots table for its duration (throwaway CI
 * database): it needs to control which snapshot is "latest".
 */
describe('Admin operations dashboard (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let adminToken: string;
  let adminId: string;
  let brideToken: string;
  const users: string[] = [];
  const tag = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${token}`),
  });

  async function makeUser(role: UserRole): Promise<User> {
    const repo = db.getRepository(User);
    const user = await repo.save(
      repo.create({
        email: `wow.e2e.ops.${tag}.${randomUUID().slice(0, 6)}@gmail.com`,
        passwordHash: await bcrypt.hash('Password123', 4),
        role,
        isActive: true,
        isVerified: true,
      }),
    );
    users.push(user.id);
    return user;
  }

  const sign = (user: User) =>
    new JwtService({ secret: app.get(AppConfigService).auth.jwtSecret }).sign(
      { sub: user.id, tv: 0, role: user.role, email: user.email, authMethod: 'zoho' },
      { expiresIn: '5m' },
    );

  const metrics = (): CapacityMetric[] =>
    CAPACITY_METRIC_KEYS.map((key, index) => ({
      key,
      value: key === 'databaseGigabytes' ? 0.0123456789 : key === 'railwayMonthlyInr' ? 0 : index * 1.5,
      unit: METRIC_UNITS[key],
      // As the collector writes it by default: the 0 configured placeholder.
      source: key === 'railwayMonthlyInr' ? CONFIGURED_ESTIMATE_SOURCE : `e2e ${key}`,
      ...(key === LATENCY_METRIC ? { windowMinutes: 15 } : {}),
    }));

  const hourFloor = (offsetHours: number) => {
    const at = new Date(Date.now() + offsetHours * 3_600_000);
    at.setUTCMinutes(0, 0, 0);
    return at;
  };

  async function alertRow(overrides: Partial<OperationalAlert>): Promise<OperationalAlert> {
    const repo = db.getRepository(OperationalAlert);
    return repo.save(
      repo.create({
        fingerprint: `e2e:${tag}:${randomUUID().slice(0, 8)}`,
        metric: 'accounts',
        severity: 'warning',
        status: 'open',
        observedValue: 5001,
        thresholdValue: 5000,
        unit: 'count',
        source: 'e2e',
        firstObservedAt: new Date('2026-10-09T08:00:00Z'),
        lastObservedAt: new Date('2026-10-09T09:00:00Z'),
        deliveryMetadata: {},
        ...overrides,
      }),
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    db = app.get(DataSource);

    const admin = await makeUser(UserRole.ADMIN);
    adminId = admin.id;
    adminToken = sign(admin);
    brideToken = sign(await makeUser(UserRole.BRIDE));
  }, 60000);

  afterAll(async () => {
    if (db) {
      await db.getRepository(OperationalAlert).delete({ fingerprint: Like(`e2e:${tag}:%`) });
      await db.getRepository(CapacitySnapshot).clear();
      if (users.length) await db.getRepository(User).delete(users);
    }
    await app?.close();
  });

  const routes = [
    ['get', '/api/admin/operations/status'],
    ['get', '/api/admin/operations/alerts'],
    ['get', '/api/admin/operations/migration-readiness'],
    ['post', `/api/admin/operations/alerts/${randomUUID()}/acknowledge`],
  ] as const;

  it('refuses non-administrators and anonymous callers', async () => {
    for (const [method, url] of routes) {
      await as(brideToken)[method](url).expect(403);
      await http()[method](url).expect(401);
    }
  });

  it('reports every metric unknown when there is no snapshot', async () => {
    await db.getRepository(CapacitySnapshot).clear();
    const res = await as(adminToken).get('/api/admin/operations/status').expect(200);
    expect(res.body.snapshot).toBeNull();
    expect(res.body.overallStatus).toBe('unknown');
    expect(res.body.metrics).toHaveLength(CAPACITY_METRIC_KEYS.length);
    for (const metric of res.body.metrics) {
      expect(metric).toMatchObject({ value: null, freshness: 'missing', status: 'unknown' });
    }
  });

  it('reports a stale snapshot as unknown, never ok', async () => {
    const snapshots = db.getRepository(CapacitySnapshot);
    await snapshots.clear();
    await snapshots.save(snapshots.create({ periodStart: hourFloor(-3), metrics: metrics() }));
    const res = await as(adminToken).get('/api/admin/operations/status').expect(200);
    expect(res.body.snapshot.freshness).toBe('stale');
    expect(res.body.overallStatus).toBe('unknown');
    for (const metric of res.body.metrics) {
      expect(metric).toMatchObject({ freshness: 'stale', status: 'unknown', statusReason: 'stale_snapshot' });
    }
  });

  it('returns the latest persisted values and units unchanged', async () => {
    const snapshots = db.getRepository(CapacitySnapshot);
    const saved = await snapshots.save(snapshots.create({ periodStart: hourFloor(0), metrics: metrics() }));
    const res = await as(adminToken).get('/api/admin/operations/status').expect(200);

    expect(res.body.snapshot).toMatchObject({ id: saved.id, freshness: 'fresh' });
    const expected = metrics();
    for (const metric of res.body.metrics) {
      const original = expected.find((m) => m.key === metric.key)!;
      expect(metric.value).toBe(original.value);
      expect(metric.unit).toBe(original.unit);
      expect(metric.source).toBe(original.source);
      expect(metric.periodStart).toBe(saved.periodStart.toISOString());
      expect(metric.freshness).toBe('fresh');
      expect(metric.thresholds.unit).toBe(METRIC_UNITS[metric.key as keyof typeof METRIC_UNITS]);
      if (metric.key === 'railwayMonthlyInr') {
        expect(metric).toMatchObject({ status: 'unknown', statusReason: 'not_measured', estimate: false });
      } else {
        expect(['ok', 'warning', 'critical']).toContain(metric.status);
      }
    }
    // The unmeasured cost placeholder keeps the page from reading ok.
    expect(res.body.overallStatus).not.toBe('ok');
  });

  it('orders alerts critical first then most recent, and redacts delivery metadata', async () => {
    const canaryEmail = `canary.${tag}@leak.example`;
    const canaryBearer = `tok_canary_${tag}`;
    const olderCritical = await alertRow({
      severity: 'critical',
      lastObservedAt: new Date('2026-10-09T07:00:00Z'),
      deliveryMetadata: {
        version: 1,
        notifiedSeverity: 'critical',
        lastReminderAt: null,
        recipients: [canaryEmail],
        apiKey: canaryBearer,
        lastAttempt: {
          event: 'opened',
          at: '2026-10-09T07:00:01.000Z',
          correlationId: 'e2e-correlation',
          severity: 'critical',
          portal: { status: 'delivered', at: '2026-10-09T07:00:01.000Z', recipients: 1, error: null },
          email: { status: 'simulated', at: '2026-10-09T07:00:02.000Z', recipients: 1, provider: canaryEmail, error: canaryBearer },
          audit: { status: 'recorded', at: '2026-10-09T07:00:02.000Z', error: null },
        },
        history: [],
      },
    });
    const newerWarning = await alertRow({ severity: 'warning', lastObservedAt: new Date('2026-10-09T11:00:00Z') });
    const newerCritical = await alertRow({ severity: 'critical', lastObservedAt: new Date('2026-10-09T10:00:00Z') });

    const res = await as(adminToken).get('/api/admin/operations/alerts').expect(200);
    const mine = res.body.data
      .map((a: { id: string }) => a.id)
      .filter((id: string) => [olderCritical.id, newerWarning.id, newerCritical.id].includes(id));
    expect(mine).toEqual([newerCritical.id, olderCritical.id, newerWarning.id]);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(canaryEmail);
    expect(body).not.toContain(canaryBearer);
    const row = res.body.data.find((a: { id: string }) => a.id === olderCritical.id);
    expect(row.delivery.lastAttempt.email).toEqual({
      status: 'simulated',
      at: '2026-10-09T07:00:02.000Z',
      recipients: 1,
      provider: null,
      error: null,
    });

    await as(adminToken).get('/api/admin/operations/alerts?status=bogus').expect(400);
  });

  it('acknowledges once with the exact actor and time, and audits only the first call', async () => {
    const open = await alertRow({ severity: 'critical' });
    const audits = () =>
      db.getRepository(AuditEvent).count({
        where: { action: OPERATIONAL_ALERT_AUDIT_ACTIONS.acknowledged as never, resourceId: open.id },
      });

    const first = await as(adminToken).post(`/api/admin/operations/alerts/${open.id}/acknowledge`).expect(200);
    expect(first.body.changed).toBe(true);
    expect(first.body.alert).toMatchObject({ status: 'acknowledged', acknowledgedBy: adminId });
    const stored = await db.getRepository(OperationalAlert).findOneByOrFail({ id: open.id });
    expect(first.body.alert.acknowledgedAt).toBe(stored.acknowledgedAt!.toISOString());
    expect(stored.acknowledgedBy).toBe(adminId);
    expect(await audits()).toBe(1);

    const second = await as(adminToken).post(`/api/admin/operations/alerts/${open.id}/acknowledge`).expect(200);
    expect(second.body.changed).toBe(false);
    expect(second.body.alert.acknowledgedAt).toBe(first.body.alert.acknowledgedAt);
    expect(second.body.alert.acknowledgedBy).toBe(adminId);
    expect(await audits()).toBe(1);
  });

  it('returns 404, 409 and 400 for unknown, resolved and malformed alerts', async () => {
    await as(adminToken).post(`/api/admin/operations/alerts/${randomUUID()}/acknowledge`).expect(404);
    const resolved = await alertRow({ status: 'resolved', resolvedAt: new Date('2026-10-09T09:00:00Z') });
    await as(adminToken).post(`/api/admin/operations/alerts/${resolved.id}/acknowledge`).expect(409);
    await as(adminToken).post('/api/admin/operations/alerts/not-a-uuid/acknowledge').expect(400);
  });

  it('reports migration unavailable with configured gates and unknown revenue', async () => {
    const res = await as(adminToken).get('/api/admin/operations/migration-readiness').expect(200);
    expect(res.body.available).toBe(false);
    expect(res.body.revenue).toMatchObject({
      minimumMonthlyNetInr: 1200000,
      preferredMonthlyNetInr: 1500000,
      measuredMonthlyNetInr: null,
      status: 'unknown',
    });
    expect(res.body.migration).toMatchObject({ enabled: false, executor: 'mock', dryRun: true });
    expect(res.body.unmet).toEqual(
      expect.arrayContaining(['auth_step_up', 'migration_control_plane', 'migration_enabled', 'real_executor', 'executor_gates']),
    );
  });
});
