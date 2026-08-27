import { afterEach, describe, expect, it } from 'vitest';
import { createMongoFixture, createCapturingLogger, type MongoFixture } from '@lcp/test-utils';
import {
  COLLECTIONS,
  MIGRATIONS,
  appliedMigrationIds,
  pendingMigrationIds,
  runMigrations,
} from '../src/index.js';

/**
 * Stage 2 exit-gate proof, second half.
 *
 * Blueprint section 9.3 requires committed, repeatable migrations and explicit
 * index management rather than uncontrolled startup mutations. "Repeatable"
 * is proven here by running migrations twice against a clean database and
 * comparing the resulting index state exactly, not just checking for absence of
 * an error.
 */

let mongo: MongoFixture | undefined;

afterEach(async () => {
  await mongo?.teardown();
  mongo = undefined;
});

/** Sorted index descriptors for every foundation collection. */
async function snapshotIndexes(
  fixture: MongoFixture,
): Promise<
  Record<
    string,
    { name: string; key: string; unique: boolean; partial: boolean; ttl: number | null }[]
  >
> {
  const snapshot: Record<
    string,
    { name: string; key: string; unique: boolean; partial: boolean; ttl: number | null }[]
  > = {};

  for (const name of Object.values(COLLECTIONS)) {
    const indexes = await fixture.db.collection(name).indexes();
    snapshot[name] = indexes
      .map((index) => ({
        name: String(index.name),
        key: JSON.stringify(index.key),
        unique: index.unique === true,
        partial: index.partialFilterExpression !== undefined,
        ttl: typeof index.expireAfterSeconds === 'number' ? index.expireAfterSeconds : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return snapshot;
}

describe('migrations on a clean database', () => {
  it('applies every migration once and reports it', async () => {
    mongo = await createMongoFixture({ runMigrations: false });
    const { logger, records } = createCapturingLogger();

    expect(await pendingMigrationIds(mongo.db)).toEqual(MIGRATIONS.map((m) => m.id));

    const outcome = await runMigrations(mongo.db, logger);

    expect(outcome.applied).toEqual(MIGRATIONS.map((m) => m.id));
    expect(outcome.skipped).toEqual([]);
    expect(await appliedMigrationIds(mongo.db)).toEqual(MIGRATIONS.map((m) => m.id));
    expect(await pendingMigrationIds(mongo.db)).toEqual([]);

    // The migration reports itself through the structured logger.
    const applied = records.filter((record) => record.event === 'migration.applied');
    expect(applied).toHaveLength(MIGRATIONS.length);
    expect(applied[0]?.result).toBe('success');
  }, 60_000);

  it('is repeatable: a second run applies nothing and leaves indexes identical', async () => {
    mongo = await createMongoFixture({ runMigrations: false });
    const { logger } = createCapturingLogger();

    await runMigrations(mongo.db, logger);
    const afterFirst = await snapshotIndexes(mongo);

    const secondOutcome = await runMigrations(mongo.db, logger);
    const afterSecond = await snapshotIndexes(mongo);

    expect(secondOutcome.applied).toEqual([]);
    expect(secondOutcome.skipped).toEqual(MIGRATIONS.map((m) => m.id));
    expect(afterSecond).toEqual(afterFirst);
  }, 60_000);

  it('is idempotent even if the ledger is lost, so the schema cannot drift', async () => {
    mongo = await createMongoFixture({ runMigrations: false });
    const { logger } = createCapturingLogger();

    await runMigrations(mongo.db, logger);
    const afterFirst = await snapshotIndexes(mongo);

    // Simulate a lost or wiped ledger: the migrations must re-run harmlessly.
    await mongo.db.collection(COLLECTIONS.migrations).deleteMany({});
    const replayed = await runMigrations(mongo.db, logger);
    const afterReplay = await snapshotIndexes(mongo);

    expect(replayed.applied).toEqual(MIGRATIONS.map((m) => m.id));
    expect(afterReplay).toEqual(afterFirst);
  }, 60_000);

  it('creates the constraints the blueprint requires', async () => {
    mongo = await createMongoFixture();
    const snapshot = await snapshotIndexes(mongo);

    const users = snapshot[COLLECTIONS.users] ?? [];
    const workspaces = snapshot[COLLECTIONS.workspaces] ?? [];
    const memberships = snapshot[COLLECTIONS.memberships] ?? [];
    const invitations = snapshot[COLLECTIONS.invitations] ?? [];
    const auditEvents = snapshot[COLLECTIONS.auditEvents] ?? [];
    const outbox = snapshot[COLLECTIONS.outboxEvents] ?? [];

    // Unique normalized email, restricted to active accounts.
    const email = users.find((i) => i.name === 'uniq_active_normalized_email');
    expect(email?.unique).toBe(true);
    expect(email?.partial).toBe(true);

    // One ACTIVE owned workspace per user.
    const owner = workspaces.find((i) => i.name === 'uniq_active_owner');
    expect(owner?.unique).toBe(true);
    expect(owner?.partial).toBe(true);

    // Unique workspace-user membership pair.
    expect(memberships.find((i) => i.name === 'uniq_workspace_user')?.unique).toBe(true);

    // Hashed invitation token is unique.
    expect(invitations.find((i) => i.name === 'uniq_token_hash')?.unique).toBe(true);

    // Audit events expire after 12 months.
    expect(auditEvents.find((i) => i.name === 'ttl_occurred_at')?.ttl).toBe(365 * 86_400);

    // Outbox idempotency key is unique, and claiming is indexed.
    expect(outbox.find((i) => i.name === 'uniq_idempotency_key')?.unique).toBe(true);
    expect(outbox.some((i) => i.name === 'status_next_attempt')).toBe(true);
  }, 60_000);
});

describe('storage-level constraints actually reject bad data', () => {
  it('rejects a duplicate workspace-user membership pair', async () => {
    mongo = await createMongoFixture();
    const { ObjectId } = await import('mongodb');
    const workspaceId = new ObjectId();
    const userId = new ObjectId();
    const now = new Date();

    const collection = mongo.db.collection(COLLECTIONS.memberships);
    await collection.insertOne({
      workspaceId,
      userId,
      role: 'member',
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      collection.insertOne({ workspaceId, userId, role: 'admin', createdAt: now, updatedAt: now }),
    ).rejects.toThrow(/duplicate key/i);
  }, 60_000);

  it('allows the same user in two different workspaces', async () => {
    mongo = await createMongoFixture();
    const { ObjectId } = await import('mongodb');
    const userId = new ObjectId();
    const now = new Date();

    const collection = mongo.db.collection(COLLECTIONS.memberships);
    await collection.insertOne({
      workspaceId: new ObjectId(),
      userId,
      role: 'member',
      createdAt: now,
      updatedAt: now,
    });

    // Joining many workspaces is explicitly allowed (blueprint section 4.1).
    await expect(
      collection.insertOne({
        workspaceId: new ObjectId(),
        userId,
        role: 'owner',
        createdAt: now,
        updatedAt: now,
      }),
    ).resolves.toBeDefined();
  }, 60_000);

  it('permits a second owned workspace only after the first is soft-deleted', async () => {
    mongo = await createMongoFixture();
    const { ObjectId } = await import('mongodb');
    const ownerUserId = new ObjectId();
    const now = new Date();
    const collection = mongo.db.collection(COLLECTIONS.workspaces);

    const base = {
      ownerUserId,
      timezone: 'Europe/Berlin',
      retentionDays: 365,
      deletedAt: null,
      purgeAfter: null,
      createdAt: now,
      updatedAt: now,
    };

    const first = await collection.insertOne({ ...base, name: 'First', status: 'active' });

    // A user may own only ONE active workspace (blueprint section 4.1).
    await expect(
      collection.insertOne({ ...base, name: 'Second', status: 'active' }),
    ).rejects.toThrow(/duplicate key/i);

    // Once the first is soft-deleted the partial index no longer covers it.
    await collection.updateOne({ _id: first.insertedId }, { $set: { status: 'deleted' } });
    await expect(
      collection.insertOne({ ...base, name: 'Second', status: 'active' }),
    ).resolves.toBeDefined();
  }, 60_000);
});
