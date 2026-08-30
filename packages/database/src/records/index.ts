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
/**
 * The actor a deleted account's history points at (blueprint 9.5).
 *
 * "memberships/profile removed and historical actor references anonymized" -
 * anonymized, not deleted and not left dangling. Cascade-deleting an audit
 * trail because its author closed their account would destroy the workspace's
 * accountability record; leaving the id would keep identifying them.
 *
 * A reserved id rather than null, so every actor field - including the ones
 * that are not nullable, like a revision's creator - anonymizes the same way
 * and nothing has to distinguish "system did this" from "a person who has since
 * left did this".
 */
export const ANONYMOUS_ACTOR_HEX = '000000000000000000000000';

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
  /** Single or double opt-in for marketing consent. Default double (4.8). */
  readonly optInMode: OptInMode;
  readonly status: RecordStatus;
  readonly deletedAt: Date | null;
  readonly purgeAfter: Date | null;
}

export const DEFAULT_RETENTION_DAYS = 365;

/**
 * The retention choices a workspace may pick (blueprint 4.8).
 *
 * "Recommended retention choices exposed to the workspace are 30 days, 90 days,
 * 12 months, or indefinite." A closed list rather than a free number, so a typo
 * cannot set retention to three days and quietly destroy a lead database.
 *
 * Indefinite is 0, not a very large number and not null: the field is
 * `retentionDays: number`, and a sweep asking "has this passed its deadline?"
 * should get a clear "there is no deadline" rather than arithmetic on a
 * sentinel that happens to be far away.
 */
export const RETENTION_INDEFINITE = 0;
export const RETENTION_PRESET_DAYS = [30, 90, 365, RETENTION_INDEFINITE] as const;
export type RetentionPreset = (typeof RETENTION_PRESET_DAYS)[number];

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

  // --- consent and retention (blueprint 4.8, 9.5) -------------------------

  /** Marketing consent state. Enforcement lives in the suppression list. */
  readonly consentState: ConsentState;
  readonly consentUpdatedAt: Date | null;

  /**
   * What active-contact retention counts from (blueprint 9.5).
   *
   * "measured from the latest retained submission or intentional workspace
   * activity on that Contact" - so it is NOT `updatedAt`, which a bulk re-tag
   * or a merge bookkeeping write would push forward, quietly granting another
   * twelve months to a record nobody actually touched. It moves on a new
   * submission and on deliberate human work: status, assignment, tags, notes,
   * and canonical edits.
   */
  readonly retentionAnchorAt: Date;

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
  /**
   * A stable fingerprint of that wording (blueprint 4.8: "text/version").
   *
   * Derived from the text rather than typed by a human, so two contacts who saw
   * the same sentence always share a version and a reworded sentence always
   * gets a new one. A hand-maintained version number would drift the moment
   * somebody edited the label without thinking about consent.
   */
  readonly textVersion: string;
  readonly source: ConsentSource;
  readonly widgetRevisionNumber: number;
  /**
   * The rotating visitor pseudonym, when the event came from a widget
   * (blueprint 4.8: "relevant pseudonymous metadata", 9.4). Null for events
   * raised from an emailed link, which has no visitor session behind it.
   */
  readonly ipPseudonym: string | null;
  readonly occurredAt: Date;
}

// ---------------------------------------------------------------------------
// Analytics - Stage 10a (blueprint 4.9, 9.2, 13.2)
// ---------------------------------------------------------------------------

/** The five funnel events the runtime records (blueprint 4.9). */
export const INTERACTION_EVENT_TYPES = [
  'impression',
  'open',
  'cta_click',
  'form_start',
  'submission',
] as const;
export type InteractionEventType = (typeof INTERACTION_EVENT_TYPES)[number];

