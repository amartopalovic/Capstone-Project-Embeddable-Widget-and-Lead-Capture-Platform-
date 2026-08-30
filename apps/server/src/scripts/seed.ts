/**
 * Seed entrypoint.
 *
 * (Re)creates the deliberately synthetic public sandbox after migrations have
 * run. The sandbox is the only domain data this command owns; ordinary
 * workspaces are always created through onboarding and are never fabricated by
 * a release.
 */

import { MongoConnection } from '@lcp/database';
import { createLogger } from '@lcp/contracts';
import { loadEnv } from '../config/env.js';
import { DemoService } from '../application/demo/demo-service.js';
import { systemClock } from '../ports/clock.js';

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

    const demo = new DemoService({
      db: connection.db,
      clock: systemClock,
      logger,
      apiBaseUrl: env.appBaseUrl,
      allowedOrigins: [env.demoOrigin],
    });
    const seeded = await demo.reset();
    console.log(
      `[seed] Public sandbox reset: ${String(seeded.widgets)} widgets seeded, ${String(seeded.cleared)} prior records cleared.`,
    );
  } finally {
    await connection.close();
  }
}

seed().catch(() => {
  console.error(
    '[seed] Failed; sensitive driver details suppressed. Check configuration and service availability.',
  );
  process.exitCode = 1;
});
