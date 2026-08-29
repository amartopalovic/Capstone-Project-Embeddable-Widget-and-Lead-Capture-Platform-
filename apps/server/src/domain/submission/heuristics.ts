/**
 * Spam heuristics for the public submission path (blueprint 7.3 step 6).
 *
 * "A filled honeypot or failed timing heuristic produces a generic success,
 * creates no Contact, and records only a minimal Abuse Event."
 *
 * Two properties matter more than the cleverness of the checks themselves.
 *
 * First, the outcome is INDISTINGUISHABLE from success. A bot that can tell it
 * was caught will adapt; one that receives the same generic 2xx as everyone
 * else has nothing to tune against. That is why these functions return a
 * classification for the server's own bookkeeping and never anything the
 * response shape depends on.
 *
 * Second, they are pure. Blueprint 18.1 names "spam heuristics" as unit-testable
 * logic, and a heuristic that needs a request object to test is one nobody
 * revisits.
 */

export const ABUSE_REASONS = ['honeypot', 'timing'] as const;
export type AbuseReason = (typeof ABUSE_REASONS)[number];

/**
 * Minimum plausible time between a form rendering and a human submitting it.
 *
 * Deliberately low. A fast, familiar user filling in one email field can be
 * quick, and the cost of a false positive here is a silently discarded real
 * lead - the worst failure this path has. Anything under a second and a half is
 * not a person reading a form; anything above it is not worth guessing about.
 */
export const MIN_FILL_MILLISECONDS = 1_500;

/**
 * Upper bound on a plausible fill time, after which the timestamp is ignored
 * rather than treated as suspicious.
 *
 * A page left open in a background tab for an hour is ordinary behaviour, not
 * an attack, so a very old render time proves nothing either way.
 */
export const MAX_FILL_MILLISECONDS = 24 * 60 * 60 * 1000;

export interface HeuristicInput {
  /** The hidden field a human never sees and never fills. */
  readonly honeypot: string | undefined;
  /** When the widget rendered the form, as milliseconds since the epoch. */
  readonly renderedAt: number | undefined;
  /** Server time at which the submission arrived. */
  readonly receivedAt: number;
}

export type HeuristicVerdict =
  { readonly accepted: true } | { readonly accepted: false; readonly reason: AbuseReason };

/**
 * Classify a submission without revealing the classification.
 *
 * A missing `renderedAt` is ACCEPTED rather than rejected. It is client-supplied
 * and therefore trivially omitted by a determined bot, so treating its absence
 * as proof of one would only punish visitors whose browser or extension
 * interfered - the honeypot is the check that costs an attacker something.
 */
export function classifySubmission(input: HeuristicInput): HeuristicVerdict {
  // Any value at all in the honeypot. A human never sees the field.
  if (input.honeypot !== undefined && input.honeypot.trim() !== '') {
    return { accepted: false, reason: 'honeypot' };
  }

  if (input.renderedAt === undefined || !Number.isFinite(input.renderedAt)) {
    return { accepted: true };
  }

  const elapsed = input.receivedAt - input.renderedAt;

  // A render time in the future is a clock skew or a forgery; neither is
  // evidence of a human, but neither is worth rejecting a lead over.
  if (elapsed < 0) return { accepted: true };
  if (elapsed > MAX_FILL_MILLISECONDS) return { accepted: true };

  if (elapsed < MIN_FILL_MILLISECONDS) return { accepted: false, reason: 'timing' };

  return { accepted: true };
}
