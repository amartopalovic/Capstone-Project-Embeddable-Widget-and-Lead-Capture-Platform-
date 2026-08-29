import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook request signing (blueprint 12.4).
 *
 * "Each request includes an HMAC-SHA256 signature and timestamp using a
 * rotatable per-webhook secret."
 *
 * The timestamp is inside the signed material, not merely sent beside it. A
 * signature over the body alone is replayable forever: anyone who captures one
 * valid request can resend it indefinitely and the signature still verifies.
 * Signing `timestamp.body` and having the receiver reject old timestamps is
 * what bounds that window, and it is the convention Stripe and GitHub both
 * settled on for the same reason.
 */

export const SIGNATURE_HEADER = 'x-lcp-signature';
export const TIMESTAMP_HEADER = 'x-lcp-timestamp';
export const SIGNATURE_VERSION = 'v1';

/** How much clock skew a receiver should tolerate, published in our docs. */
export const REPLAY_WINDOW_SECONDS = 300;

/**
 * The exact bytes that get signed.
 *
 * Separated by a character that cannot appear in the decimal timestamp, so
 * `1.23` and `12.3` cannot produce the same signing input - a canonicalisation
 * bug that has broken real signing schemes.
 */
export function signingPayload(timestampSeconds: number, body: string): string {
  return `${String(timestampSeconds)}.${body}`;
}

export function signPayload(secret: string, timestampSeconds: number, body: string): string {
  return createHmac('sha256', secret).update(signingPayload(timestampSeconds, body)).digest('hex');
}

/**
 * The header value.
 *
 * Versioned, so a future scheme can be introduced without receivers guessing
 * which one they are looking at. During a secret rotation this carries BOTH
 * signatures, space-separated, so a receiver that has migrated and one that has
 * not can each find one they accept (blueprint 12.4's overlap window).
 */
export function signatureHeader(signatures: readonly string[]): string {
  return signatures.map((signature) => `${SIGNATURE_VERSION}=${signature}`).join(' ');
}

export function parseSignatureHeader(header: string): readonly string[] {
  return header
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SIGNATURE_VERSION}=`))
    .map((part) => part.slice(SIGNATURE_VERSION.length + 1));
}

/**
 * Constant-time comparison of two hex signatures.
 *
 * `timingSafeEqual` THROWS when the buffers differ in length, so the length is
 * compared first - the same trap the Stage 7 IP pseudonym had to step around.
 */
export function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface VerifyInput {
  readonly header: string;
  readonly timestampSeconds: number;
  readonly body: string;
  /** Current and, during rotation, previous secret. */
  readonly secrets: readonly string[];
  readonly nowSeconds: number;
}

export type VerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'stale_timestamp' | 'no_matching_signature' };

/**
 * Verify a signed request.
 *
 * Written and exported for the tests and for the documentation this stage
 * publishes to customers - the platform signs rather than verifies - and
 * having one implementation means the documented recipe is provably the one
 * the sender used.
 */
export function verifySignature(input: VerifyInput): VerifyResult {
  if (Math.abs(input.nowSeconds - input.timestampSeconds) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const offered = parseSignatureHeader(input.header);
  for (const secret of input.secrets) {
    const expected = signPayload(secret, input.timestampSeconds, input.body);
    if (offered.some((candidate) => signaturesMatch(candidate, expected))) {
      return { ok: true };
    }
  }
  return { ok: false, reason: 'no_matching_signature' };
}