/**
 * One raw funnel event (blueprint 9.2, 13.2 step 2).
 *
 * "Raw events are stored with widget, source, time, and rotating pseudonymous
 * visitor ID." Note what is NOT here: no IP, no user agent, no cookie, no
 * device fingerprint. Blueprint 9.4 allows a rotating pseudonym precisely so
 * short-term funnel analysis is possible without building an indefinite visitor
 * identity, and the record has no field for anything stronger.
 *
 * These expire at 90 days, but NOT by TTL index - see migration 009. A TTL
 * deletes on a clock alone, and 13.2 step 5 requires the aggregate to exist
 * first.
 */
export interface InteractionEventRecord extends WorkspaceOwned {
  readonly _id: ObjectId;
  readonly widgetId: ObjectId;
  readonly type: InteractionEventType;

  /**
   * The rotating pseudonym, derived exactly like the submission path's
   * (blueprint 9.4). It is what makes "how many DISTINCT visitors" answerable
   * within a month and unanswerable across months, which is the point.
   */
  readonly visitorPseudonym: string;
  readonly visitorPseudonymPeriod: string;

  readonly source: SubmissionSource;
  readonly geo: GeoSnapshot | null;
  readonly occurredAt: Date;

  /**
   * The day this event belongs to, in the WORKSPACE's timezone, as
   * `YYYY-MM-DD`.
   *
   * Stored rather than derived at aggregation time. A workspace in Auckland and
   * one in Los Angeles disagree about which day a given instant falls in, and
   * recomputing that during a sweep would mean re-reading every workspace's
   * timezone for every event. Fixing it at write time also means a workspace
   * that later changes its timezone does not silently rewrite its own history.
   */
  readonly localDay: string;
}

/** How a daily aggregate is sliced (blueprint 9.2: "workspace/widget/day/dimensions"). */
export const ANALYTICS_DIMENSIONS = ['total', 'domain', 'page', 'country', 'city'] as const;
export type AnalyticsDimension = (typeof ANALYTICS_DIMENSIONS)[number];

/**
 * Durable daily counters (blueprint 9.2, 13.2 step 3).
 *
 * One document per workspace, day, widget, and dimension slice. The `total`
 * dimension carries the widget's day as a whole; the others carry one row per
 * distinct domain, page, country, or city, which is what makes 4.9's "country
 * and city breakdown" and "top allowed domains and page URLs" answerable
 * without keeping the raw events that produced them.
 *
 * These outlive the raw events deliberately: 4.9 retains raw interaction data
 * for 90 days and keeps the aggregates, so a workspace's history survives while
 * the visitor-level detail does not.
 */
export interface DailyAnalyticsRecord extends WorkspaceOwned {
  readonly _id: ObjectId;
  /** `YYYY-MM-DD` in the workspace's timezone. */
  readonly day: string;
  readonly widgetId: ObjectId;
  readonly dimension: AnalyticsDimension;
  /** Null only for the `total` dimension. */
  readonly dimensionValue: string | null;

  readonly impressions: number;
  readonly opens: number;
  readonly ctaClicks: number;
  readonly formStarts: number;
  readonly submissions: number;
  /**
   * Distinct pseudonyms seen that day in this slice.
   *
   * A count, not a list - keeping the pseudonyms would let the aggregate
   * outlive the 90-day raw retention it is supposed to replace.
   */
  readonly visitors: number;

  /**
   * Whether the widget could be OPENED at all.
   *
   * Blueprint 13.2 says "open rate = opens / eligible impressions", and the
   * qualifier matters: an inline widget is always visible and has no open
   * action, so counting its impressions in the denominator would drag every
   * workspace's open rate toward zero for a reason that is not about
   * performance.
   */
  readonly openEligible: boolean;

