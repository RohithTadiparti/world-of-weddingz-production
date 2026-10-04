import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

/**
 * Opaque single-use tokens (invitations, email verification, password reset,
 * guest RSVP links).
 *
 * The plaintext is returned once, to be emailed, and only its SHA-256 is
 * persisted. SHA-256 rather than bcrypt is deliberate: these are 256 bits of
 * CSPRNG output, not user-chosen secrets, so there is nothing to brute-force
 * and a lookup by hash stays a single indexed query.
 */
export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Keyed lookup hash for long-lived bearer credentials such as refresh JWTs. */
export function hashSecretToken(token: string, key: string): string {
  return createHmac('sha256', key).update(token).digest('hex');
}

function cookieKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'utf8'),
      Buffer.from('world-of-weddingz-auth', 'utf8'),
      Buffer.from('refresh-cookie-v1', 'utf8'),
      32,
    ),
  );
}

/** Encrypts a refresh credential before it is persisted by the browser. */
export function sealTokenForCookie(token: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cookieKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

/** Authenticates and decrypts a browser refresh cookie. */
export function unsealTokenFromCookie(value: string, secret: string): string | undefined {
  try {
    const [version, iv, tag, ciphertext] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext) return undefined;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      cookieKey(secret),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return undefined;
  }
}

/** Constant-time comparison for any secret compared outside the database. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function expiresIn(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}
