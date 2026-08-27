import { randomBytes } from 'node:crypto';
import { MongoConnection, runMigrations } from '@lcp/database';
import type { Db } from 'mongodb';
import { createSilentLogger } from './logging.js';

/**
 * Integration-test MongoDB fixture.
 *
 * Each fixture gets its OWN randomly named database, created fresh and dropped
 * afterwards. That is what makes the tests deterministic and order-independent,
 * and it also gives the migration-repeatability test a genuinely clean database
 * rather than one carrying state from an earlier run.
 */

export const TEST_MONGO_URI =
  process.env['TEST_MONGODB_URI'] ??
  process.env['MONGODB_URI'] ??
  'mongodb://localhost:27017/?directConnection=true';

export interface MongoFixture {
  readonly connection: MongoConnection;
  readonly db: Db;
  readonly databaseName: string;
  /** Drop the database and close the connection. */
  teardown(): Promise<void>;
}

export async function createMongoFixture(options?: {
  readonly runMigrations?: boolean;
}): Promise<MongoFixture> {
  const databaseName = `lcp_test_${randomBytes(8).toString('hex')}`;
  const connection = new MongoConnection({ uri: TEST_MONGO_URI, databaseName });
  await connection.connect();

  const db = connection.db;

  if (options?.runMigrations !== false) {
    await runMigrations(db, createSilentLogger());
  }

  return {
    connection,
    db,
    databaseName,
    async teardown(): Promise<void> {
      await db.dropDatabase();
      await connection.close();
    },
  };
}
