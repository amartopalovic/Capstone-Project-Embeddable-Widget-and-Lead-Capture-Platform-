/**
 * Seed entrypoint.
 *
 * Stage 2 applies migrations and reports the resulting schema state. There is
 * still no domain data to seed: the foundation records exist as shapes and
 * repositories, but populating a demo workspace needs the onboarding rules from
 * Stage 4. This command must never invent placeholder business records.
 */

import { MongoConnection, appliedMigrationIds, runMigrations } from '@lcp/database';
import { createLogger } from '@lcp/contracts';
import { loadEnv } from '../config/env.js';

async function seed(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({
    bindings: { service: 'seed', environment: env.nodeEnv, release: env.release },
    minLevel: 'debug',
  });

  const connection = new MongoConnection({
    uri: env.mongoUri,
    ...(env.mongoDbName === undefined ? {} : { databaseName: env.mongoDbName }),
  });

  try {
    await connection.connect();

    const transactional = await connection.supportsTransactions();
    console.log(`[seed] Connected to MongoDB (database: ${connection.db.databaseName}).`);
    console.log(
      transactional
        ? '[seed] Replica set detected - multi-document transactions are available.'
        : '[seed] WARNING: not connected to a replica set. Transactions will not work.',
    );

    const outcome = await runMigrations(connection.db, logger);
    const applied = await appliedMigrationIds(connection.db);

    console.log(
      `[seed] Migrations: ${String(outcome.applied.length)} applied, ${String(outcome.skipped.length)} already present.`,
    );
    console.log(`[seed] Schema at: ${applied.join(', ')}`);
    console.log('[seed] No domain data to seed yet. Workspace seed fixtures arrive in Stage 4.');
  } finally {
    await connection.close();
  }
}

seed().catch((error: unknown) => {
  console.error('[seed] Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