  readonly computedAt: Date;
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

// ---------------------------------------------------------------------------
// Consent and contact privacy - Stage 11 (blueprint 4.8, 9.2, 9.5)
// ---------------------------------------------------------------------------

/**
 * How a workspace collects marketing consent (blueprint 4.8).
 *
 * "Workspace-selectable single or double opt-in; default double." Double means
 * a ticked box is a REQUEST to be contacted, not permission: the address has to
 * confirm itself before anything marketing is sent to it.
 */
export const OPT_IN_MODES = ['single', 'double'] as const;
export type OptInMode = (typeof OPT_IN_MODES)[number];
export const DEFAULT_OPT_IN_MODE: OptInMode = 'double';

/**
 * A Contact's marketing consent state.
 *
 * `none`   - never asked, or asked and declined the box.
 * `pending` - ticked the box under double opt-in; not yet confirmed.
 * `confirmed` - may receive marketing mail.
 * `withdrawn` - unsubscribed. Terminal for marketing purposes: a later
 *   submission does not silently re-subscribe them, because a ticked box on a
 *   form is weaker evidence than a deliberate unsubscribe.
 */
export const CONSENT_STATES = ['none', 'pending', 'confirmed', 'withdrawn'] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

/** Where a consent event came from (blueprint 4.8: "source"). */
export const CONSENT_SOURCES = ['widget_form', 'double_opt_in_email', 'unsubscribe_link'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/**
 * Workspace-wide marketing suppression (blueprint 4.8).
 *
 * Deliberately a SEPARATE record from the Contact, and deliberately keyed by a
 * hash rather than the address itself. Both follow from one sentence in 4.8:
 * an email-verified deletion removes the contact's PII, but "minimal
 * suppression data may remain when necessary to honor an unsubscribe". If
 * suppression lived on the Contact it would die with it, and the next
 * submission from that address would start sending again - which is the exact
 * failure the unsubscribe existed to prevent.
 *
 * The hash is what makes what remains minimal: it answers "is this address
 * suppressed?" for an address someone already has, and cannot be read back into
 * a mailing list.
 */
export interface SuppressionRecord extends WorkspaceOwned {
  readonly _id: ObjectId;
  /** SHA-256 of the normalized address, workspace-salted. Never the address. */
  readonly emailHash: string;
  readonly suppressedAt: Date;
  /** Kept so a support question can be answered without storing the address. */
  readonly reason: 'unsubscribed' | 'privacy_deletion';
}

/** What a verified privacy request is asking for (blueprint 4.8). */
export const PRIVACY_REQUEST_KINDS = ['export', 'deletion'] as const;
export type PrivacyRequestKind = (typeof PRIVACY_REQUEST_KINDS)[number];

/**
 * The lifecycle of a self-service privacy request.
 *
 * `pending_verification` - created, email sent, nothing proven yet.
 * `verified` - the address proved control; the request may now be acted on.
 * `completed` - the export was served, or the deletion was carried out.
 * `expired` - the token ran out before it was used.
 */
export const PRIVACY_REQUEST_STATUSES = [
  'pending_verification',
  'verified',
  'completed',
  'expired',
] as const;
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];

/**
 * A contact's own export or deletion request (blueprint 4.8, 9.2).
 *
 * The verification step is the account-verification flow's, not a lighter one:
 * a single-use token, stored only as a hash, with an expiry. Anything weaker
 * would let a stranger who guesses an address export somebody else's lead
 * record - so the token IS the authorization, and there is no other way in.
 */
export interface PrivacyRequestRecord extends WorkspaceOwned, Timestamped {
  readonly _id: ObjectId;
  readonly contactId: ObjectId;
  /**
   * The address as it was when the request was made.
   *
   * Present while the request is live because the confirmation email has to go
   * somewhere; cleared when a deletion completes, since keeping it would defeat
   * the deletion it was created to perform.
   */
  readonly email: string | null;
  readonly normalizedEmail: string;
  readonly kind: PrivacyRequestKind;
  readonly status: PrivacyRequestStatus;
  /** SHA-256 of the single-use token. The plaintext lives only in the email. */
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly verifiedAt: Date | null;
  readonly completedAt: Date | null;
}
