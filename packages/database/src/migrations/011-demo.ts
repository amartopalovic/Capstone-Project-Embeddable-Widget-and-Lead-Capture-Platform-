import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { Migration } from './types.js';

/**
 * Stage 12b: the public sandbox tenant (blueprint 14.3).
 *
 * Append-only, per the rule in runner.ts: 001-010 are untouched.
 *
 * One boolean and one index. The demo is deliberately not a new kind of
 * record - it is an ordinary workspace that happens to be marked, so every
 * tenancy guarantee the rest of the system already has applies to it without
 * anything being written twice.
 */
export const migration011Demo: Migration = {
  id: '011_demo',
  description: 'Mark the public sandbox workspace',

  async up(db: Db): Promise<void> {
    /**
     * The lookup the hourly reset and the public demo endpoints make. Partial,
     * because exactly one document in the collection will ever match and a full
     * index over every workspace to find it would be waste.
     */
    await db
      .collection(COLLECTIONS.workspaces)
      .createIndex(
        { isDemo: 1 },
        { name: 'demo_workspace', partialFilterExpression: { isDemo: true } },
      );

    // Every existing workspace is a real one.
    await db
      .collection(COLLECTIONS.workspaces)
      .updateMany({ isDemo: { $exists: false } }, { $set: { isDemo: false } });
  },
};
