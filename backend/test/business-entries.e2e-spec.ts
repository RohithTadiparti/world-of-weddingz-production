import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/config/app-config.service';
import { User } from '../src/modules/auth/entities/user.entity';
import { Profile } from '../src/modules/users/entities/profile.entity';
import { ProfileDetails } from '../src/modules/profile-details/entities/profile-details.entity';
import { ProfileDetailsService } from '../src/modules/profile-details/profile-details.service';
import { UserRole } from '../src/common/enums';

describe('Multiple Business Entries API', () => {
  let app: INestApplication;
  let db: DataSource;
  const actors: { user: User; profile: Profile; token: string }[] = [];
  const base = { highestQualification: 'Masters', course: 'Commerce', occupationStatus: 'self_employed', incomeVisible: false };
  const legacyBusiness = { businessName: 'Store', businessType: 'Retail', businessLocation: 'Hyderabad', businessIncome: '0' };
  const businesses = [
    { businessName: 'Store', businessType: 'Retail', businessLocation: 'Hyderabad', businessIncome: '100000' },
    { businessName: 'Farm', businessType: 'Agriculture', businessLocation: 'Pune', businessIncome: '200000' },
    { businessName: 'Studio', businessType: 'Design', businessLocation: 'Mumbai', businessIncome: '300000' },
  ];
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    db = app.get(DataSource);
    const jwt = new JwtService({ secret: app.get(AppConfigService).auth.jwtSecret });
    for (const role of [UserRole.BRIDE, UserRole.AGENT]) {
      const users = db.getRepository(User);
      const user = await users.save(users.create({ email: `business-${role}-${Date.now()}@gmail.com`, passwordHash: 'fixture', role, isActive: true, isVerified: true }));
      const profiles = db.getRepository(Profile);
      const profile = await profiles.save(profiles.create({ userId: role === UserRole.AGENT ? null : user.id, managedByUserId: role === UserRole.AGENT ? user.id : null, displayName: 'Business Test', gender: 'Female' }));
      actors.push({ user, profile, token: jwt.sign({ sub: user.id, tv: 0 }) });
    }
  }, 60000);
  afterAll(async () => {
    for (const actor of actors) {
      await db.getRepository(Profile).delete(actor.profile.id);
      await db.getRepository(User).delete(actor.user.id);
    }
    await app?.close();
  });

  it.each([0, 1])('persists add/edit/remove and legacy data for role %s', async (index) => {
    const actor = actors[index];
    const route = `/api/profiles/${actor.profile.id}/details`;
    const save = (business: object, extra: object = {}) => request(app.getHttpServer()).put(`${route}/education`)
      .set('Authorization', `Bearer ${actor.token}`).send({ ...base, business, ...extra });
    const read = () => request(app.getHttpServer()).get(route).set('Authorization', `Bearer ${actor.token}`);
    // Existing rows require no destructive conversion or schema migration.
    await db.getRepository(ProfileDetails).save({ profileId: actor.profile.id, business: legacyBusiness, religion: 'Hindu' });
    expect((await read().expect(200)).body.details.business).toEqual(legacyBusiness);
    const created = await save({ entries: businesses }).expect(200);
    const entries = created.body.business.entries;
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((entry: { id: string }) => entry.id)).size).toBe(3);
    const persisted = await db.getRepository(ProfileDetails).findOneByOrFail({ profileId: actor.profile.id });
    expect(persisted.business.entries).toEqual(entries);
    expect((await read().expect(200)).body.details.business.entries).toEqual(entries);
    const edited = entries.map((entry: object, i: number) => i === 1 ? { ...entry, businessName: 'Updated farm' } : entry);
    await save({ entries: edited }).expect(200);
    const kept = [edited[0], edited[2]];
    await save({ entries: kept }).expect(200);
    expect((await read().expect(200)).body.details).toMatchObject({ business: { entries: kept }, religion: 'Hindu' });
    await save({ businessName: 'Legacy edit' }).expect(200);
    const legacy = (await read().expect(200)).body.details.business.entries;
    expect(legacy[1]).toEqual(kept[1]);
    expect(legacy[0].id).toBe(kept[0].id);
    const privateView = await app.get(ProfileDetailsService).findShareable(actor.profile.id);
    expect(privateView.details).not.toBeNull();
    expect(JSON.stringify(privateView.details?.business)).not.toContain('businessIncome');
    await save({ entries: kept }, { incomeVisible: true }).expect(200);
    const publicView = await app.get(ProfileDetailsService).findShareable(actor.profile.id);
    expect(publicView.details?.business.entries).toEqual(kept);
    await save({ entries: [] }).expect(400);
    await save({ entries: [[]] }).expect(400);
    await save({ businessName: null }).expect(400);
    await save({ entries: [legacyBusiness] }).expect(400);
    await save({ entries: [businesses[0], { ...businesses[1], businessIncome: '-1' }] }).expect(400);
    await save({ entries: [kept[0], kept[0]] }).expect(400);
    expect((await read().expect(200)).body.details.business.entries).toEqual(kept);
    // Switching occupation without a business payload must not destroy saved entries.
    await request(app.getHttpServer()).put(`${route}/education`).set('Authorization', `Bearer ${actor.token}`)
      .send({ ...base, occupationStatus: 'student' }).expect(200);
    expect((await read().expect(200)).body.details.business.entries).toEqual(kept);
  });

  it('enforces ownership, and keeps the agent editing a claimed client until released', async () => {
    await request(app.getHttpServer()).put(`/api/profiles/${actors[0].profile.id}/details/education`)
      .set('Authorization', `Bearer ${actors[1].token}`).send({ ...base, business: { entries: businesses } }).expect(403);
    await request(app.getHttpServer()).get(`/api/profiles/${actors[1].profile.id}/details`)
      .set('Authorization', `Bearer ${actors[0].token}`).expect(403);
    await db.getRepository(Profile).update(actors[1].profile.id, { userId: actors[1].user.id });
    // A different owner is required to distinguish owner from steward.
    await db.getRepository(Profile).update(actors[0].profile.id, { userId: null });
    await db.getRepository(Profile).update(actors[1].profile.id, { userId: actors[0].user.id });
    // Claimed, and still on the agent's book: both sides write the one biodata.
    await request(app.getHttpServer()).put(`/api/profiles/${actors[1].profile.id}/details/education`)
      .set('Authorization', `Bearer ${actors[1].token}`).send({ ...base, business: { entries: businesses } }).expect(200);
    await request(app.getHttpServer()).put(`/api/profiles/${actors[1].profile.id}/details/education`)
      .set('Authorization', `Bearer ${actors[0].token}`).send({ ...base, business: { entries: businesses } }).expect(200);
    // Released from the book: the agent is refused, the owner is not.
    await db.getRepository(Profile).update(actors[1].profile.id, { managedByUserId: null });
    await request(app.getHttpServer()).put(`/api/profiles/${actors[1].profile.id}/details/education`)
      .set('Authorization', `Bearer ${actors[1].token}`).send({ ...base, business: { entries: businesses } }).expect(403);
    await request(app.getHttpServer()).put(`/api/profiles/${actors[1].profile.id}/details/education`)
      .set('Authorization', `Bearer ${actors[0].token}`).send({ ...base, business: { entries: businesses } }).expect(200);
  });

  it('uses the existing JSONB schema', async () => {
    const runner = db.createQueryRunner();
    try {
      const table = await runner.getTable('profile_details');
      expect(table?.findColumnByName('business')?.type).toBe('jsonb');
    } finally {
      await runner.release();
    }
  });
});
