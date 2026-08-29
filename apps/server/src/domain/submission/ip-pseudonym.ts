import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The rotating IP pseudonym (blueprint 9.4).
 *
 * "Raw IP exists only during the request and in transient rate-limit
 * processing. A monthly rotating HMAC pseudonym supports short-term abuse
 * analysis without indefinite visitor linkage. HMAC secrets are derived from
 * protected environment key material and versioned by rotation period."
 *
 * Three properties, each doing a different job:
 *
 *  - HMAC rather than a plain hash, because the IPv4 space is small enough to
 *    enumerate completely. A SHA-256 of an address is not a pseudonym; it is a
 *    lookup table waiting to happen. The keyed construction is what makes the
 *    mapping unrecoverable without the secret.
 *  - Monthly rotation, because the point is short-term abuse analysis. After
 *    the period turns, the same visitor produces a different pseudonym and the
 *    old one links to nothing - which is what stops this becoming an indefinite
 *    visitor identity.
 *  - The period travels with the value, so an event written last month is still
 *    interpretable and a rotation is not a data migration.
 */

/** How the rotation period is written down: `YYYY-MM`, in UTC. */
export function pseudonymPeriod(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export interface Pseudonym {
  readonly value: string;
  readonly period: string;
}

/**
 * Derive the per-period key from long-lived master material.
 *
 * The master secret is never used to HMAC an address directly. Deriving a
 * subkey per period means a leaked period key exposes one month rather than
 * every month, and rotation needs no new secret to be provisioned.
 */
function periodKey(masterSecret: string, period: string): Buffer {
  return createHmac('sha256', masterSecret).update(`ip-pseudonym:${period}`).digest();
}

/**
 * Pseudonymise an IP address for one rotation period.
 *
 * The raw address goes in and never comes back out: callers keep the returned
 * value, never the input.
 */
export function ipPseudonym(masterSecret: string, ip: string, now: Date): Pseudonym {
  const period = pseudonymPeriod(now);
  const value = createHmac('sha256', periodKey(masterSecret, period))
    .update(ip.trim().toLowerCase())
    .digest('hex');
  return { value, period };
}

/**
 * Compare two pseudonyms without leaking where they diverge.
 *
 * Not strictly required - these are not secrets a caller submits - but they are
 * derived from key material, and comparing them in constant time costs nothing
 * while removing a class of question. `timingSafeEqual` throws on a length
 * mismatch, so the lengths are checked first rather than letting it throw.
 */
export function pseudonymsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
