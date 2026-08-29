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

  /**
   * Delivery settings (blueprint 12.3), added in Stage 9.
   *
   * Deliberately on the Widget rather than in the published WidgetRevision
   * config. A revision is an immutable snapshot of what a VISITOR sees;
   * changing who gets emailed about a submission is an operational decision
   * that must not require republishing the widget, and must not appear in the
   * public config endpoint at all.
   *
   * Null means "never configured", which the service reads as the built-in
   * default template - distinct from a customer having deliberately blanked it.
   */
  readonly notificationTemplate: NotificationTemplate | null;
  /** Whether a visitor gets a confirmation email (blueprint 12.1). */
  readonly confirmationEnabled: boolean;
}

/** Customer-controlled email copy, within the 12.3 allowlist. */
export interface NotificationTemplate {
  readonly subject: string;
  readonly body: string;
  readonly replyTo: string | null;
  readonly brandName: string | null;
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

// ---------------------------------------------------------------------------
// Contacts, submissions, consent, and abuse (blueprint 9.2, added in Stage 7)
// ---------------------------------------------------------------------------

/** Lead workflow statuses, in the order blueprint 4.6 lists them. */
export const CONTACT_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'archived'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

/**
 * The workspace-level canonical lead (blueprint 4.6, 9.2).
 *
 * "A Contact is unique by normalized email within a workspace" and "Repeated
 * submissions from the same normalized email update or attach to the same
 * workspace Contact."
 */
export interface ContactRecord extends WorkspaceOwned, Timestamped {
  readonly _id: ObjectId;
  readonly email: string;
  /** Lowercased and trimmed. Unique per workspace among active contacts. */
  readonly normalizedEmail: string;

  // --- canonical values, which a later submission may refresh -------------
  readonly name: string | null;
  readonly phone: string | null;
  readonly company: string | null;

  /**
   * Canonical fields a human has edited.
   *
   * Blueprint 4.6: "Manually edited canonical values are not silently
   * overwritten by a later submission; the new raw values remain visible in its
   * immutable event." Recording WHICH fields were touched is what lets an
   * upsert refresh everything else without trampling a deliberate correction.
   * Stage 8 owns the editing UI; Stage 7 only has to respect the list.
   */
  readonly manuallyEditedFields: readonly string[];

  // --- workflow state (blueprint 4.6); Stage 8 owns the UI ---------------
  readonly status: ContactStatus;
  readonly assigneeUserId: ObjectId | null;
  readonly tags: readonly string[];

  readonly firstSubmissionAt: Date;
  readonly lastSubmissionAt: Date;
  readonly submissionCount: number;

  /**
   * Optimistic-concurrency token (blueprint 9.3: "Contact canonical values use
   * optimistic concurrency to prevent silent overwrites by teammates").
   */
  readonly version: number;

  /**
   * Contacts have a third lifecycle state that other records do not.
   *
   * Blueprint 9.3 requires merge to "retire the duplicate", which is not the
   * same thing as putting it in the 30-day trash: a merged duplicate must never
   * appear in a recovery list, because recovering it would resurrect a record
   * whose events now belong to the survivor. Keeping it distinct is what lets
   * the trash view mean exactly one thing.
   */
  readonly recordStatus: ContactRecordStatus;
  readonly deletedAt: Date | null;
  readonly purgeAfter: Date | null;

