import { checkBiodataBrowser } from './biodata-browser';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { hash } from 'bcryptjs';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/config/app-config.service';
import { User } from '../src/modules/auth/entities/user.entity';
import { Profile } from '../src/modules/users/entities/profile.entity';
import { ProfileDetails } from '../src/modules/profile-details/entities/profile-details.entity';
import { ProfileLifecycle, UserRole } from '../src/common/enums';
import { BiodataFamilyPhoto1710000103000 } from '../src/database/migrations/1710000103000-BiodataFamilyPhoto';
import { RestoreBiodataHeightCm1710000104000 } from '../src/database/migrations/1710000104000-RestoreBiodataHeightCm';

describe('Family Photo and centimeter height end to end', () => {
  let app: INestApplication;
  let db: DataSource;
  const actors: { user: User; profile: Profile; token: string; url?: string }[] = [];
  const password = 'BiodataTest123!';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64');
  const personal = { firstName: 'Ada', lastName: 'Rao', complexion: 'wheatish', communicationAddress: 'Test address' };
  const http = () => request(app.getHttpServer());
  async function boot() {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.use('/api/mock-storage', express.raw({ type: () => true, limit: '10mb' }));
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } }));
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    expect(app.get(AppConfigService).media.storageProvider).toBe('mock');
  }
  async function login(user: User) {
    const response = await http().post('/api/auth/login').set('X-Client-Platform', 'android')
      .send({ email: user.email, password }).expect(200);
    return response.body;
  }
  async function upload(token: string) {
    const slot = (await http().post('/api/media/profile-photo/presign').set('Authorization', `Bearer ${token}`)
      .send({ filename: 'family.png', size: png.length, contentType: 'image/png' }).expect(201)).body;
    await http().put(new URL(slot.uploadUrl).pathname).set('Content-Type', 'image/png').send(png).expect(200);
    await http().post('/api/media/complete').set('Authorization', `Bearer ${token}`).send({ key: slot.key }).expect(201);
    const image = await http().get(new URL(slot.publicUrl).pathname).expect(200);
    expect(image.body).toEqual(png);
    return slot.publicUrl as string;
  }

  beforeAll(async () => {
    await boot();
    const passwordHash = await hash(password, 10);
    for (const role of [UserRole.BRIDE, UserRole.GROOM, UserRole.FAMILY, UserRole.AGENT]) {
      const managed = role === UserRole.FAMILY || role === UserRole.AGENT;
      const users = db.getRepository(User);
      const user = await users.save(users.create({ email: `biodata-${role}-${Date.now()}@example.com`, passwordHash, role, isActive: true, isVerified: true }));
      const profiles = db.getRepository(Profile);
      const profile = await profiles.save(profiles.create({ userId: managed ? null : user.id, managedByUserId: managed ? user.id : null, displayName: 'Biodata Test', gender: role === UserRole.GROOM ? 'male' : 'female', photos: [] }));
      actors.push({ user, profile, token: (await login(user)).accessToken });
    }
  }, 90000);

  afterAll(async () => {
    for (const actor of actors) {
      await db.getRepository(Profile).delete(actor.profile.id);
      await db.getRepository(User).delete(actor.user.id);
    }
    await app?.close();
  });

  it.each([0, 1, 2, 3])('uploads, saves, replaces, logs in again and reloads for role %s', async (index) => {
    const actor = actors[index];
    const route = `/api/profiles/${actor.profile.id}/details`;
    const read = () => http().get(route).set('Authorization', `Bearer ${actor.token}`);
    const savePhoto = (url: string) => http().put(`${route}/family-photo`).set('Authorization', `Bearer ${actor.token}`).send({ url });
    const first = await upload(actor.token);
    await savePhoto(first).expect(200);
    expect((await read().expect(200)).body.details.familyPhotoUrl).toBe(first);
    expect((await db.getRepository(Profile).findOneByOrFail({ id: actor.profile.id })).photos).toEqual([]);
    const second = await upload(actor.token);
    await savePhoto(second).expect(200);
    actor.url = second;
    expect((await db.getRepository(ProfileDetails).findOneByOrFail({ profileId: actor.profile.id })).familyPhotoUrl).toBe(second);

    // Personal details retain the existing three-photograph prerequisite.
    // Three distinct photographs: a repeated one would be listed twice on the
    // photographs step, which React rejects as a duplicate key.
    const third = await upload(actor.token);
    await db.getRepository(Profile).update(actor.profile.id, { photos: [first, second, third] });
    for (const heightCm of [168, 170, 178, 180]) {
      await http().put(`${route}/personal`).set('Authorization', `Bearer ${actor.token}`).send({ ...personal, heightCm }).expect(200);
      expect((await read().expect(200)).body.details.heightCm).toBe(heightCm);
      expect((await db.getRepository(ProfileDetails).findOneByOrFail({ profileId: actor.profile.id })).heightCm).toBe(heightCm);
    }
    for (const heightCm of ['', 'abc', -5, '168.5', '1.68e2', '0xA8', null, 90, 245]) {
      await http().put(`${route}/personal`).set('Authorization', `Bearer ${actor.token}`).send({ ...personal, heightCm }).expect(400);
    }
    await http().put(`${route}/personal`).set('Authorization', `Bearer ${actor.token}`).send(personal).expect(400);
    expect((await read().expect(200)).body.details).toMatchObject({ familyPhotoUrl: second, heightCm: 180 });
    const session = await login(actor.user);
    await http().post('/api/auth/logout').send({ refreshToken: session.refreshToken }).expect(200);
    actor.token = (await login(actor.user)).accessToken;
    expect((await read().expect(200)).body.details).toMatchObject({ familyPhotoUrl: second, heightCm: 180 });
  }, 60000);

  it('refuses anonymous, unrelated and released stewards without changing the target', async () => {
    const target = actors[0];
    const route = `/api/profiles/${target.profile.id}/details`;
    await http().put(`${route}/family-photo`).send({ url: target.url }).expect(401);
    for (const actor of actors.slice(1)) {
      await http().put(`${route}/family-photo`).set('Authorization', `Bearer ${actor.token}`).send({ url: actor.url }).expect(403);
      await http().put(`${route}/personal`).set('Authorization', `Bearer ${actor.token}`).send({ ...personal, heightCm: 168 }).expect(403);
    }
    // A steward keeps writing once the person claims the profile, while the
    // engagement is live; closing it out, or releasing the profile from their
    // book, is what ends it.
    const family = actors[2];
    const familyPhoto = () => http().put(`/api/profiles/${family.profile.id}/details/family-photo`)
      .set('Authorization', `Bearer ${family.token}`).send({ url: family.url });
    await db.getRepository(Profile).update(actors[1].profile.id, { userId: null });
    await db.getRepository(Profile).update(family.profile.id, { userId: actors[1].user.id });
    try {
      await familyPhoto().expect(200);
      await db.getRepository(Profile).update(family.profile.id, { lifecycle: ProfileLifecycle.ARCHIVED });
      await familyPhoto().expect(403);
      await db.getRepository(Profile).update(family.profile.id, { lifecycle: ProfileLifecycle.ACTIVE, managedByUserId: null });
      await familyPhoto().expect(403);
    } finally {
      await db.getRepository(Profile).update(family.profile.id, {
        userId: null, managedByUserId: family.user.id, lifecycle: ProfileLifecycle.ACTIVE,
      });
      await db.getRepository(Profile).update(actors[1].profile.id, { userId: actors[1].user.id });
    }
    expect((await db.getRepository(ProfileDetails).findOneByOrFail({ profileId: target.profile.id })).familyPhotoUrl).toBe(target.url);
  });

  it('rejects invalid and inverted height filters through HTTP', async () => {
    for (const heightMinCm of ['abc', '-168', '168.5', '1.68e2', '0xA8', '', '245']) {
      await http().get('/api/matches/suggestions').set('Authorization', `Bearer ${actors[0].token}`)
        .query({ heightMinCm }).expect(400);
    }
    await http().get('/api/matches/suggestions').set('Authorization', `Bearer ${actors[0].token}`)
      .query({ heightMinCm: 185, heightMaxCm: 168 }).expect(400);
  });

  it('reloads persisted data and uploaded bytes after a complete application restart', async () => {
    await app.close();
    await boot();
    for (const actor of actors) {
      actor.token = (await login(actor.user)).accessToken;
      const response = await http().get(`/api/profiles/${actor.profile.id}/details`).set('Authorization', `Bearer ${actor.token}`).expect(200);
      expect(response.body.details).toMatchObject({ familyPhotoUrl: actor.url, heightCm: 180 });
      expect((await http().get(new URL(actor.url!).pathname).expect(200)).body).toEqual(png);
    }
  }, 90000);

  (process.env.CHROME_BIN ? it : it.skip)('saves height and uploads/replaces Family Photo in the browser, including reload and logout/login', async () => {
    const actor = actors[0];
    // The basic information card saves personal details and religion together,
    // so the religion it reads back has to be complete for the form to submit.
    const route = `/api/profiles/${actor.profile.id}/details`;
    await http().put(`${route}/religion`).set('Authorization', `Bearer ${actor.token}`)
      .send({ religion: 'Hindu', caste: 'Kamma', subCaste: 'Test sub-caste', motherTongue: 'Telugu' }).expect(200);
    await http().put(`${route}/marital`).set('Authorization', `Bearer ${actor.token}`)
      .send({ maritalStatus: 'never_married' }).expect(200);
    const url = await checkBiodataBrowser(await app.getUrl(), actor.user.email!, password, png);
    expect((await db.getRepository(ProfileDetails).findOneByOrFail({ profileId: actor.profile.id })))
      .toMatchObject({ heightCm: 168, familyPhotoUrl: url });
  }, 90000);

  it('restores historical feet columns to centimeters and leaves original centimeter schemas unchanged', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query('CREATE SCHEMA biodata_height_migration_test');
      await runner.query('SET LOCAL search_path TO biodata_height_migration_test');
      await runner.query('CREATE TABLE profile_details ("heightFeet" numeric, "preferredHeightMinFeet" numeric, "preferredHeightMaxFeet" numeric, CONSTRAINT "CK_heightFeet_feet" CHECK ("heightFeet" BETWEEN 3 AND 8), CONSTRAINT "CK_preferredHeightMinFeet_feet" CHECK ("preferredHeightMinFeet" BETWEEN 3 AND 8), CONSTRAINT "CK_preferredHeightMaxFeet_feet" CHECK ("preferredHeightMaxFeet" BETWEEN 3 AND 8))');
      await runner.query('INSERT INTO profile_details VALUES (5.1,4.9,6.2), (5.5,5.1,5.75), (5.75,5.5,6.25), (6.25,6.25,6.25), (NULL,NULL,NULL)');
      await new BiodataFamilyPhoto1710000103000().up(runner);
      const migration = new RestoreBiodataHeightCm1710000104000();
      await migration.up(runner);
      const rows = await runner.query('SELECT * FROM profile_details ORDER BY "heightCm" NULLS LAST');
      expect(rows.slice(0, 4)).toMatchObject([
        { heightCm: 155, preferredHeightMinCm: 149, preferredHeightMaxCm: 189, heightFeetLegacy: '5.1', familyPhotoUrl: null },
        { heightCm: 168, preferredHeightMinCm: 155, preferredHeightMaxCm: 175, heightFeetLegacy: '5.5', familyPhotoUrl: null },
        { heightCm: 175, preferredHeightMinCm: 168, preferredHeightMaxCm: 191, heightFeetLegacy: '5.75', familyPhotoUrl: null },
        { heightCm: 191, preferredHeightMinCm: 191, preferredHeightMaxCm: 191, heightFeetLegacy: '6.25', familyPhotoUrl: null },
      ]);
      expect(rows[4]).toMatchObject({ heightCm: null, preferredHeightMinCm: null, preferredHeightMaxCm: null, familyPhotoUrl: null });
      await migration.up(runner);
      expect(await runner.query('SELECT * FROM profile_details ORDER BY "heightCm" NULLS LAST')).toEqual(rows);

      await runner.query('ALTER TABLE profile_details RENAME TO profile_details_restored');
      await runner.query('CREATE TABLE profile_details ("heightCm" integer, "preferredHeightMinCm" integer, "preferredHeightMaxCm" integer)');
      await runner.query('INSERT INTO profile_details VALUES (170,150,190)');
      await new BiodataFamilyPhoto1710000103000().up(runner);
      await migration.up(runner);
      expect(await runner.query('SELECT * FROM profile_details')).toEqual([
        { heightCm: 170, preferredHeightMinCm: 150, preferredHeightMaxCm: 190, familyPhotoUrl: null },
      ]);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
