import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Reversible encryption for the few values the platform has to hand back to a
 * payment gateway later, such as a payout bank account number.
 *
 * Unlike a government id (see government-id.ts), a bank account number cannot
 * be kept as a one-way hash: the gateway needs the real number to create the
 * linked account. So it is sealed with AES-256-GCM under a key that lives in
 * configuration, not the database, and a database leak alone yields nothing
 * usable. GCM also authenticates, so a tampered value fails to open rather
 * than opening to something else.
 *
 * Stored form: `v1:<iv>:<tag>:<ciphertext>`, each part base64.
 */

const VERSION = 'v1';

/** Any configured secret, stretched to the 32 bytes AES-256 takes. */
function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function sealField(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), body.toString('base64')].join(':');
}

export function openField(sealed: string, secret: string): string {
  const [version, iv, tag, body] = sealed.split(':');
  if (version !== VERSION || !iv || !tag || body === undefined) {
    throw new Error('Not a sealed value');
  }
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
}

/** The last four digits behind a mask, which is all a response ever carries. */
export function maskAccountNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  return `XXXX${digits.slice(-4)}`;
}
