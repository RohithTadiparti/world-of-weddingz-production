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
import { FamilyType, MaritalStatus, UserRole } from '../src/common/enums';

// Uses the repository's isolated PostgreSQL/Redis test stack, with authenticated
// fixtures so a signup-policy change cannot hide matchmaking regressions.
describe('Package Range API', () => {
  let app: INestApplication;
  let db: DataSource;
  const userIds: string[] = [];
  const profileIds: string[] = [];
  const actors: { token: string; profile: Profile }[] = [];
  let candidate: Profile;
  let candidateToken: string;
  const base = { preferredAgeMin: 18, preferredAgeMax: 100, preferredHeightMinCm: 99, preferredHeightMaxCm: 229 };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    db = app.get(DataSource);
    const users = db.getRepository(User);
    const profiles = db.getRepository(Profile);
    const jwt = new JwtService({ secret: app.get(AppConfigService).auth.jwtSecret });
    for (const role of [UserRole.BRIDE, UserRole.FAMILY, UserRole.GROOM]) {
      const user = await users.save(users.create({ email: `package-${role}-${Date.now()}@gmail.com`, passwordHash: 'test-fixture', role, isActive: true, isVerified: true }));
      userIds.push(user.id);
      const profile = await profiles.save(profiles.create({
        userId: role === UserRole.FAMILY ? null : user.id,
        managedByUserId: role === UserRole.FAMILY ? user.id : null,
        displayName: 'Package Test', gender: role === UserRole.GROOM ? 'Male' : 'Female',
        dateOfBirth: '1995-01-01', city: 'Mumbai', profileCompleted: true,
      }));
      profileIds.push(profile.id);
      const token = jwt.sign({ sub: user.id, tv: 0 });
      if (role === UserRole.GROOM) { candidate = profile; candidateToken = token; }
      else actors.push({ token, profile });
    }
    // Only a profile with a complete biodata is suggested (ISS-08), so the
    // candidate gets every section but education, which the test itself saves.
    await profiles.update(candidate.id, { photos: [1, 2, 3].map((n) => `https://cdn.example.com/package-${n}.jpg`) });
    const details = db.getRepository(ProfileDetails);
    await details.save(details.create({
      profileId: candidate.id, firstName: 'Package', lastName: 'Test', heightCm: 175, complexion: 'Fair',
      communicationAddress: 'Mumbai', religion: 'Hindu', caste: 'Kamma', motherTongue: 'Telugu',
      horoscopeAvailable: false, maritalStatus: MaritalStatus.NEVER_MARRIED, father: { name: 'Ramesh' },
      mother: { name: 'Lakshmi' }, familyType: FamilyType.NUCLEAR, familyNetWorth: '10000000', brothers: 0, sisters: 0,
      preferredAgeMin: 24, preferredHeightMinCm: 150,
    }));
  }, 60000);

  afterAll(async () => {
    if (db) {
      for (const id of profileIds) await db.getRepository(Profile).delete(id);
      for (const id of userIds) await db.getRepository(User).delete(id);
    }
    await app?.close();
  });

  it('saves, reads, edits, clears and filters for Individual and Family profiles', async () => {
    const http = () => request(app.getHttpServer());
    await http().put(`/api/profiles/${candidate.id}/details/education`)
      .set('Authorization', `Bearer ${candidateToken}`)
      .send({ highestQualification: 'Masters', course: 'Engineering', occupationStatus: 'employed', employment: { salary: '1200000' }, incomeVisible: true }).expect(200);
    for (const actor of actors) {
      const save = (bounds: object) => http().put(`/api/profiles/${actor.profile.id}/details/preferences`)
        .set('Authorization', `Bearer ${actor.token}`).send({ ...base, ...bounds });
      const find = (bounds: object = {}) => http().get('/api/matches/suggestions')
        .set('Authorization', `Bearer ${actor.token}`)
        .query({ profileId: actor.profile.id, sort: 'recent', ...bounds });
      const read = () => http().get(`/api/profiles/${actor.profile.id}/details`)
        .set('Authorization', `Bearer ${actor.token}`);
      const containsCandidate = (result: { body: { data: { profile: { id: string } }[] } }) =>
        result.body.data.some((item) => item.profile.id === candidate.id);

      await save({ preferredPackageMin: 1200000, preferredPackageMax: 1200000 }).expect(200);
      expect((await read().expect(200)).body.details).toMatchObject({ preferredPackageMin: 1200000, preferredPackageMax: 1200000 });
      const unfiltered = await find().expect(200);
      expect(containsCandidate(unfiltered)).toBe(true);
      expect(JSON.stringify(unfiltered.body)).not.toContain('1200000');
      // A different person's salary edit must invalidate this viewer's cached list.
      await http().put(`/api/profiles/${candidate.id}/details/education`)
        .set('Authorization', `Bearer ${candidateToken}`)
        .send({ highestQualification: 'Masters', course: 'Engineering', occupationStatus: 'employed', employment: {}, incomeVisible: false }).expect(200);
      expect(containsCandidate(await find().expect(200))).toBe(true);
      await http().put(`/api/profiles/${candidate.id}/details/education`)
        .set('Authorization', `Bearer ${candidateToken}`)
        .send({ highestQualification: 'Masters', course: 'Engineering', occupationStatus: 'employed', employment: { salary: '1200000' }, incomeVisible: true }).expect(200);
      expect(containsCandidate(await find().expect(200))).toBe(true);
      expect(containsCandidate(await find({ packageMin: 1200001, packageMax: 1500000 }).expect(200))).toBe(false);
      expect(containsCandidate(await find({ packageMin: 0, packageMax: 1200000 }).expect(200))).toBe(true);
      await save({ preferredPackageMin: 1200001, preferredPackageMax: 1500000 }).expect(200);
      expect(containsCandidate(await find().expect(200))).toBe(true);
      await save({}).expect(200);
      expect((await read().expect(200)).body.details.preferredPackageMin).toBe(1200001);
      await save({ preferredPackageMin: 1600000 }).expect(400);
      await save({ preferredPackageMax: -1 }).expect(400);
      await save({ preferredPackageMax: 1.5 }).expect(400);
      await find({ packageMin: 2000000, packageMax: 1000000 }).expect(400);
      await save({ preferredPackageMin: null, preferredPackageMax: null }).expect(200);
      expect((await read().expect(200)).body.details).toMatchObject({ preferredPackageMin: null, preferredPackageMax: null });
      expect(containsCandidate(await find().expect(200))).toBe(true);
    }
  }, 60000);

  it('enforces range constraints in PostgreSQL', async () => {
    await expect(db.getRepository(ProfileDetails).update({ profileId: actors[0].profile.id }, {
      preferredPackageMin: 200, preferredPackageMax: 100,
    })).rejects.toMatchObject({ driverError: { code: '23514' } });
  });
});
