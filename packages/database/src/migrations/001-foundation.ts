import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { Migration } from './types.js';

const SECONDS_PER_DAY = 86_400;
/** Audit logs are retained for 12 months (blueprint sections 4.9 and 9.5). */
const AUDIT_RETENTION_SECONDS = 365 * SECONDS_PER_DAY;

async function ensureCollection(db: Db, name: string): Promise<void> {
  const existing = await db.listCollections({ name }, { nameOnly: true }).toArray();
  if (existing.length === 0) {
    await db.createCollection(name);
  }
}

/**
 * Foundation collections and indexes for Stage 2.
 *
 * Index choices follow the constraints in the blueprint section 9.2 table.
 * Uniqueness that must apply only to live records uses a partial filter, so a
 * soft-deleted row never blocks a legitimate new one.
 */
export const migration001Foundation: Migration = {
  id: '001_foundation',
  description:
    'Foundation collections and indexes for users, workspaces, membership, invitations, audit, and outbox',

  async up(db: Db): Promise<void> {
    for (const name of Object.values(COLLECTIONS)) {
      await ensureCollection(db, name);
    }

    // User: unique normalized email among active accounts.
    await db.collection(COLLECTIONS.users).createIndexes([
      {
        key: { normalizedEmail: 1 },
        name: 'uniq_active_normalized_email',
        unique: true,
        partialFilterExpression: { status: 'active' },
      },
      { key: { status: 1, purgeAfter: 1 }, name: 'status_purge_after' },
    ]);

    // Workspace: a verified user may own exactly one ACTIVE workspace (4.1).
    await db.collection(COLLECTIONS.workspaces).createIndexes([
      {
        key: { ownerUserId: 1 },
        name: 'uniq_active_owner',
        unique: true,
        partialFilterExpression: { status: 'active' },
      },
      { key: { status: 1, purgeAfter: 1 }, name: 'status_purge_after' },
    ]);

    // Membership: unique workspace-user pair, plus a role index.
    await db.collection(COLLECTIONS.memberships).createIndexes([
      {
        key: { workspaceId: 1, userId: 1 },
        name: 'uniq_workspace_user',
        unique: true,
      },
      { key: { workspaceId: 1, role: 1 }, name: 'workspace_role' },
      { key: { userId: 1 }, name: 'user_memberships' },
    ]);

    // Invitation: hashed single-use token, 7-day expiry, workspace scoping.
    await db.collection(COLLECTIONS.invitations).createIndexes([
      { key: { tokenHash: 1 }, name: 'uniq_token_hash', unique: true },
      { key: { workspaceId: 1, status: 1 }, name: 'workspace_status' },
      {
        key: { workspaceId: 1, normalizedEmail: 1 },
        name: 'uniq_pending_workspace_email',
        unique: true,
        partialFilterExpression: { status: 'pending' },
      },
      { key: { expiresAt: 1 }, name: 'expires_at' },
    ]);

    // AuditEvent: workspace/type/date, expiring after 12 months.
    await db.collection(COLLECTIONS.auditEvents).createIndexes([
      { key: { workspaceId: 1, type: 1, occurredAt: -1 }, name: 'workspace_type_occurred' },
      { key: { workspaceId: 1, occurredAt: -1 }, name: 'workspace_occurred' },
      {
        key: { occurredAt: 1 },
        name: 'ttl_occurred_at',
        expireAfterSeconds: AUDIT_RETENTION_SECONDS,
      },
    ]);

    // OutboxEvent: claim order by status/next attempt, idempotent enqueue.
    await db.collection(COLLECTIONS.outboxEvents).createIndexes([
      { key: { status: 1, nextAttemptAt: 1 }, name: 'status_next_attempt' },
      { key: { idempotencyKey: 1 }, name: 'uniq_idempotency_key', unique: true },
      { key: { workspaceId: 1, status: 1 }, name: 'workspace_status' },
    ]);
  },
};
