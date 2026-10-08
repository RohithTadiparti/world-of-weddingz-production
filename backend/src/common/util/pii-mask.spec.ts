import { maskEmail, maskIp, maskPhone, maskPii } from './pii-mask';

describe('pii masking', () => {
  it('masks an email down to its first letter and domain', () => {
    expect(maskEmail('rohith@gmail.com')).toBe('r***@gmail.com');
    expect(maskEmail('  Person@Example.org ')).toBe('P***@Example.org');
    expect(maskEmail('not-an-address')).toBe('***');
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail('')).toBeNull();
  });

  it('keeps only the last four digits of a phone number', () => {
    expect(maskPhone('9876543210')).toBe('******3210');
    expect(maskPhone('+91 98765 43210')).toBe('********3210');
    expect(maskPhone('123')).toBe('***');
    expect(maskPhone(undefined)).toBeNull();
  });

  it('truncates IPv4 to its /24', () => {
    expect(maskIp('203.0.113.77')).toBe('203.0.113.x');
    expect(maskIp('::ffff:198.51.100.4')).toBe('::ffff:198.51.100.x');
  });

  it('truncates IPv6 to its first three hextets', () => {
    expect(maskIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:85a3::/48');
    expect(maskIp('2001:0DB8::1')).toBe('2001:db8:0::/48');
    expect(maskIp('::1')).toBe('0:0:0::/48');
    expect(maskIp('fe80::1%eth0')).toBe('fe80:0:0::/48');
  });

  it('never passes an unparseable address through', () => {
    expect(maskIp('garbage')).toBe('***');
    expect(maskIp(null)).toBeNull();
  });

  it('masks contact details anywhere in a metadata bag, by key and by shape', () => {
    const masked = maskPii({
      email: 'rohith@gmail.com',
      contactPhone: '+919876543210',
      hasEmail: true,
      region: 'Hyderabad',
      status: 'approved',
      nested: { invitee: 'someone@example.org', mobile: '9123456789', amount: 1000 },
      list: [{ ip: '203.0.113.9' }],
      when: new Date(0),
    });

    expect(masked).toEqual({
      email: 'r***@gmail.com',
      contactPhone: '********3210',
      hasEmail: true,
      region: 'Hyderabad',
      status: 'approved',
      nested: { invitee: 's***@example.org', mobile: '******6789', amount: 1000 },
      list: [{ ip: '203.0.113.x' }],
      when: new Date(0),
    });
  });

  it('does not mutate its input', () => {
    const original = { email: 'rohith@gmail.com' };
    maskPii(original);
    expect(original.email).toBe('rohith@gmail.com');
  });
});
