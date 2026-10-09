import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, ROLE_PERMISSIONS } from '../../common/authz/permissions';
import { UserRole } from '../../common/enums';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { OperationsController } from './operations.controller';
import { OperationsDashboardService } from './operations-dashboard.service';

type Handler = keyof OperationsController;
const HANDLERS: Handler[] = ['status', 'alerts', 'acknowledge', 'migrationReadiness'];

describe('OperationsController authorization', () => {
  const guard = new PermissionsGuard(new Reflector());

  const context = (handler: Handler, user: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => OperationsController.prototype[handler],
      getClass: () => OperationsController,
    }) as unknown as ExecutionContext;

  it.each(HANDLERS)('lets an administrator reach %s', (handler) => {
    expect(guard.canActivate(context(handler, { userId: 'admin-1', role: UserRole.ADMIN }))).toBe(true);
  });

  const nonAdmins = Object.values(UserRole).filter((role) => role !== UserRole.ADMIN);
  it.each(HANDLERS.flatMap((handler) => nonAdmins.map((role) => [handler, role] as const)))(
    'refuses %s to %s',
    (handler, role) => {
      expect(() => guard.canActivate(context(handler, { userId: 'u-1', role }))).toThrow(ForbiddenException);
    },
  );

  it.each(HANDLERS)('refuses %s without an authenticated user', (handler) => {
    expect(() => guard.canActivate(context(handler, undefined))).toThrow(ForbiddenException);
  });

  /**
   * Roles map to permissions, so an administrator who lacks the read
   * permission is modelled by withholding it from the admin row for the
   * length of the test. The route must ask for the permission, not the role.
   */
  it.each(HANDLERS)('refuses %s to an administrator without admin:infrastructure:read', (handler) => {
    const matrix = ROLE_PERMISSIONS as Record<UserRole, readonly Permission[]>;
    const original = matrix[UserRole.ADMIN];
    matrix[UserRole.ADMIN] = original.filter((p) => p !== Permission.ADMIN_INFRASTRUCTURE_READ);
    try {
      expect(() => guard.canActivate(context(handler, { userId: 'admin-2', role: UserRole.ADMIN }))).toThrow(
        /admin:infrastructure:read/,
      );
    } finally {
      matrix[UserRole.ADMIN] = original;
    }
  });

  it('requires the read permission on the class and exposes no migrate-only action', () => {
    const reflector = new Reflector();
    expect(reflector.get('permissions', OperationsController)).toEqual([Permission.ADMIN_INFRASTRUCTURE_READ]);
    for (const handler of HANDLERS) {
      const own = reflector.get<Permission[] | undefined>('permissions', OperationsController.prototype[handler]);
      expect(own ?? []).not.toContain(Permission.ADMIN_INFRASTRUCTURE_MIGRATE);
    }
  });
});

describe('OperationsController delegation', () => {
  it('acknowledges as the authenticated actor', async () => {
    const dashboard = { acknowledge: jest.fn().mockResolvedValue({ changed: true }) };
    const controller = new OperationsController(dashboard as unknown as OperationsDashboardService);
    await controller.acknowledge({ userId: 'actor-1', role: UserRole.ADMIN } as never, 'alert-1');
    expect(dashboard.acknowledge).toHaveBeenCalledWith('alert-1', 'actor-1');
  });

  it('passes the status filter through', async () => {
    const dashboard = { list: jest.fn().mockResolvedValue({ data: [], total: 0 }) };
    const controller = new OperationsController(dashboard as unknown as OperationsDashboardService);
    await controller.alerts({ status: 'active' });
    expect(dashboard.list).toHaveBeenCalledWith('active');
  });
});
