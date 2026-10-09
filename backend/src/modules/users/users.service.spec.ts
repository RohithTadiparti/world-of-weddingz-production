import { ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { UsersService } from './users.service';
import { Profile } from './entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { UserRole } from '../../common/enums';

const serviceWith = (profiles: object, users: object) =>
  new UsersService(
    profiles as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    {} as never, users as never, {} as never, {} as never, {} as never,
  );

describe('UsersService profile identity guards', () => {
  it('rejects a profile mobile already owned by another account', async () => {
    const profile = { id: 'profile-1', userId: 'user-1', photos: [] } as unknown as Profile;
    const profiles = {
      findOne: jest.fn()
        .mockResolvedValueOnce(profile)
        .mockResolvedValueOnce(null),
      save: jest.fn(),
    } as unknown as Repository<Profile>;
    const users = {
      findOne: jest.fn().mockResolvedValue({ id: 'user-2', phone: '+919505877151' }),
    } as unknown as Repository<User>;
    const service = serviceWith(profiles, users);

    await expect(service.upsert('user-1', { contactPhone: '9505877151' })).rejects.toBeInstanceOf(ConflictException);
    expect(profiles.save).not.toHaveBeenCalled();
  });
});

/**
 * The mobile number lives on the account row as well as the profile, and the
 * account row is the one /auth/me, phone verification and every staff roster
 * read. Saving the profile alone left all of those on the previous number.
 */
describe('UsersService profile phone follows the account', () => {
  it('moves the account phone with the profile and un-verifies it', async () => {
    const profile = { id: 'profile-1', userId: 'user-1', photos: [] } as unknown as Profile;
    const profiles = {
      findOne: jest.fn()
        .mockResolvedValueOnce(profile)
        .mockResolvedValueOnce(null),
      save: jest.fn(async (x: Profile) => x),
    } as unknown as Repository<Profile>;
    const account = {
      id: 'user-1',
      phone: '+919800000000',
      phoneVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const users = {
      findOne: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(account),
      save: jest.fn(async (x: User) => x),
    } as unknown as Repository<User>;
    const service = serviceWith(profiles, users);

    await service.upsert('user-1', { contactPhone: '9505877151' });

    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1', phone: '+919505877151', phoneVerifiedAt: null }),
    );
    expect(profiles.save).toHaveBeenCalledWith(
      expect.objectContaining({ contactPhone: '+919505877151' }),
    );
  });

  it('leaves the account alone when the profile already holds its number', async () => {
    const profile = { id: 'profile-1', userId: 'user-1', photos: [] } as unknown as Profile;
    const profiles = {
      findOne: jest.fn()
        .mockResolvedValueOnce(profile)
        .mockResolvedValueOnce(null),
      save: jest.fn(async (x: Profile) => x),
    } as unknown as Repository<Profile>;
    const users = {
      findOne: jest.fn().mockResolvedValue({ id: 'user-1', phone: '+919505877151' }),
      save: jest.fn(async (x: User) => x),
    } as unknown as Repository<User>;
    const service = serviceWith(profiles, users);

    await service.upsert('user-1', { contactPhone: '9505877151' });

    expect(users.save).not.toHaveBeenCalled();
  });
});

/**
 * The Support badge for an officer counts the cases they raised, not their
 * allocated queue a second time — the two pages show different work.
 */
describe('UsersService navigationCounts for an officer', () => {
  it('counts raised cases for /support and allocated ones for /cases', async () => {
    const cases = {
      count: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(1),
    };
    const notifications = { count: jest.fn().mockResolvedValue(0) };
    const service = new UsersService(
      {} as never, {} as never, {} as never, cases as never, {} as never, {} as never,
      notifications as never, {} as never, {} as never, {} as never, {} as never,
    );

    const counts = await service.navigationCounts({ userId: 'officer-1', role: UserRole.IN_PERSON });

    expect(cases.count).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({ assignedToUserId: 'officer-1' }),
    });
    expect(cases.count).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({ raisedByUserId: 'officer-1' }),
    });
    expect(counts['/support']).toBe(1);
    expect(counts['/cases']).toBe(3);
  });
});