  /** The surviving contact, when this one was retired by a merge (9.3). */
  readonly mergedIntoContactId: ObjectId | null;
}

/**
 * Contact-only lifecycle (blueprint 9.3, 9.5).
 *
 * `merged` is deliberately outside the shared RecordStatus: no other record
 * merges, and widening the shared type would offer every collection a state it
 * has no meaning for.
 */
export const CONTACT_RECORD_STATUSES = ['active', 'deleted', 'merged'] as const;
export type ContactRecordStatus = (typeof CONTACT_RECORD_STATUSES)[number];

/**
 * What may be recorded about a Contact (blueprint 9.2: "Status, assignment,
 * tags, notes, merge, and actor history").
 *
 * The list is closed so an entry cannot be written with an ad-hoc type that no
 * timeline knows how to render.
 */
export const CONTACT_ACTIVITY_TYPES = [
  'status_changed',
  'assignee_changed',
  'tags_changed',
  'note_added',
  'canonical_edited',
  'merged_from',
  'merged_into',
  'deleted',
  'recovered',
] as const;
export type ContactActivityType = (typeof CONTACT_ACTIVITY_TYPES)[number];

/**
 * One entry in a Contact's collaboration history (blueprint 9.2, 9.3).
 *
 * Every entry carries the actor and the request correlation ID, because
 * blueprint 9.3 requires that "every role, publish, export, delete, restore,
 * merge, and settings change records the actor and request correlation ID" -
 * and an inbox where a teammate's status change cannot be traced back to them
 * is not a collaborative inbox.
 *
 * Notes live here rather than as a field on the Contact. Blueprint 4.6 says
 * notes belong to the Contact rather than to a submission, which this satisfies
 * while also giving each note its own author and timestamp; a single string
 * field on the record could not say who wrote what, or when.
 *
 * Entries are append-only, like the submission events beside them.
 */
export interface ContactActivityRecord extends WorkspaceOwned {
  readonly _id: ObjectId;
  readonly contactId: ObjectId;
  readonly type: ContactActivityType;
  /** Null only for a system-originated entry. */
  readonly actorUserId: ObjectId | null;
  readonly correlationId: string;
  readonly occurredAt: Date;
  /** Free text, present only on `note_added`. */
  readonly note: string | null;
  /**
   * Safe structural detail: the previous and next status, the tag names, the
   * merged contact id. Never a captured submission value.
   */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** Approximate location, if a provider answered (blueprint 9.4). */
export interface GeoSnapshot {
  readonly countryCode: string | null;
  readonly countryName: string | null;
  readonly region: string | null;
  readonly city: string | null;
  readonly timezone: string | null;
  /** Which provider answered, or that both failed. Useful operationally. */
  readonly provider: string;
  readonly usedFallback: boolean;
}

/** Where a submission came from. Metadata, never authorization evidence. */
export interface SubmissionSource {
  readonly origin: string;
  /** The origin's host. Null only if it somehow failed to parse after the
   *  allowlist check, which the type system cannot rule out even though the
   *  check already did. */
  readonly domain: string | null;
  readonly pageUrl: string | null;
  readonly referrer: string | null;
}

/**
 * One accepted submission (blueprint 4.6, 9.2, 9.3).
 *
 * IMMUTABLE. Blueprint 9.3 lists SubmissionEvent alongside published widget
 * revisions as records that are never updated in place: it is the evidence of
 * what a visitor actually sent, and editing it would destroy the audit value
 * that makes the canonical Contact safe to edit.
 */
export interface SubmissionEventRecord extends WorkspaceOwned {
  readonly _id: ObjectId;
  readonly contactId: ObjectId;
  readonly widgetId: ObjectId;
  /** Which published revision produced the field schema this was validated against. */
  readonly widgetRevisionNumber: number;

  /** The submitted field snapshot, keyed by field type. */
  readonly values: Readonly<Record<string, string>>;

  readonly source: SubmissionSource;
  readonly geo: GeoSnapshot | null;

  /**
   * Rotating HMAC pseudonym of the submitting IP (blueprint 9.4).
   *
   * The raw address is never stored. This exists so abuse analysis can group
   * events over a short window without creating an indefinite visitor identity.
   */
  readonly ipPseudonym: string;
  /** Which rotation period produced the pseudonym, so an old one is readable. */
  readonly ipPseudonymPeriod: string;

