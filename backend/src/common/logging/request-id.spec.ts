import { isValidRequestId, resolveRequestId } from './request-id';

describe('request ids', () => {
  it('preserves a bounded log-safe caller id', () => {
    expect(isValidRequestId('qa-7f63c9')).toBe(true);
    expect(resolveRequestId('qa-7f63c9')).toBe('qa-7f63c9');
  });

  it.each([undefined, 7, '', 'has space', 'line\nbreak', 'comma,value', 'x'.repeat(129)])(
    'replaces hostile or missing value %p with a UUID',
    (value) => expect(resolveRequestId(value)).toMatch(/^[0-9a-f-]{36}$/),
  );
});
