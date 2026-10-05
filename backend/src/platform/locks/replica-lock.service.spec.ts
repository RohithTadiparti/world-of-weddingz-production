import { DataSource, QueryRunner } from 'typeorm';
import { ReplicaLockService } from './replica-lock.service';

describe('ReplicaLockService', () => {
  const runner = (acquired: boolean) =>
    ({
      connect: jest.fn(),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ acquired }])
        .mockResolvedValueOnce([{ pg_advisory_unlock: true }]),
      release: jest.fn(),
    }) as unknown as QueryRunner;

  it('executes a job and releases its connection when this replica owns the lock', async () => {
    const queryRunner = runner(true);
    const source = { createQueryRunner: () => queryRunner } as DataSource;
    const work = jest.fn().mockResolvedValue('done');

    await expect(new ReplicaLockService(source).runExclusive('jobs:payouts', work)).resolves.toBe(
      'done',
    );
    expect(work).toHaveBeenCalledTimes(1);
    expect(queryRunner.query).toHaveBeenLastCalledWith(
      'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
      ['jobs:payouts'],
    );
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('does not execute the same job on a second worker', async () => {
    const queryRunner = runner(false);
    const source = { createQueryRunner: () => queryRunner } as DataSource;
    const work = jest.fn();

    await expect(
      new ReplicaLockService(source).runExclusive('outbox:dispatch', work),
    ).resolves.toBe(undefined);
    expect(work).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('always unlocks and releases after a failed job', async () => {
    const queryRunner = runner(true);
    const source = { createQueryRunner: () => queryRunner } as DataSource;

    await expect(
      new ReplicaLockService(source).runExclusive('jobs:notifications', async () => {
        throw new Error('provider unavailable');
      }),
    ).rejects.toThrow('provider unavailable');
    expect(queryRunner.query).toHaveBeenCalledTimes(2);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });
});
