import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { ApplicantType, UserRole, VerificationStatus } from '../../common/enums';
import { roleHasPermission, Permission } from '../../common/authz/permissions';

/**
 * A field correction is part of deciding, so it is the administrator's (ISS-20).
 *
 * `requestCorrection` used to let "the allocated officer" through as well. The
 * route needs `verification:decide`, which officers do not hold, so that branch
 * could never run; it is now the same explicit administrator-only check
 * `decide` has, and the administrator's path is unchanged.
 */
describe('VerificationService.requestCorrection', () => {
  const requests = { findOne: jest.fn() };
  const service = new (VerificationService as unknown as new (...args: unknown[]) => VerificationService)(
    requests,
    ...Array(12).fill({}),
  );
  const dto = { fields: ['address'], reason: 'The address on the listing is not the premises.' };

  beforeEach(() => requests.findOne.mockReset());

  it('sits behind a permission only an administrator holds', () => {
    expect(roleHasPermission(UserRole.IN_PERSON, Permission.VERIFICATION_DECIDE)).toBe(false);
    expect(roleHasPermission(UserRole.ADMIN, Permission.VERIFICATION_DECIDE)).toBe(true);
  });

  it.each([UserRole.IN_PERSON, UserRole.AGENT, UserRole.VENDOR])(
    'refuses a %s, even the allocated one, before reading the request',
    async (role) => {
      await expect(
        service.requestCorrection({ userId: 'officer-1', role } as never, 'r1', dto as never),
      ).rejects.toThrow(new ForbiddenException('Only an administrator asks for a correction'));
      expect(requests.findOne).not.toHaveBeenCalled();
    },
  );

  it('lets an administrator through to the correction rules', async () => {
    requests.findOne.mockResolvedValue({
      id: 'r1',
      applicantType: ApplicantType.VENDOR,
      subjectId: 'vendor-1',
      status: VerificationStatus.NEW,
      assignedToUserId: null,
    });
    await expect(
      service.requestCorrection({ userId: 'admin-1', role: UserRole.ADMIN } as never, 'r1', dto as never),
    ).rejects.toThrow(new BadRequestException('Allocate this request before asking for a correction'));
    expect(requests.findOne).toHaveBeenCalled();
  });

  it('still applies only to a vendor business for an administrator', async () => {
    requests.findOne.mockResolvedValue({
      id: 'r1',
      applicantType: ApplicantType.AGENT,
      subjectId: null,
      status: VerificationStatus.SUBMITTED,
    });
    await expect(
      service.requestCorrection({ userId: 'admin-1', role: UserRole.ADMIN } as never, 'r1', dto as never),
    ).rejects.toThrow(new BadRequestException('A field correction only applies to a vendor business.'));
  });
});
