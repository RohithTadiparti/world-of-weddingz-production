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
import { NotificationType, UserRole } from '../src/common/enums';
import { User } from '../src/modules/auth/entities/user.entity';
import { Notification } from '../src/modules/notifications/entities/notification.entity';
import { OperationalAlert } from '../src/modules/operations/entities/operational-alert.entity';
import { AlertDeliveryService } from '../src/modules/operations/alerts/alert-delivery.service';
import {
  AlertDeliveryMetadata,
  OPERATIONAL_ALERT_AUDIT_ACTIONS,
} from '../src/modules/operations/alerts/alert-delivery.types';
import { AuditEvent } from '../src/platform/audit/entities/audit-event.entity';

/**
 * Operational alert delivery against a real Postgres: the notification enum
 * value exists, only active administrators are notified, a repeated
 * evaluation sends nothing, and the delivery record and audit trail persist.
 */
describe('Operational alert delivery (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let delivery: AlertDeliveryService;
  const users: string[] = [];
  const tag = randomUUID().slice(0, 8);
  let alertId: string;

  async function makeUser(role: UserRole, isActive: boolean): Promise<User> {
    const repo = db.getRepository(User);
    const user = await repo.save(
      repo.create({
        email: `wow.e2e.opsalert.${tag}.${randomUUID().slice(0, 6)}@gmail.com`,
        passwordHash: await bcrypt.hash('Password123', 4),
        role,
        isActive,
        isVerified: true,
      }),
    );
    users.push(user.id);
    return user;
  }

  const notificationsFor = (userId: string) =>
    db.getRepository(Notification).find({
      where: { userId, type: NotificationType.OPERATIONAL_ALERT },
    });

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
    delivery = app.get(AlertDeliveryService);

    const alerts = db.getRepository(OperationalAlert);
    const now = new Date();
    const alert = await alerts.save(
      alerts.create({
        fingerprint: `e2e:${tag}`,
        metric: 'cpuPercent',
        severity: 'warning',
        status: 'open',
        observedValue: 72.5,
        thresholdValue: 70,
        unit: 'percent',
        source: 'e2e-runtime',
        firstObservedAt: now,
        lastObservedAt: now,
        deliveryMetadata: {},
      }),
    );
    alertId = alert.id;
  }, 60000);

  afterAll(async () => {
    if (db) {
      if (users.length) {
        await db
          .getRepository(Notification)
          .createQueryBuilder()
          .delete()
          .where('"userId" IN (:...users)', { users })
          .execute();
        await db.getRepository(User).delete(users);
      }
      if (alertId) await db.getRepository(OperationalAlert).delete(alertId);
    }
    await app?.close();
  });

  it('notifies active administrators once, persists the attempt and never repeats it', async () => {
    const admin = await makeUser(UserRole.ADMIN, true);
    const inactiveAdmin = await makeUser(UserRole.ADMIN, false);
    const bride = await makeUser(UserRole.BRIDE, true);
    const alerts = db.getRepository(OperationalAlert);

    const first = await delivery.deliver((await alerts.findOneByOrFail({ id: alertId })));
    expect(first.event).toBe('opened');
    expect(first.attempt?.portal.status).toBe('delivered');
    expect(first.attempt?.email.status).toBe(
      app.get(AppConfigService).operations.alertRecipients.length ? 'simulated' : 'not_configured',
    );

    const received = await notificationsFor(admin.id);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      targetModule: 'infrastructure',
      targetAction: 'review',
      targetId: alertId,
    });
    expect(received[0].payload).toMatchObject({
      alertId,
      correlationId: first.attempt?.correlationId,
      metric: 'cpuPercent',
    });
    expect(await notificationsFor(inactiveAdmin.id)).toHaveLength(0);
    expect(await notificationsFor(bride.id)).toHaveLength(0);

    const stored = await alerts.findOneByOrFail({ id: alertId });
    const metadata = stored.deliveryMetadata as unknown as AlertDeliveryMetadata;
    expect(stored.lastNotifiedAt).not.toBeNull();
    expect(metadata).toMatchObject({ version: 1, notifiedSeverity: 'warning' });
    expect(metadata.history).toHaveLength(1);
    expect(metadata.lastAttempt?.event).toBe('opened');

    const again = await delivery.deliver(stored);
    expect(again.event).toBeNull();
    expect(await notificationsFor(admin.id)).toHaveLength(1);

    // The administrator sees it in their own feed through the API.
    const token = new JwtService({ secret: app.get(AppConfigService).auth.jwtSecret }).sign(
      { sub: admin.id, tv: 0, role: UserRole.ADMIN, email: admin.email, authMethod: 'zoho' },
      { expiresIn: '5m' },
    );
    const feed = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      (feed.body as Array<{ type: string; targetId: string }>).filter(
        (n) => n.type === 'operational_alert' && n.targetId === alertId,
      ),
    ).toHaveLength(1);

    const attempt = await delivery.recordAcknowledged(stored, admin.id, `e2e-${tag}`);
    expect(attempt.audit.status).toBe('recorded');

    const audit = await db.getRepository(AuditEvent).find({ where: { resourceId: alertId } });
    expect(audit.map((row) => row.action).sort()).toEqual(
      [OPERATIONAL_ALERT_AUDIT_ACTIONS.opened, OPERATIONAL_ALERT_AUDIT_ACTIONS.acknowledged].sort(),
    );
    expect(audit.find((row) => row.action === OPERATIONAL_ALERT_AUDIT_ACTIONS.acknowledged)).toMatchObject({
      actorUserId: admin.id,
      actorRole: UserRole.ADMIN,
    });
    const final = await alerts.findOneByOrFail({ id: alertId });
    expect(final.acknowledgedAt).toBeNull();
    expect((final.deliveryMetadata as unknown as AlertDeliveryMetadata).history.map((a) => a.event)).toEqual([
      'acknowledged',
      'opened',
    ]);
  });
});
