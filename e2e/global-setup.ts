import { MongoConnection, runMigrations } from '@lcp/database';
import { createLogger } from '@lcp/contracts';

/**
 * Bring the end-to-end database's schema up to date before anything runs.
 *
 * Added in Stage 13, because the readiness probe added in Stage 13 immediately
 * reported `pending: 011_demo` against this database. Nothing had ever run
 * migrations here: blueprint 9.3 forbids running them on boot, the server
 * therefore does not, and no step existed between "docker compose up" and
 * "playwright test" that did. Every browser run since Stage 12b has been
 * against a database missing that migration's index - which is exactly the
 * failure the probe exists to catch, found the first time it looked.
 *
 * `runMigrations` is idempotent twice over - a ledger of applied ids, and
 * individually idempotent migrations - so running it before every suite costs
 * one query on a database that is already current.
 */
export default async function globalSetup(): Promise<void> {
  const uri =
    process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017/leadcapture_e2e?directConnection=true';
  const databaseName = process.env['MONGODB_DB_NAME'] ?? 'leadcapture_e2e';

  const connection = new MongoConnection({ uri, databaseName });
  const logger = createLogger({
    bindings: { service: 'e2e-setup', environment: 'test', release: 'local-dev' },
    minLevel: 'warn',
  });

  try {
    await connection.connect();
    const outcome = await runMigrations(connection.db, logger);
    if (outcome.applied.length > 0) {
      // Printed rather than logged: this is a thing a person reading the test
      // output wants to see happen, once.
      console.log(`[e2e] applied migrations: ${outcome.applied.join(', ')}`);
    }
  } finally {
    await connection.close();
  }
}
