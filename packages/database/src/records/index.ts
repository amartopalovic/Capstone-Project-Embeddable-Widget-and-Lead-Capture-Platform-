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

  // --- Credentials, added in Stage 3a by migration 002_auth ----------------

  /**
   * Argon2id PHC string, for example
   * `$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>`.
   * Null only for a record created before credentials existed.
   */
  readonly passwordHash: string | null;
  readonly passwordUpdatedAt: Date | null;

  /** Pending single-use email-verification token, or null. */
  readonly emailVerification: PendingToken | null;
  /** Pending single-use password-reset token, or null. */
  readonly passwordReset: PendingToken | null;

  /** Consecutive failed logins; reset on success (blueprint 10.3 throttles). */
  readonly failedLoginAttempts: number;
  /** Set when repeated failures lock the account. Null when not locked. */
  readonly lockedUntil: Date | null;
  readonly lastLoginAt: Date | null;

  // --- MFA, added in Stage 3b by migration 003_mfa -------------------------

  /**
   * TOTP secret, AES-256-GCM encrypted at rest (blueprint 12.4 and 17).
   *
   * Present but with `mfaEnabled: false` means enrollment has started and is
   * awaiting a confirming code. MFA is never enabled by generating a secret
   * alone, or a user could be locked out by an enrollment they never finished.
   */
  readonly totpSecret: EncryptedValue | null;
  readonly mfaEnabled: boolean;
  readonly mfaEnabledAt: Date | null;

  /**
   * Highest TOTP counter already accepted.
   *
   * A valid code stays valid for its whole 30-second period, so without this a
   * code observed in transit could be replayed inside that window. Rejecting a
   * counter at or below the last accepted one closes that gap.
   */
  readonly lastTotpCounter: number | null;

  /** Single-use recovery codes, hashed exactly like verification tokens. */
  readonly recoveryCodes: readonly RecoveryCode[];
}

/**
 * Application-level encrypted value (blueprint 12.4).
 *
 * The key version travels with the ciphertext so a rotated master key can still
 * read older values. Stage 9 reuses this shape for webhook secrets.
 */
export interface EncryptedValue {
  /** Base64 AES-256-GCM ciphertext. */
  readonly ciphertext: string;
  /** Base64 96-bit nonce, unique per encryption. */
  readonly iv: string;
  /** Base64 128-bit authentication tag. */
  readonly authTag: string;
  /** Which master key encrypted this, so rotation stays readable. */
  readonly keyVersion: number;
}

/** A single-use recovery code. Only the hash is stored. */
export interface RecoveryCode {
  readonly codeHash: string;
  readonly usedAt: Date | null;
}

/**
 * A single-use, expiring, HASHED token.
 *
 * Only the hash is ever persisted; the plaintext exists solely in the emailed
 * link (blueprint section 17). This mirrors the `Invitation.tokenHash` pattern
 * established in Stage 2 rather than inventing a second convention.
 *
 * These live on the User record instead of in their own collection because
 * blueprint section 9.2 defines no auth-token collection, and a user can hold
 * at most one pending verification and one pending reset at a time.
 */
export interface PendingToken {
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly issuedAt: Date;
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

// ---------------------------------------------------------------------------
// Widget and WidgetRevision (blueprint 9.2, added in Stage 5a)
// ---------------------------------------------------------------------------

/**
 * A widget's stable identity and lifecycle (blueprint 4.5).
 *
 * Identity is separate from configuration on purpose: the embed snippet on a
 * customer's page names `publicId` and never changes, while the configuration
 * it renders moves forward one immutable revision at a time.
 *
 * `status` is the soft-deletion lifecycle shared with every other tenant
 * record; whether the widget is SERVABLE is a different question, answered by
 * `publishedRevisionId`.
 */
export interface WidgetRecord extends WorkspaceOwned, Timestamped {
  readonly _id: ObjectId;
  /**
   * Opaque public identifier, unique across the platform.
   *
   * Deliberately not the Mongo `_id`: blueprint 10.1 requires public widget
   * APIs to use "opaque public widget IDs", and an ObjectId leaks a creation
   * timestamp and is guessable in sequence.
   */
  readonly publicId: string;
  readonly type: string;
  readonly name: string;
  readonly status: RecordStatus;
  readonly deletedAt: Date | null;
  /** 30 days after soft deletion (blueprint 9.5 widget trash). */
  readonly purgeAfter: Date | null;

  /**
   * The revision currently served, or null.
   *
   * Null covers three cases that behave identically to a visitor: never
   * published, explicitly unpublished, and soft-deleted. Unpublishing clears
   * this rather than deleting the revision, so history survives.
   */
  readonly publishedRevisionId: ObjectId | null;

  /**
   * The most recent publish, retained even after unpublishing.
   *
   * Kept separate from `publishedRevisionId` because the two answer different
   * questions. The pointer answers "is this being served right now"; these
   * answer "has this ever been live", which is what distinguishes a widget that
   * was taken down from one that was never published - a distinction a visitor
   * cannot see but a creator very much can.
   */
  readonly lastPublishedRevisionNumber: number | null;
  readonly lastPublishedAt: Date | null;

  /** Monotonic allocator for revision numbers; never decreases. */
  readonly lastRevisionNumber: number;
}

export const REVISION_STATUSES = ['draft', 'published'] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

/**
 * One configuration snapshot (blueprint 9.2, 9.3).
 *
 * A `published` revision is IMMUTABLE - blueprint 9.3 states it outright.
 * Publishing therefore promotes the draft in place exactly once and every
 * later edit starts a new draft; nothing ever rewrites a published row.
 */
export interface WidgetRevisionRecord extends WorkspaceOwned, Timestamped {
  readonly _id: ObjectId;
  readonly widgetId: ObjectId;
  /** Unique per workspace + widget. */
  readonly revisionNumber: number;
  readonly status: RevisionStatus;
  /** The whole validated settings snapshot, shaped by `widgetConfigSchema`. */
  readonly config: Readonly<Record<string, unknown>>;
  /**
   * Optimistic-concurrency token for the DRAFT (blueprint 10.1).
   *
   * Every accepted draft write increments it, and a write carrying a stale
   * value is refused with 409 rather than silently overwriting a teammate.
   */
  readonly version: number;
  readonly publishedAt: Date | null;
  readonly publishedByUserId: ObjectId | null;
  readonly createdByUserId: ObjectId;
}
