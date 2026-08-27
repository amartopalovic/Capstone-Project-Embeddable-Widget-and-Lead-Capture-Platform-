/**
 * Seed entrypoint.
 *
 * Stage 1 establishes the MECHANISM only. There is no domain data to seed yet:
 * no collections, models, or migrations exist until Stage 2. This script
 * verifies it can reach MongoDB and then exits successfully, so that later
 * stages extend a command that already exists rather than inventing one.
 *
 * It must never invent placeholder business records.
 */

import { MongoClient } from 'mongodb';
import { loadEnv } from '../config/env.js';

async function seed(): Promise<void> {
  const env = loadEnv();
  const client = new MongoClient(env.mongoUri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const result = await client.db().admin().command({ hello: 1 });
    const isReplicaSet = typeof result['setName'] === 'string';

    console.log(`[seed] Connected to MongoDB (database: ${client.db().databaseName}).`);
    console.log(
      isReplicaSet
        ? `[seed] Replica set "${String(result['setName'])}" detected - transactions are available.`
        : '[seed] WARNING: not connected to a replica set. Transactions will not work.',
    );
    console.log(
      '[seed] No domain data to seed yet. Collections and seed fixtures arrive in Stage 2.',
    );
  } finally {
    await client.close();
  }
}

seed().catch((error: unknown) => {
  console.error('[seed] Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
