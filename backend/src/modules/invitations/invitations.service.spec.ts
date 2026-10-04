/* eslint-disable @typescript-eslint/no-explicit-any -- repository doubles keep these focused service tests small. */
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { Invitation } from './entities/invitation.entity';
import { Profile } from '../users/entities/profile.entity';
import { InvitationStatus } from '../../common/enums';

const pendingSmsInvitation = () => ({
  id: 'invite-1',
  profileId: 'profile-1',
  email: null,
  phone: '+919876543210',
  tokenHash: 'token-hash',
  status: InvitationStatus.PENDING,
  invitedByUserId: 'agent-1',
  expiresAt: new Date(Date.now() + 60_000),
});

describe('InvitationsService OTP verification', () => {
  const makeService = (raw?: Record<string, jest.Mock>) => {
    const invitations = { findOne: jest.fn() };
    const profiles = { findOne: jest.fn() };
    const users = { findOne: jest.fn() };
    const sms = { sendPhoneVerification: jest.fn().mockResolvedValue(true) };
    const audit = { record: jest.fn() };
    const service = new InvitationsService(
      invitations as any,
      profiles as any,
      users as any,
      { auth: { bcryptRounds: 4 } } as any,
      {} as any,
      sms as any,
      audit as any,
      {} as any,
      { raw } as any,
    );
    return { service, invitations, sms };
  };

  it('does not send or disclose an OTP when Redis is unavailable', async () => {
    const { service, invitations, sms } = makeService();
    invitations.findOne.mockResolvedValue(pendingSmsInvitation());

    await expect(service.sendOtp('token')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(sms.sendPhoneVerification).not.toHaveBeenCalled();
  });

  it('sends an SMS-only OTP without returning it and clears prior attempts', async () => {
    const transaction = {
      set: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const { service, invitations, sms } = makeService({ multi: jest.fn(() => transaction) });
    invitations.findOne.mockResolvedValue(pendingSmsInvitation());

    await expect(service.sendOtp('token')).resolves.toEqual({ sent: true });
    expect(transaction.del).toHaveBeenCalledWith('invitation:otp:attempts:invite-1');
    expect(sms.sendPhoneVerification).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+919876543210', code: expect.any(String) }),
    );
  });

  it('reports an SMS gateway failure instead of claiming the code was sent', async () => {
    const transaction = {
      set: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const del = jest.fn().mockResolvedValue(1);
    const { service, invitations, sms } = makeService({ multi: jest.fn(() => transaction), del });
    invitations.findOne.mockResolvedValue(pendingSmsInvitation());
    sms.sendPhoneVerification.mockResolvedValueOnce(false);

    await expect(service.sendOtp('token')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(del).toHaveBeenCalledWith('invitation:otp:invite-1');
  });

  it('uses Redis atomically, allows an early success, and locks after five failures', async () => {
    const evalMock = jest.fn()
      .mockResolvedValueOnce([0, 1])
      .mockResolvedValueOnce([1, 0])
      .mockResolvedValueOnce([0, 5]);
    const { service } = makeService({ eval: evalMock });
    const verify = (service as any).verifyInvitationOtp.bind(service);

    await expect(verify('invite-1', '000000')).resolves.toBe(false);
    await expect(verify('invite-1', '123456')).resolves.toBe(true);
    await expect(verify('invite-1', '000000')).rejects.toBeInstanceOf(BadRequestException);
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR'"),
      2,
      'invitation:otp:invite-1',
      'invitation:otp:attempts:invite-1',
      expect.any(String),
      '600',
      '5',
    );
  });

  it('requires a verified OTP before an SMS-only invitation can create an account', async () => {
    const invitation = pendingSmsInvitation();
    const profile = {
      id: invitation.profileId,
      contactPhone: invitation.phone,
      contactEmail: null,
      userId: null,
      gender: 'Female',
    };
    const invitationRepo = { findOne: jest.fn().mockResolvedValue(invitation), save: jest.fn() };
    const profileRepo = { findOne: jest.fn().mockResolvedValue(profile), save: jest.fn() };
    const userRepo = { findOne: jest.fn().mockResolvedValue(null), create: jest.fn(), save: jest.fn() };
    const manager = {
      getRepository: jest.fn((entity) => entity === Invitation
        ? invitationRepo : entity === Profile ? profileRepo : userRepo),
    };
    const dataSource = { transaction: jest.fn((work) => work(manager)) };
    const service = new InvitationsService(
      {} as any, {} as any, {} as any, { auth: { bcryptRounds: 4 } } as any,
      {} as any, {} as any, { record: jest.fn() } as any, dataSource as any,
      { raw: { eval: jest.fn() } } as any,
    );

    await expect(service.accept('token', 'StrongPass1!')).rejects.toBeInstanceOf(BadRequestException);
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('marks a phone verified only after a correct SMS-only OTP', async () => {
    const invitation = pendingSmsInvitation();
    const profile = {
      id: invitation.profileId,
      contactPhone: invitation.phone,
      contactEmail: null,
      userId: null,
      gender: 'Female',
    };
    const invitationRepo = { findOne: jest.fn().mockResolvedValue(invitation), save: jest.fn() };
    const profileRepo = { findOne: jest.fn().mockResolvedValue(profile), save: jest.fn() };
    const userRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn((value) => ({ ...value, id: 'user-1' })),
    };
    const manager = {
      getRepository: jest.fn((entity) => entity === Invitation
        ? invitationRepo : entity === Profile ? profileRepo : userRepo),
    };
    const service = new InvitationsService(
      {} as any, {} as any, {} as any, { auth: { bcryptRounds: 4 } } as any,
      {} as any, {} as any, { record: jest.fn() } as any,
      { transaction: jest.fn((work) => work(manager)) } as any,
      { raw: { eval: jest.fn().mockResolvedValue([1, 0]) } } as any,
    );

    await service.accept('token', 'StrongPass1!', undefined, '123456');
    expect(userRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      phoneVerifiedAt: expect.any(Date),
      emailVerifiedAt: null,
    }));
  });
});
