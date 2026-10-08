import { isIP } from 'node:net';
import { maskEmail as maskLoggedEmail } from '../logging/log-redaction';

/**
 * Masking for personal data shown on administrator surfaces.
 *
 * An administrator needs to recognise a person ("the r***@gmail.com account,
 * the one ending 3210") far more often than they need the whole address, and a
 * screen that shows everything verbatim is a screen whose screenshots leak it.
 * So the audit trail and the account detail show these forms by default, and
 * the full value is a separate, permission-gated and audited read.
 *
 * Every helper is total: a value it does not recognise is masked completely
 * rather than passed through, because "could not parse it" must never mean
 * "showed it in full".
 */

const FULLY_MASKED = '***';

/** `rohith@gmail.com` -> `r***@gmail.com`. The domain stays: it is rarely the secret. */
export function maskEmail(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return maskLoggedEmail(String(value).trim());
}

/**
 * `+91 98765 43210` -> `********3210`.
 *
 * Every digit but the last four becomes a star, so the length still reads as
 * a phone number; spacing and the `+` are dropped because they are formatting,
 * not data.
 */
export function maskPhone(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length <= 4) return FULLY_MASKED;
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/** Expands `2001:db8::1` into its eight hextets. */
function ipv6Hextets(value: string): string[] {
  const [head, tail] = value.split('::');
  const left = head ? head.split(':') : [];
  const right = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map((h) => h.toLowerCase().replace(/^0+(?=.)/, ''));
}

/**
 * Truncates an address to the network it came from.
 *
 * IPv4 keeps its /24 (`203.0.113.7` -> `203.0.113.x`), IPv6 its /48
 * (`2001:db8:85a3::8a2e:370:7334` -> `2001:db8:85a3::/48`). That is still
 * enough to see that a run of failed sign-ins came from one place, which is
 * what the trail is read for, without identifying a household.
 */
export function maskIp(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const ip = String(value).trim();
  const version = isIP(ip);
  if (version === 4) {
    return `${ip.split('.').slice(0, 3).join('.')}.x`;
  }
  if (version === 6) {
    // An IPv4 client seen through a dual-stack socket: mask the IPv4 part.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return `::ffff:${maskIp(mapped[1])}`;
    const hextets = ipv6Hextets(ip.split('%')[0]);
    return `${hextets.slice(0, 3).join(':')}::/48`;
  }
  return FULLY_MASKED;
}

const EMAIL_KEY = /e-?mail/i;
const PHONE_KEY = /phone|mobile|whatsapp/i;
const IP_KEY = /^ip$|Ip$|^ipAddress$|^remoteAddr/i;
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A copy of a metadata bag with contact details masked, at any depth.
 *
 * Keyed on the field name (`email`, `contactPhone`, `ip`) because that is how
 * the platform writes them, and additionally on shape for a bare string that is
 * an email address under some other name. Booleans, numbers and ids pass
 * through untouched: `hasEmail: true` is not personal data.
 */
export function maskPii<T>(value: T, key = ''): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => maskPii(item, key)) as unknown as T;
  }
  if (typeof value === 'object') {
    if (value instanceof Date) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, maskPii(v, k)]),
    ) as T;
  }
  if (typeof value !== 'string') return value;
  if (EMAIL_KEY.test(key) || LOOKS_LIKE_EMAIL.test(value.trim())) {
    return maskEmail(value) as unknown as T;
  }
  if (PHONE_KEY.test(key)) return maskPhone(value) as unknown as T;
  if (IP_KEY.test(key)) return maskIp(value) as unknown as T;
  return value;
}
