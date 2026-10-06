import { ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { UsersService } from './users.service';
import { Profile } from './entities/profile.entity';
import { User } from '../auth/entities/user.entity';

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
    const service = new UsersService(
      profiles,
      {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, users, {} as never, {} as never, {} as never,
    );

    await expect(service.upsert('user-1', { contactPhone: '9505877151' })).rejects.toBeInstanceOf(ConflictException);
    expect(profiles.save).not.toHaveBeenCalled();
  });
});
