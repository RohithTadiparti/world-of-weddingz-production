import { contactMatches, contactSearchClause } from './contact-search';

describe('contactSearchClause', () => {
  const cols = { email: 'u.email', phone: 'u.phone' };

  it('matches the email case-insensitively and escapes LIKE wildcards', () => {
    expect(contactSearchClause(cols, '  R_ohith%  ')).toEqual({
      clause: '(LOWER(u.email) LIKE :contactNeedle)',
      params: { contactNeedle: '%r\\_ohith\\%%' },
    });
  });

  it('adds a digits-only phone match once the needle has three digits', () => {
    const { clause, params } = contactSearchClause(cols, '+91 98765-43210', 'n');
    expect(clause).toBe(
      "(LOWER(u.email) LIKE :n OR REGEXP_REPLACE(COALESCE(u.phone, ''), '\\D', '', 'g') LIKE :nDigits)",
    );
    expect(params).toEqual({ n: '%+91 98765-43210%', nDigits: '%919876543210%' });
    expect(contactSearchClause(cols, 'a1b2').params).not.toHaveProperty('contactNeedleDigits');
  });
});

describe('contactMatches', () => {
  const officer = { email: 'Field.Officer@wow.in', phone: '+91 98765 43210' };

  it('finds by part of the email or a run of phone digits', () => {
    expect(contactMatches(officer, 'field.off')).toBe(true);
    expect(contactMatches(officer, '43210')).toBe(true);
    expect(contactMatches(officer, '9876543210')).toBe(true);
    expect(contactMatches(officer, 'someone-else')).toBe(false);
    expect(contactMatches(officer, '12')).toBe(false);
    expect(contactMatches({ email: null, phone: null }, 'x')).toBe(false);
  });
});
