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
