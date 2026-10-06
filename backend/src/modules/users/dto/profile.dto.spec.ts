import { ValidationPipe } from '@nestjs/common';
import { CreateProfileDto } from './profile.dto';

describe('profile date validation', () => {
  it('rejects a date that is older than the supported 75-year range', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    await expect(pipe.transform({ displayName: 'Test User', dateOfBirth: '1950-01-01' }, {
      type: 'body', metatype: CreateProfileDto,
    })).rejects.toThrow();
  });
});
