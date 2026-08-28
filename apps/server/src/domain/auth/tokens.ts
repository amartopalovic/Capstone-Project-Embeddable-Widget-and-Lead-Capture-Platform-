import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Single-use token generation and hashing.
 *
 * The plaintext token goes only into an emailed link. Only its SHA-256 hash is
 * persisted, so a database disclosure cannot be replayed into account takeover
 * (blueprint section 17).
 *
 * SHA-256 without a salt is correct here, unlike for passwords: the token is
 * 256 bits of cryptographic randomness, so it has no guessable structure for a
 * brute-force or rainbow-table attack to exploit, and an unsalted hash keeps
 * the lookup a single indexed query.
 */

/** 32 bytes of entropy, url-safe. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison, so a comparison cannot leak position information. */
export function tokenHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const EMAIL_VERIFICATION_TTL_HOURS = 24;
export const PASSWORD_RESET_TTL_HOURS = 1;

export function expiryFromNow(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

export function isExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}
