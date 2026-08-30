/**
 * Retention and soft-delete windows (blueprint 9.5).
 *
 * Every window in the 9.5 table is computed here and nowhere else, so the
 * recovery UI, the API's "recoverable until" field, and the purge sweep can
 * never disagree about when a deadline falls. Stage 11 added the active-contact
 * arithmetic; the 30-day trash arithmetic has been here since Stage 4.
 */

export const RECOVERY_WINDOW_DAYS = 30;

export function purgeDeadline(deletedAt: Date, days = RECOVERY_WINDOW_DAYS): Date {
  return new Date(deletedAt.getTime() + days * 24 * 60 * 60 * 1000);
}

/** True while a soft-deleted record can still be restored. */
export function isRecoverable(purgeAfter: Date | null, now: Date): boolean {
  if (purgeAfter === null) return false;
  return now.getTime() < purgeAfter.getTime();
}

/**
 * Whether a soft-deleted record's recovery window has closed.
 *
 * The exact complement of `isRecoverable`, written out rather than inferred by
 * a caller, because a sweep asking the question the wrong way round would purge
 * records a day early - and "not a moment early" is the whole promise.
 *
 * A null deadline is NOT purgeable. That combination means a record is soft
 * deleted with no scheduled end, and a sweep must leave it alone rather than
 * treat missing data as consent to destroy it.
 */
export function isPurgeable(purgeAfter: Date | null, now: Date): boolean {
  if (purgeAfter === null) return false;
  return now.getTime() >= purgeAfter.getTime();
}

/**
 * When an active contact falls out of its workspace's retention window
 * (blueprint 9.5, 4.8).
 *
 * `retentionDays` of 0 means indefinite, and returns null - there is no
 * deadline, rather than one very far away. Callers must handle null instead of
 * comparing against a sentinel date, which is the point.
 */
export function retentionDeadline(anchor: Date, retentionDays: number): Date | null {
  if (retentionDays <= 0) return null;
  return new Date(anchor.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

/**
 * Whether an active contact has outlived its workspace's retention setting.
 *
 * Measured from the anchor, which blueprint 9.5 defines as "the latest retained
 * submission or intentional workspace activity on that Contact" - not from
 * creation, and not from `updatedAt`.
 */
export function isBeyondRetention(anchor: Date, retentionDays: number, now: Date): boolean {
  const deadline = retentionDeadline(anchor, retentionDays);
  if (deadline === null) return false;
  return now.getTime() >= deadline.getTime();
}
