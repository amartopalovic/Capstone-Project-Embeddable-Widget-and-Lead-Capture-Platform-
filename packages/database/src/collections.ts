/**
 * Canonical collection names.
 *
 * Referenced by migrations, indexes, and repositories so a rename is a one-line
 * change rather than a string hunt.
 */

export const COLLECTIONS = {
  users: 'users',
  workspaces: 'workspaces',
  memberships: 'memberships',
  invitations: 'invitations',
  auditEvents: 'audit_events',
  outboxEvents: 'outbox_events',
  migrations: 'migrations',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
