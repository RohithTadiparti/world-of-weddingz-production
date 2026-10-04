import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../config/app-config.service';
import { UserRole } from '../../common/enums';
import { User } from '../auth/entities/user.entity';
import { ADMIN_COUNTS_POLL_MS, AdminCountsGateway } from './admin-counts.gateway';
import { AdminPendingCountsService } from './admin-pending-counts.service';

describe('AdminCountsGateway', () => {
  const getCounts = jest.fn(async () => ({ users: 1 }));
  const emit = jest.fn();
  let gateway: AdminCountsGateway;

  const socket = (userId: string) =>
    ({
      handshake: { auth: { token: userId }, headers: {} },
      data: {},
      join: jest.fn(),
      disconnect: jest.fn(),
    }) as unknown as Socket;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    gateway = new AdminCountsGateway(
      { verifyAsync: jest.fn(async (token: string) => ({ sub: token })) } as unknown as JwtService,
      { auth: { jwtSecret: 'secret' } } as unknown as AppConfigService,
      { getCounts } as unknown as AdminPendingCountsService,
      {
        findOne: jest.fn(async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          role: UserRole.ADMIN,
          isActive: true,
        })),
      } as unknown as Repository<User>,
    );
    gateway.server = { to: jest.fn(() => ({ emit })) } as unknown as Server;
  });

  afterEach(() => {
    gateway.onModuleDestroy();
    jest.useRealTimers();
  });

  it('counts nothing while no administrator is connected', async () => {
    jest.advanceTimersByTime(ADMIN_COUNTS_POLL_MS * 3);
    await Promise.resolve();
    expect(getCounts).not.toHaveBeenCalled();
  });

  it('polls only the connected administrators, and stops when the last one leaves', async () => {
    const first = socket('admin-1');
    await gateway.handleConnection(first);
    expect(getCounts).toHaveBeenCalledTimes(1);
    expect(gateway.connectedAdmins()).toEqual(['admin-1']);

    jest.advanceTimersByTime(ADMIN_COUNTS_POLL_MS);
    await Promise.resolve();
    expect(getCounts).toHaveBeenCalledTimes(2);
    expect(getCounts).toHaveBeenLastCalledWith('admin-1');

    gateway.handleDisconnect(first);
    expect(gateway.connectedAdmins()).toEqual([]);
    jest.advanceTimersByTime(ADMIN_COUNTS_POLL_MS * 3);
    await Promise.resolve();
    expect(getCounts).toHaveBeenCalledTimes(2);
  });

  it('keeps polling while another tab of the same administrator is open', async () => {
    const one = socket('admin-1');
    const two = socket('admin-1');
    await gateway.handleConnection(one);
    await gateway.handleConnection(two);
    gateway.handleDisconnect(one);
    expect(gateway.connectedAdmins()).toEqual(['admin-1']);
  });
});
