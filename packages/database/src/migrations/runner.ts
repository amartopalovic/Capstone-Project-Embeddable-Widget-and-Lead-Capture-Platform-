import type { Db } from 'mongodb';
import type { Logger } from '@lcp/contracts';
import { COLLECTIONS } from '../collections.js';
import type { Migration } from './types.js';
import { migration001Foundation } from './001-foundation.js';
import { migration002Auth } from './002-auth.js';
import { migration003Mfa } from './003-mfa.js';

/**
 * Ordered migration list. Append only; never reorder or reuse an id.
 */
export const MIGRATIONS: readonly Migration[] = [
  migration001Foundation,
  migration002Auth,
  migration003Mfa,
];

interface MigrationLedgerEntry {
  readonly _id: string;
  readonly description: string;
  readonly appliedAt: Date;
}

export interface MigrationOutcome {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Apply every migration that has not been applied yet.
 *
 * Repeatability comes from two independent mechanisms, which is deliberate:
 *
 *  1. A ledger collection records which migration ids have run, so a second run
 *     applies nothing.
 *  2. Each migration is individually idempotent - MongoDB creates an index only
 *     when an identical specification does not already exist - so even a lost
 *     ledger cannot corrupt the schema.
 *
 * This is explicit, committed migration code rather than uncontrolled startup
 * mutation (blueprint section 9.3). Nothing here runs implicitly on boot; a
 * caller must invoke it.
 */
export async function runMigrations(
  db: Db,
  logger: Logger,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrationOutcome> {
  const ledger = db.collection<MigrationLedgerEntry>(COLLECTIONS.migrations);

  const alreadyApplied = new Set(
    (await ledger.find({}, { projection: { _id: 1 } }).toArray()).map((entry) => entry._id),
  );

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    if (alreadyApplied.has(migration.id)) {
      skipped.push(migration.id);
      logger.debug('migration.skipped', { migrationId: migration.id, result: 'success' });
      continue;
    }

    const startedAt = Date.now();
    await migration.up(db);
    await ledger.insertOne({
      _id: migration.id,
      description: migration.description,
      appliedAt: new Date(),
    });

    applied.push(migration.id);
    logger.info('migration.applied', {
      migrationId: migration.id,
      durationMs: Date.now() - startedAt,
      result: 'success',
    });
  }

  return { applied, skipped };
}

/** Ids of migrations recorded as applied, in ledger order. */
export async function appliedMigrationIds(db: Db): Promise<readonly string[]> {
  const ledger = db.collection<MigrationLedgerEntry>(COLLECTIONS.migrations);
  const entries = await ledger.find({}, { sort: { _id: 1 } }).toArray();
  return entries.map((entry) => entry._id);
}

/** Migration ids defined in code but not yet recorded as applied. */
export async function pendingMigrationIds(
  db: Db,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<readonly string[]> {
  const applied = new Set(await appliedMigrationIds(db));
  return migrations.filter((migration) => !applied.has(migration.id)).map((m) => m.id);
}
