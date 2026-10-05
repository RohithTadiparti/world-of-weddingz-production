import { correlatedHeaders, currentRequestId, runWithRequestId } from './request-context';

describe('request context', () => {
  it('keeps correlation through awaited work without mutating input headers', async () => {
    const base = { Authorization: 'Bearer provider-secret' };
    await runWithRequestId('request-7', async () => {
      await Promise.resolve();
      expect(currentRequestId()).toBe('request-7');
      const headers = correlatedHeaders(base);
      expect(headers.get('x-request-id')).toBe('request-7');
      expect(headers.get('authorization')).toBe('Bearer provider-secret');
    });
    expect(base).toEqual({ Authorization: 'Bearer provider-secret' });
  });
});
