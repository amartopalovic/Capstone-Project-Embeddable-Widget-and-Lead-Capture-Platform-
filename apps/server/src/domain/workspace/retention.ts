/**
 * Soft-delete windows (blueprint 9.5).
 *
 * Workspace trash and account deletion are both recoverable for 30 days, after
 * which a purge sweep removes or anonymises them. This module owns only the
 * date arithmetic; the sweep itself is Stage 11.
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