  /** The widget-generated key that made this submission idempotent. */
  readonly idempotencyKey: string;
  readonly submittedAt: Date;
}

export const CONSENT_EVENT_TYPES = ['opt_in', 'confirmation', 'withdrawal'] as const;
export type ConsentEventType = (typeof CONSENT_EVENT_TYPES)[number];

/**
 * Append-only consent evidence (blueprint 9.2).
 *
 * "immutable text/version snapshot" - the exact wording shown to the visitor is
 * copied in, because proving consent later means proving what they agreed TO,
 * not just that a box was ticked.
 */
export interface ConsentEventRecord extends WorkspaceOwned {
  readonly _id: ObjectId;
  readonly contactId: ObjectId;
  readonly submissionEventId: ObjectId | null;
  readonly type: ConsentEventType;
  readonly granted: boolean;
  /** The consent wording as displayed, snapshotted at the moment of consent. */
  readonly text: string;
  readonly widgetRevisionNumber: number;
  readonly occurredAt: Date;
}

// ---------------------------------------------------------------------------
// Delivery - Stage 9 (blueprint 9.2, 12.2)
// ---------------------------------------------------------------------------

/** The side-effect families this stage owns (blueprint 12.1). */
export const DELIVERY_TYPES = [
  'workspace_notification',
  'visitor_confirmation',
  'webhook',
] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

/**
 * The states blueprint 12.2 requires the dashboard to distinguish.
 *
 * `failed` and `dead_letter` are deliberately separate. A PERMANENT failure -
 * a rejected recipient, a 4xx from a webhook - is final on its first attempt
 * and was never going to succeed; a DEAD_LETTER is a transient failure that
 * exhausted its five attempts and might yet succeed if replayed. Collapsing
 * them would make the replay button meaningless on half the rows it appears on.
 */
export const DELIVERY_STATUSES = [
  'queued',
  'delayed',
  'retrying',
  'delivered',
  'failed',
  'dead_letter',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_OUTCOMES = [
  'delivered',
  'transient_failure',
  'permanent_failure',
  'deferred',
] as const;
export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

/** One attempt, kept so an operator can see what actually happened. */
export interface DeliveryAttempt {
  readonly attempt: number;
  readonly at: Date;
  readonly outcome: DeliveryOutcome;
  /** Safe, short detail. Never a recipient address, secret, or lead value. */
  readonly detail: string;
  readonly statusCode: number | null;
}

/**
 * One promised side effect and its history (blueprint 9.2, 12.2).
 *
 * This is the operator-facing record. The BullMQ job is the mechanism that
 * moves it along; the truth about what was promised, what has been tried, and
 * what may be replayed lives here in Mongo, because a queue is a work list and
 * not an audit trail - flushing Redis must not erase the record that a
 * notification was owed.
 */
export interface DeliveryRecord extends WorkspaceOwned, Timestamped {
  readonly _id: ObjectId;
  readonly type: DeliveryType;
  readonly status: DeliveryStatus;

  /** The durable promise this delivery discharges (blueprint 12.2). */
  readonly outboxEventId: ObjectId | null;
  readonly contactId: ObjectId | null;
  readonly submissionEventId: ObjectId | null;
  readonly widgetId: ObjectId | null;
  /**
   * Which endpoint a webhook delivery targets.
   *
   * Stored rather than parsed back out of the idempotency key. An earlier
   * revision derived it from the key, which worked for an original delivery
   * and broke silently for a REPLAY - whose key has a different shape - so the
   * replay failed with "unknown endpoint" instead of retrying.
   */
  readonly webhookEndpointId: ObjectId | null;

  /**
   * Stable per-workspace key. Unique, so a replayed job or a reconciled outbox
   * row cannot become a second logical notification (blueprint 12.2).
   */
  readonly idempotencyKey: string;

  /**
   * Who or what this was for, in a form safe to show and to log: an email
   * address masked to `a***@example.com`, or a webhook's host. The full
   * recipient stays on the widget's recipient list and the endpoint record.
   */
  readonly target: string;

  readonly attempts: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly lastError: string | null;
  readonly history: readonly DeliveryAttempt[];

  /**
   * Set when an operator alert has been raised for this dead letter, so the
   * alert fires once on the NEW failure rather than on every sweep that
   * notices the row (blueprint 12.2).
   */
  readonly alertedAt: Date | null;

  /** Which delivery this one replays, when an operator pressed the button. */
  readonly replayOfId: ObjectId | null;

  /** 90-day retention (blueprint 9.5), enforced by a TTL index. */
  readonly expiresAt: Date;
}

/**
 * A configured webhook destination (blueprint 9.2, 12.4).
 *
 * The signing secret is stored encrypted with the same AES-256-GCM cipher that
 * protects TOTP seeds - blueprint 12.4 groups them explicitly - so a database
 * dump does not hand over the ability to forge signed payloads.
 */
export interface WebhookEndpointRecord extends WorkspaceOwned, Timestamped {
  readonly _id: ObjectId;
  /** Null means every widget in the workspace. */
  readonly widgetId: ObjectId | null;
  readonly url: string;
  readonly enabled: boolean;

  readonly secret: EncryptedValue;
  readonly secretVersion: number;

  /**
   * The previous secret, still accepted during a rotation overlap so a
   * receiver can migrate without dropping a payload (blueprint 12.4). Both
   * signatures are sent while this is live; it is cleared once it retires.
   */
  readonly previousSecret: EncryptedValue | null;
  readonly previousSecretRetiresAt: Date | null;
  readonly lastRotatedAt: Date | null;
}

export const RECIPIENT_KINDS = ['workspace_user', 'external'] as const;
export type RecipientKind = (typeof RECIPIENT_KINDS)[number];

/**
 * Who gets told about a submission (blueprint 12.3).
 *
 * Two kinds, and the distinction is a security one rather than bookkeeping. A
 * `workspace_user` is already a verified member of this tenant, so their
 * address needs no further proof. An `external` address is one somebody typed
 * into a settings form, and sending to it unverified would turn the product
 * into an open relay pointed at any address an attacker chose - so it carries
 * its own hashed, expiring confirmation token, exactly like an invitation.
 */
export interface NotificationRecipientRecord extends WorkspaceOwned, Timestamped {
  readonly _id: ObjectId;
  readonly widgetId: ObjectId;
  readonly email: string;
  readonly normalizedEmail: string;
  readonly kind: RecipientKind;
  /** Set for `workspace_user`, so a removed member's address stops resolving. */
  readonly userId: ObjectId | null;
  readonly verifiedAt: Date | null;
  readonly verification: PendingToken | null;
}

export const ABUSE_EVENT_TYPES = ['honeypot', 'timing', 'rate_limit', 'quota'] as const;
export type AbuseEventType = (typeof ABUSE_EVENT_TYPES)[number];

/**
 * Minimal abuse evidence (blueprint 7.4).
 *
 * The blueprint enumerates exactly what may be stored and why the list is
 * short: "This lets the dashboard prove protection without turning rejected
 * spam into a shadow lead database." There is deliberately no field for
 * captured values, so none can be added by accident.
 */
export interface AbuseEventRecord extends WorkspaceOwned {
  readonly _id: ObjectId;
  readonly widgetId: ObjectId;
  readonly type: AbuseEventType;
  readonly ipPseudonym: string;
  readonly ipPseudonymPeriod: string;
  /** Coarse source only: the origin host. Never a page URL or field value. */
  readonly domain: string | null;
  readonly occurredAt: Date;
}
