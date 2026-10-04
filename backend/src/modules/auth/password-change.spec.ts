import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import { AuthController } from './auth.controller';
import { ChangePasswordDto } from './dto/auth.dto';

describe('password change endpoint', () => {
  const dto = { currentPassword: 'OldPass123', newPassword: 'NewPass456' };

  it.each(['short', 'lowercase123', 'UPPERCASE123', 'NoDigitsHere', 'A1' + 'a'.repeat(127)])(
    'rejects a new password outside the existing policy (%s)', async (newPassword) => {
      const pipe = new ValidationPipe({ transform: true, whitelist: true });
      await expect(pipe.transform({ ...dto, newPassword }, {
        type: 'body', metatype: ChangePasswordDto,
      })).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('preserves the cookie when current-password verification fails', async () => {
    const controller = Object.create(AuthController.prototype);
    controller.auth = { changePassword: jest.fn().mockRejectedValue(
      new BadRequestException('Current password is incorrect.'),
    ) };
    const clearCookie = jest.fn();
    await expect(controller.changePassword('u1', dto, { clearCookie } as unknown as Response))
      .rejects.toThrow('Current password is incorrect.');
    expect(clearCookie).not.toHaveBeenCalled();
  });

  it('clears the cookie only after the password change completes', async () => {
    const controller = Object.create(AuthController.prototype);
    const clearCookie = jest.fn();
    controller.cfg = { auth: { refreshCookieName: 'refresh' }, runtime: { apiPrefix: 'api' } };
    controller.auth = { changePassword: jest.fn(async () => {
      expect(clearCookie).not.toHaveBeenCalled();
      return { success: true };
    }) };
    await expect(controller.changePassword('u1', dto, { clearCookie } as unknown as Response))
      .resolves.toEqual({ success: true });
    expect(clearCookie).toHaveBeenCalled();
  });
});
