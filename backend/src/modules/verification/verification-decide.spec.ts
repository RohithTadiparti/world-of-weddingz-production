import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { UserRole, VerificationStatus } from '../../common/enums';
import { roleHasPermission, Permission } from '../../common/authz/permissions';

/**
 * The officer recommends; the administrator decides (ISS-20).
 *
 * `decide` used to carry an "allocated officer may decide" branch. Officers do
 * not hold `verification:decide`, so the guard stopped them first and the
 * branch was dead; it is now an explicit administrator-only check.
 */
describe('VerificationService.decide', () => {
  const requests = { findOne: jest.fn() };
  const service = new (VerificationService as unknown as new (...args: unknown[]) => VerificationService)(
    requests,
    ...Array(12).fill({}),
  );

  beforeEach(() => requests.findOne.mockReset());

  it('is not a permission an officer holds', () => {
    expect(roleHasPermission(UserRole.IN_PERSON, Permission.VERIFICATION_DECIDE)).toBe(false);
    expect(roleHasPermission(UserRole.ADMIN, Permission.VERIFICATION_DECIDE)).toBe(true);
  });

  it('refuses an officer, even the allocated one, before reading the request', async () => {
    await expect(
      service.decide({ userId: 'officer-1', role: UserRole.IN_PERSON } as never, 'r1', {
        status: VerificationStatus.APPROVED,
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(requests.findOne).not.toHaveBeenCalled();
  });

  it('lets an administrator through to the decision rules', async () => {
    requests.findOne.mockResolvedValue({
      id: 'r1',
      status: VerificationStatus.SUBMITTED,
      assignedToUserId: 'officer-1',
      findings: null,
    });
    await expect(
      service.decide({ userId: 'admin-1', role: UserRole.ADMIN } as never, 'r1', {
        status: VerificationStatus.APPROVED,
      } as never),
    ).rejects.toThrow(new BadRequestException('Nobody has submitted findings for this request yet. It cannot be approved.'));
  });
});
