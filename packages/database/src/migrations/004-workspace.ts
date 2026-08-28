import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { Migration } from './types.js';

/**
 * Stage 4a: indexes for the workspace, membership, and invitation flows.
 *
 * Append-only, per the rule in runner.ts. No new FIELDS are needed: Stage 2
 * already gave `Workspace` its soft-deletion fields and the partial unique
 * index enforcing one active owned workspace per user, and `Invitation`
 * already carries the hashed token, role, and expiry.
 *
 * What was missing is the index supporting the acceptance flow for a recipient
 * who did not have an account when they were invited: after they register and
 * verify, their pending invitations have to be found by email across every
 * workspace.
 */
export const migration004Workspace: Migration = {
  id: '004_workspace',
  description: 'Indexes for invitation lookup by recipient and workspace lifecycle sweeps',

  async up(db: Db): Promise<void> {
    await db.collection(COLLECTIONS.invitations).createIndexes([
      // Find every pending invitation addressed to one person, across all
      // workspaces, so a newly verified account can be joined to them.
      {
        key: { normalizedEmail: 1, status: 1 },
        name: 'recipient_status',
      },
    ]);

    await db.collection(COLLECTIONS.workspaces).createIndexes([
      // Supports the Stage 11 purge sweep and the "is this still recoverable"
      // question, without scanning every workspace.
      { key: { status: 1, deletedAt: -1 }, name: 'status_deleted_at' },
    ]);

    await db.collection(COLLECTIONS.memberships).createIndexes([
      // Listing the workspaces a user belongs to is the workspace switcher's
      // primary query, so it is indexed by user and role together.
      { key: { userId: 1, role: 1 }, name: 'user_role' },
    ]);
  },
};
