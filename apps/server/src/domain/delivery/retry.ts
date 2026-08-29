/**
 * Retry classification and backoff (blueprint 12.2, 5.3).
 *
 * The single most important rule in this file is stated twice in the
 * blueprint, in 5.3 and again in 12.2: **only transient failures retry.** A
 * permanent failure is not a slow success - retrying a rejected recipient five
 * times spends five of a 300-message daily allowance to be told the same thing
 * five times, and retrying a webhook 4xx hammers a receiver that has already
 * said no. So classification comes first and backoff second.
 */

/** Blueprint 12.2: "Transient failures retry five times". */
export const MAX_ATTEMPTS = 5;

/** The first retry waits this long; each subsequent one doubles. */
export const BASE_DELAY_MS = 5_000;

/** Ceiling, so a fifth attempt is not scheduled beyond a useful horizon. */
export const MAX_DELAY_MS = 15 * 60 * 1000;

/**
 * Jitter fraction. BullMQ's own `jitter` option takes the same shape, and the
 * value is duplicated here because the reconciler schedules its retries in
 * Mongo rather than through a queue and must behave identically.
 */
export const JITTER = 0.5;

export type FailureKind = 'transient' | 'permanent';

/**
 * Classify an HTTP status.
 *
 * 429 is the interesting case: it is a 4xx, but it means "not now" rather than
 * "never", so it is transient. Every other 4xx is the receiver telling us the
 * request itself is wrong, which no amount of repetition fixes.
 */
export function classifyHttpStatus(status: number): FailureKind {
  if (status === 429) return 'transient';
  if (status >= 400 && status < 500) return 'permanent';
  // 5xx, and anything else unexpected, gets the benefit of the doubt.
  return 'transient';
}

/**
 * Classify a thrown transport error.
 *
 * A timeout, a reset connection, or a DNS hiccup is transient. An SSRF
 * refusal is not a network condition at all - it is this platform declining to
 * make the request - so it must never be retried, or a blocked destination
 * would be attempted five times.
 */
export function classifyTransportError(error: unknown): FailureKind {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('SSRF_BLOCKED') || message.startsWith('INVALID_DESTINATION')) {
    return 'permanent';
  }
  return 'transient';
}

export function shouldRetry(kind: FailureKind, attemptsMade: number): boolean {
  return kind === 'transient' && attemptsMade < MAX_ATTEMPTS;
}

/**
 * Exponential backoff with jitter.
 *
 * Jitter matters more here than the exponent does. Every submission to one
 * workspace tends to fail at the same moment for the same reason - the
 * receiver is down - so without jitter the retries stay in lockstep and arrive
 * as a thundering herd exactly when the receiver is trying to recover.
 *
 * `random` is injectable so the schedule can be asserted rather than sampled.
 */
export function backoffMs(attemptsMade: number, random: () => number = Math.random): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attemptsMade - 1), MAX_DELAY_MS);
  // Jitter is applied downward from the full delay, so a retry never waits
  // LONGER than the ceiling the operator was told about.
  const jittered = exponential * (1 - JITTER * random());
  return Math.round(jittered);
}

export function nextAttemptAt(
  attemptsMade: number,
  now: Date,
  random: () => number = Math.random,
): Date {
  return new Date(now.getTime() + backoffMs(attemptsMade, random));
}

/**
 * The terminal state for a failure that will not be retried.
 *
 * `permanent` is final on its first attempt; a transient failure that ran out
 * of attempts becomes a dead letter, which is the one an operator can usefully
 * replay (blueprint 12.2).
 */
export function terminalStatus(kind: FailureKind): 'failed' | 'dead_letter' {
  return kind === 'permanent' ? 'failed' : 'dead_letter';
}
