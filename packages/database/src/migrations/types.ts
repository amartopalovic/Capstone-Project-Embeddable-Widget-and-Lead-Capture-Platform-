import type { Db } from 'mongodb';

/**
 * A committed, ordered, repeatable migration (blueprint section 9.3).
 *
 * Migrations are plain modules held in an explicit ordered list, not files
 * discovered at runtime, so the applied order is reviewable in the diff and
 * identical everywhere.
 *
 * Every `up` must be idempotent on its own: `createIndexes` is a no-op when an
 * identical specification already exists, and collection creation tolerates the
 * collection already existing. That makes a re-run safe even if the ledger were
 * ever lost.
 */
export interface Migration {
  /** Zero-padded, ordered, and never reused, for example `001_foundation`. */
  readonly id: string;
  readonly description: string;
  up(db: Db): Promise<void>;
}
