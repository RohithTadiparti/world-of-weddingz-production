import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuditAction, AuditService } from './audit.service';
import { AuditEvent } from './entities/audit-event.entity';

describe('AuditService observability', () => {
  it('stays fail-open and emits one allowlisted audit failure event', async () => {
    const repo = {
      create: jest.fn((value) => value),
      save: jest.fn().mockRejectedValue(new TypeError('password=must-not-escape')),
    } as unknown as Repository<AuditEvent>;
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const service = new AuditService(repo);

    await expect(
      service.record({
        action: AuditAction.AUTH_LOGIN_FAILED,
        resourceType: 'user',
        resourceId: null,
        metadata: { password: 'must-not-escape' },
      }),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith({
      event: 'audit_write_failure',
      action: AuditAction.AUTH_LOGIN_FAILED,
      resourceType: 'user',
      resourceId: null,
      errorType: 'TypeError',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('must-not-escape');
    error.mockRestore();
  });
});

describe('AuditService list masking', () => {
  it('truncates actor addresses and masks contact details in metadata', async () => {
    const row = {
      id: 'a1',
      actorUserId: null,
      actorRole: null,
      action: AuditAction.AUTH_LOGIN_FAILED,
      resourceType: 'user',
      resourceId: null,
      metadata: { email: 'rohith@gmail.com', reason: 'bad_password' },
      ip: '203.0.113.77',
      createdAt: new Date(0),
    } as AuditEvent;
    const v6 = { ...row, id: 'a2', ip: '2001:db8:85a3::8a2e:370:7334' } as AuditEvent;
    const qb = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[row, v6], 2]),
    };
    const repo = { createQueryBuilder: jest.fn(() => qb) } as unknown as Repository<AuditEvent>;

    const result = await new AuditService(repo).list(1, 20);

    expect(result.data[0]).toMatchObject({
      ip: '203.0.113.x',
      metadata: { email: 'r***@gmail.com', reason: 'bad_password' },
    });
    expect(result.data[1].ip).toBe('2001:db8:85a3::/48');
    expect(JSON.stringify(result.data)).not.toContain('rohith@');
    // The stored row itself is untouched.
    expect(row.ip).toBe('203.0.113.77');
  });
});
