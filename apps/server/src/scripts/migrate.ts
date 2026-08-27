/**
 * Migration CLI.
 *
 * Migrations are applied by running this command explicitly, never implicitly
 * on server boot (blueprint section 9.3 forbids uncontrolled startup
 * mutations). Running it twice is safe and applies nothing the second time.
 */

import { MongoConnection, runMigrations, pendingMigrationIds } from '@lcp/database';
import { createLogger } from '@lcp/contracts';
import { loadEnv } from '../config/env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({
    bindings: { service: 'migrate', environment: env.nodeEnv, release: env.release },
    minLevel: 'debug',
  });

  const connection = new MongoConnection({
    uri: env.mongoUri,
    ...(env.mongoDbName === undefined ? {} : { databaseName: env.mongoDbName }),
  });

  try {
    await connection.connect();

    const pending = await pendingMigrationIds(connection.db);
    logger.info('migration.pending', { count: pending.length, result: 'success' });

    const outcome = await runMigrations(connection.db, logger);

    logger.info('migration.complete', {
      applied: outcome.applied.length,
      skipped: outcome.skipped.length,
      result: 'success',
    });
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  console.error('[migrate] Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
