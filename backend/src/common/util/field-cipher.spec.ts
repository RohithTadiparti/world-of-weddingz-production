import { maskAccountNumber, openField, sealField } from './field-cipher';

describe('field cipher', () => {
  const key = 'a-configured-secret-that-is-long-enough';

  it('opens what it sealed, and never stores the plain value', () => {
    const sealed = sealField('123456789012', key);
    expect(sealed).not.toContain('123456789012');
    expect(openField(sealed, key)).toBe('123456789012');
  });

  it('seals the same value differently each time', () => {
    expect(sealField('123456789012', key)).not.toBe(sealField('123456789012', key));
  });

  it('refuses to open under another key or after tampering', () => {
    const sealed = sealField('123456789012', key);
    expect(() => openField(sealed, 'another-secret-entirely-000000000')).toThrow();
    const parts = sealed.split(':');
    parts[3] = Buffer.from('999999999999').toString('base64');
    expect(() => openField(parts.join(':'), key)).toThrow();
  });

  it('masks all but the last four digits', () => {
    expect(maskAccountNumber('123456789012')).toBe('XXXX9012');
  });
});
