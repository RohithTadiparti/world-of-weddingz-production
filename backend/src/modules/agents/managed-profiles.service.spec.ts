import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ManagedProfilesService } from './managed-profiles.service';
import { Profile } from '../users/entities/profile.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { User } from '../auth/entities/user.entity';
import { AgentProfile } from './entities/agent-profile.entity';
import { AppConfigService } from '../../config/app-config.service';
import { AuditService } from '../../platform/audit/audit.service';
import { InvitationsService } from '../invitations/invitations.service';
import { ConsentService } from '../circulation/consent.service';
import { AgentBillingService } from './agent-billing.service';
import { ModerationService } from '../../platform/moderation/moderation.service';
import {
  ConsentMethod,
  ConsentRelation,
  ProfileClaimStatus,
  ProfileLifecycle,
  UserRole,
} from '../../common/enums';
import { CreateManagedProfileDto } from './dto/managed-profile.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';

describe('managed profile biodata intake', () => {
  const actor: AuthUser = { userId: 'agent-1', email: 'agent@example.com',
    role: UserRole.AGENT, managedByAgentId: null };
  const dto: CreateManagedProfileDto = {
    displayName: 'Rahul Kumar', contactPhone: '9876543210', dateOfBirth: '1998-08-15', gender: 'male',
    consent: { method: ConsentMethod.IN_PERSON, givenByRelation: ConsentRelation.SELF, givenAt: '2026-01-01' },
    biodata: { firstName: 'Rahul', lastName: 'Kumar', heightCm: 175, religion: 'Hindu',
      caste: 'Kamma', subCaste: 'Example', motherTongue: 'Telugu', highestQualification: 'B.Tech',
      profession: 'Software Engineer', company: 'Example Ltd', fatherName: 'Ramesh', motherName: 'Lakshmi',
      familyType: 'Nuclear', rashi: 'Mesha', timeOfBirth: '06:30', communicationAddress: 'Hyderabad' },
  };

  async function setup() {
    let saved: Partial<Profile> = {};
    const profileRepo = {
      count: jest.fn(async () => 0), find: jest.fn(async () => []),
      create: jest.fn((value: Partial<Profile>) => value),
      save: jest.fn(async (value: Partial<Profile>) => (saved = { ...value, id: 'profile-1' })),
      findOne: jest.fn(async () => saved),
    };
    const detailsRepo = { create: jest.fn((value: Partial<ProfileDetails>) => value),
      save: jest.fn(async (value: Partial<ProfileDetails>) => value) };
    const manager = { getRepository: (entity: unknown) => entity === Profile ? profileRepo : detailsRepo };
    const transaction = jest.fn(async (work: (value: typeof manager) => Promise<unknown>) => work(manager));
    const consent = { record: jest.fn() };
    const invitations = { invite: jest.fn() };
    const moderation = { assertGenuinePhotos: jest.fn(async () => undefined) };
    const module = await Test.createTestingModule({ providers: [ManagedProfilesService,
      { provide: getRepositoryToken(Profile), useValue: { ...profileRepo, manager: { transaction } } },
      { provide: getRepositoryToken(User), useValue: { findOne: jest.fn(async () => null) } },
      { provide: getRepositoryToken(AgentProfile), useValue: {} },
      { provide: AppConfigService, useValue: { stewardship: { requireAgentApproval: false, maxManagedProfiles: 100, maxManagedProfilesFamily: 5 } } },
      { provide: AuditService, useValue: { record: jest.fn() } },
      { provide: InvitationsService, useValue: invitations },
      { provide: ConsentService, useValue: consent },
      { provide: AgentBillingService, useValue: {} },
      { provide: ModerationService, useValue: moderation },
    ] }).compile();
    return { service: module.get(ManagedProfilesService), detailsRepo, profileRepo, transaction, consent, invitations, moderation };
  }

  it('persists real profile fields and associated existing Biodata sections', async () => {
    const { service, detailsRepo, transaction, invitations } = await setup();
    const profile = await service.create(actor, dto);
    expect(profile).toMatchObject({ id: 'profile-1', dateOfBirth: '1998-08-15', gender: 'male', contactPhone: '9876543210' });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(detailsRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      profileId: profile.id, firstName: 'Rahul', lastName: 'Kumar', heightCm: 175,
      religion: 'Hindu', caste: 'Kamma', subCaste: 'Example', motherTongue: 'Telugu',
      highestQualification: 'B.Tech', communicationAddress: 'Hyderabad', familyType: 'nuclear',
      father: { name: 'Ramesh' }, mother: { name: 'Lakshmi' },
      employment: { role: 'Software Engineer', designation: 'Software Engineer', company: 'Example Ltd' },
      horoscope: { rashi: 'Mesha', timeOfBirth: '06:30' },
    }));
    expect(invitations.invite).not.toHaveBeenCalled();
  });

  it('does not invent missing marital, employment or family facts', async () => {
    const { service, detailsRepo } = await setup();
    await service.create(actor, { ...dto, contactPhone: '9876543211', biodata: { firstName: 'Rahul' } });
    expect(detailsRepo.save).toHaveBeenCalledWith({ profileId: 'profile-1', biodataDocumentUrl: null, firstName: 'Rahul' });
  });

  it('maps the words a biodata uses for fixed choices', async () => {
    const { service, detailsRepo } = await setup();
    await service.create(actor, { ...dto, biodata: {
      maritalStatus: 'Never Married', occupationStatus: 'Self-Employed', familyType: 'Joint Family' } });
    expect(detailsRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      maritalStatus: 'never_married', occupationStatus: 'self_employed', familyType: 'joint' }));
  });

  it.each([
    ['occupationStatus', 'Private Job'],
    ['maritalStatus', 'Unmarried - never married'],
    ['familyType', 'Big'],
  ])('refuses an unrecognised %s with a 400 naming the field', async (field, value) => {
    const { service, transaction } = await setup();
    await expect(service.create(actor, { ...dto, biodata: { [field]: value } }))
      .rejects.toThrow(new RegExp(`biodata\\.${field}`));
    await expect(service.create(actor, { ...dto, biodata: { [field]: value } }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('propagates Biodata persistence failure without reporting success or inviting', async () => {
    const { service, detailsRepo, consent, invitations } = await setup();
    detailsRepo.save.mockRejectedValueOnce(new Error('database failure'));
    await expect(service.create(actor, { ...dto, inviteNow: true })).rejects.toThrow('database failure');
    expect(consent.record).not.toHaveBeenCalled();
    expect(invitations.invite).not.toHaveBeenCalled();
  });

  it('requires a relationship when a family member creates someone else\'s profile', async () => {
    const { service, transaction } = await setup();
    const familyActor: AuthUser = { ...actor, userId: 'family-1', role: UserRole.FAMILY };

    await expect(service.create(familyActor, { ...dto, contactPhone: '9876543212' }))
      .rejects.toThrow('Select your relationship to the person whose profile you are managing.');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('never accepts Self as a family member relationship', async () => {
    const { service, transaction } = await setup();
    const familyActor: AuthUser = { ...actor, userId: 'family-1', role: UserRole.FAMILY };

    await expect(service.create(familyActor, {
      ...dto,
      contactPhone: '9876543213',
      stewardRelation: 'Self',
    })).rejects.toThrow('Select your relationship to the person whose profile you are managing.');
    expect(transaction).not.toHaveBeenCalled();
  });

  describe('editing a client who has claimed their profile', () => {
    const claimedProfile = () => ({
      id: 'profile-1', userId: 'client-1', managedByUserId: 'agent-1',
      claimStatus: ProfileClaimStatus.CLAIMED, lifecycle: ProfileLifecycle.ACTIVE,
      displayName: 'Kamesh', contactPhone: '+919876543210', contactEmail: null,
    }) as unknown as Profile;

    it('keeps the agency able to edit while the client is still on their book', async () => {
      const { service, profileRepo } = await setup();
      profileRepo.findOne.mockResolvedValue(claimedProfile());
      const updated = await service.update(actor, 'profile-1', { displayName: 'Kamesh Rao', city: 'Hyderabad' });
      expect(updated).toMatchObject({ displayName: 'Kamesh Rao', city: 'Hyderabad', userId: 'client-1' });
      expect(service.agencyActions(claimedProfile()).canEdit).toBe(true);
      expect(service.agencyActions(claimedProfile()).canInvite).toBe(false);
    });

    it("leaves the claimed client's own contact details to them", async () => {
      const { service, profileRepo } = await setup();
      profileRepo.findOne.mockResolvedValue(claimedProfile());
      await expect(service.update(actor, 'profile-1', { contactPhone: '+919876500001' }))
        .rejects.toThrow('their contact details are theirs to change');
      // Sending the same number back, as a full form save does, is not a change.
      await expect(service.update(actor, 'profile-1', { contactPhone: '+919876543210', displayName: 'Kamesh' }))
        .resolves.toMatchObject({ displayName: 'Kamesh' });
    });

    it('stops once the engagement is closed', async () => {
      const { service, profileRepo } = await setup();
      profileRepo.findOne.mockResolvedValue({ ...claimedProfile(), lifecycle: ProfileLifecycle.ARCHIVED });
      await expect(service.update(actor, 'profile-1', { displayName: 'X' })).rejects.toThrow('engagement is closed');
    });
  });
});

describe('managed profile photographs are checked before they are saved', () => {
  const actor: AuthUser = { userId: 'agent-1', email: 'agent@example.com',
    role: UserRole.AGENT, managedByAgentId: null };
  const consent = { method: ConsentMethod.IN_PERSON, givenByRelation: ConsentRelation.SELF, givenAt: '2026-01-01' };

  async function setup(existing: Partial<Profile> | null = null) {
    const profileRepo = {
      count: jest.fn(async () => 0), find: jest.fn(async () => []),
      create: jest.fn((value: Partial<Profile>) => value),
      save: jest.fn(async (value: Partial<Profile>) => ({ ...value, id: value.id ?? 'profile-1' })),
      findOne: jest.fn(async () => existing),
    };
    const manager = { getRepository: () => profileRepo };
    const transaction = jest.fn(async (work: (value: typeof manager) => Promise<unknown>) => work(manager));
    const moderation = { assertGenuinePhotos: jest.fn(async () => undefined) };
    const module = await Test.createTestingModule({ providers: [ManagedProfilesService,
      { provide: getRepositoryToken(Profile), useValue: { ...profileRepo, manager: { transaction } } },
      { provide: getRepositoryToken(User), useValue: { findOne: jest.fn(async () => null) } },
      { provide: getRepositoryToken(AgentProfile), useValue: {} },
      { provide: AppConfigService, useValue: { stewardship: { requireAgentApproval: false, maxManagedProfiles: 100, maxManagedProfilesFamily: 5 } } },
      { provide: AuditService, useValue: { record: jest.fn() } },
      { provide: InvitationsService, useValue: { invite: jest.fn() } },
      { provide: ConsentService, useValue: { record: jest.fn() } },
      { provide: AgentBillingService, useValue: {} },
      { provide: ModerationService, useValue: moderation },
    ] }).compile();
    return { service: module.get(ManagedProfilesService), moderation, profileRepo, transaction };
  }

  it('checks intake photographs, and creates nothing when one is refused', async () => {
    const { service, moderation, transaction } = await setup();
    moderation.assertGenuinePhotos.mockRejectedValueOnce(
      new BadRequestException('This looks like an AI-generated image.'));
    await expect(service.create(actor, {
      displayName: 'Asha', contactPhone: '9876500001', consent,
      photos: ['media://users/agent-1/profile/a.png'],
    } as CreateManagedProfileDto)).rejects.toThrow('AI-generated');
    expect(moderation.assertGenuinePhotos).toHaveBeenCalledWith(
      ['media://users/agent-1/profile/a.png'], [], { userId: 'agent-1', kind: 'managed_profile' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('checks the photographs an edit adds against the ones the profile already has', async () => {
    const { service, moderation, profileRepo } = await setup({
      id: 'profile-1', managedByUserId: 'agent-1', photos: ['media://old.jpg'],
    });
    moderation.assertGenuinePhotos.mockRejectedValueOnce(
      new BadRequestException('This looks like an AI-generated image.'));
    await expect(service.update(actor, 'profile-1', { photos: ['media://old.jpg', 'media://new.png'] }))
      .rejects.toThrow('AI-generated');
    expect(moderation.assertGenuinePhotos).toHaveBeenCalledWith(
      ['media://old.jpg', 'media://new.png'], ['media://old.jpg'], { userId: 'agent-1', kind: 'managed_profile' });
    expect(profileRepo.save).not.toHaveBeenCalled();
  });
});
