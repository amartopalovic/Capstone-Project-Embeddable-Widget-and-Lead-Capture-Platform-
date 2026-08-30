import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed consent links (blueprint 4.8).
 *
 * Unsubscribe and double opt-in links are STATELESS: the token carries the ids
 * it refers to and a signature over them, rather than being a random string
 * looked up in a table. Two reasons, both practical.
 *
 * An unsubscribe link has to keep working. It sits in every marketing email a
 * contact has ever received, including ones from a year ago, and a stored token
 * that expired or was consumed would turn "unsubscribe" into a dead link -
 * which is the one thing an unsubscribe must never be. A signature has no
 * expiry to get wrong.
 *
 * And storing one row per emailed link would mean a table that grows with send
 * volume and has to be swept, to solve a problem a 256-bit MAC already solves.
 *
 * Replay is handled by the state machine rather than by consuming a token: a
 * second click on an unsubscribe link finds the contact already withdrawn and
 * says so. That is the correct behaviour anyway - a person clicking twice
 * should be reassured, not shown an error.
 *
 * The email-verified EXPORT and DELETION flow does not use this. That one
 * carries a stored, expiring, single-use token, because it authorizes reading
 * or destroying somebody's data rather than setting a boolean, and blueprint
 * 4.8 calls for verification of the same rigor as account email verification.
 */

export const CONSENT_LINK_PURPOSES = ['unsubscribe', 'confirm'] as const;
export type ConsentLinkPurpose = (typeof CONSENT_LINK_PURPOSES)[number];

export interface ConsentLinkClaims {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly purpose: ConsentLinkPurpose;
}

function payloadOf(claims: ConsentLinkClaims): string {
  return `${claims.purpose}:${claims.workspaceId}:${claims.contactId}`;
}

function sign(secret: string, payload: string): string {
  // Domain-separated from the pseudonym and suppression keys, which derive from
  // the same master secret.
  const key = createHmac('sha256', secret).update('consent-link').digest();
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/** Build the opaque token that goes in an emailed link. */
export function signConsentLink(secret: string, claims: ConsentLinkClaims): string {
  const payload = payloadOf(claims);
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(secret, payload)}`;
}

/**
 * Recover the claims from a token, or null.
 *
 * Returns null for anything that is not exactly a valid token: wrong shape,
 * bad signature, unknown purpose, malformed ids. The caller cannot tell which,
 * which is deliberate - a token that reports WHY it failed helps somebody
 * probing for valid contact ids.
 */
export function verifyConsentLink(secret: string, token: string): ConsentLinkClaims | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;

  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let payload: string;
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expected = sign(secret, payload);
  const left = Buffer.from(signature, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;

  const parts = payload.split(':');
  const [purpose, workspaceId, contactId] = parts;
  if (parts.length !== 3 || workspaceId === undefined || contactId === undefined) return null;
  if (purpose !== 'unsubscribe' && purpose !== 'confirm') return null;
  if (!/^[0-9a-f]{24}$/.test(workspaceId) || !/^[0-9a-f]{24}$/.test(contactId)) return null;

  return { purpose, workspaceId, contactId };
}
