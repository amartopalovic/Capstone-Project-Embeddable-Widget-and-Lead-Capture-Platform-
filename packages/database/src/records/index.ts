/**
 * Record shapes for the foundation collections (blueprint section 9.2).
 *
 * Stage 2 defines data shape and access patterns only. Authentication,
 * password material, session handling, invitation delivery, and RBAC
 * enforcement arrive in Stages 3 and 4.
 */

import type { ObjectId } from 'mongodb';

/** Roles within a workspace (blueprint section 4.1). */
export const WORKSPACE_ROLES = ['owner', 'admin', 'member'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Soft-deletion lifecycle shared by tenant-facing records (blueprint 9.5). */
export const RECORD_STATUSES = ['active', 'deleted'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export interface Timestamped {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Every tenant-owned durable record carries workspaceId (blueprint 9.1).
 * This interface is the type-level half of the tenancy invariant: the
 * workspace-scoped repository base only accepts records that extend it.
 */
export interface WorkspaceOwned {
  readonly workspaceId: ObjectId;
}

// ---------------------------------------------------------------------------
// User - account level, NOT workspace-scoped
// ---------------------------------------------------------------------------

export interface UserRecord extends Timestamped {
  readonly _id: ObjectId;
  /** Address as supplied, preserved for display. */
  readonly email: string;
  /** Lowercased and trimmed. Unique across active users. */
  readonly normalizedEmail: string;
  /** Null until the address is verified (blueprint 4.2). */
  readonly emailVerifiedAt: Date | null;
  readonly status: RecordStatus;
  readonly deletedAt: Date | null;
  /** When a soft-deleted account becomes eligible for purge (30 days, 9.5). */
  readonly purgeAfter: Date | null;
  // NOTE: credential material (password hash, TOTP seed, recovery codes) is
  // deliberately absent. Stage 3 adds it through its own migration.
}

// ---------------------------------------------------------------------------
// Workspace - the tenant record itself
// ---------------------------------------------------------------------------

export interface WorkspaceRecord extends Timestamped {
  readonly _id: ObjectId;
  readonly name: string;
  readonly ownerUserId: ObjectId;
  /** IANA zone confirmed during onboarding; month boundaries use it (4.10). */
  readonly timezone: string;
  /** Active contact retention in days. Default 12 months (blueprint 4.8). */
  readonly retentionDays: number;
  readonly status: RecordStatus;
  readonly deletedAt: Date | null;
  readonly purgeAfter: Date | null;
}

export const DEFAULT_RETENTION_DAYS = 365;

// ---------------------------------------------------------------------------
// Workspace-owned records
// ---------------------------------------------------------------------------

export interface MembershipRecord extends WorkspaceOwned, Timestamped {
  readonly _id: ObjectId;
  readonly userId: ObjectId;
  readonly role: WorkspaceRole;
}

export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export interface InvitationRecord extends WorkspaceOwned, Timestamped {
  readonly _id: ObjectId;
  readonly email: string;
  readonly normalizedEmail: string;
  readonly role: WorkspaceRole;
  readonly invitedByUserId: ObjectId;
  /**
   * SHA-256 of the single-use invitation token. The plaintext token is only
   * ever in the emailed link and is never persisted (blueprint section 17).
   */
  readonly tokenHash: string;
  readonly status: InvitationStatus;
  /** 7 days after issue (blueprint 4.1). */
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
}

export interface AuditEventRecord extends WorkspaceOwned {
  readonly _id: ObjectId;
  /** Safe, stable event name such as `membership.role_changed`. */
  readonly type: string;
  /** Null for system-originated events. */
  readonly actorUserId: ObjectId | null;
  /** Ties the record back to the request that caused it (blueprint 9.3). */
  readonly correlationId: string;
  readonly occurredAt: Date;
  /** Safe, non-sensitive detail. Never credentials or captured lead values. */
  readonly metadata: Readonly<Record<string, unknown>>;
}

export const OUTBOX_STATUSES = ['pending', 'processing', 'sent', 'failed', 'dead_letter'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export interface OutboxEventRecord extends WorkspaceOwned, Timestamped {
  readonly _id: ObjectId;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly nextAttemptAt: Date;
  /**
   * Stable key making enqueue idempotent, so a retry cannot produce a duplicate
   * logical notification (blueprint 12.2).
   */
  readonly idempotencyKey: string;
  readonly lastError: string | null;
}
