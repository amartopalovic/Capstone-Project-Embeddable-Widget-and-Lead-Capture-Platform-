/**
 * Contact inbox contracts (blueprint sections 4.6, 4.7, 9.3, 11).
 *
 * Every shape the inbox exchanges is defined once, here, so the API, the
 * dashboard, and the export share one definition of what a filter is and what a
 * contact looks like on the wire. Stage 8b's UI consumes these rather than
 * restating them.
 */

import * as z from 'zod';
import type { ConsentStateValue } from './privacy.js';
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from './pagination.js';
// The same address rule the auth surface uses, so an edited contact email and a
// registered account email cannot disagree about what is valid.
import { emailSchema } from './auth.js';

/** Blueprint 4.6 lists the five lead statuses, in this order. */
export const CONTACT_STATUS_VALUES = [
  'new',
  'contacted',
  'qualified',
  'converted',
  'archived',
] as const;
export type ContactStatusValue = (typeof CONTACT_STATUS_VALUES)[number];

/**
 * The fields the inbox may sort by (blueprint 4.7: "deterministic sorting").
 *
 * A closed list rather than an arbitrary field name: sorting on an unindexed
 * field would be a collection scan a caller could trigger at will, and a cursor
 * can only resume from a field the server knows how to compare.
 */
export const CONTACT_SORT_FIELDS = ['lastSubmissionAt', 'createdAt', 'normalizedEmail'] as const;
export type ContactSortField = (typeof CONTACT_SORT_FIELDS)[number];

export const MAX_SEARCH_LENGTH = 200;
export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS_PER_CONTACT = 25;
export const MAX_NOTE_LENGTH = 2000;
/** One bulk request may not become an unbounded write. */
export const MAX_BULK_IDS = 200;

const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/, 'Must be a 24-character identifier');

/**
 * The inbox filter (blueprint 4.7).
 *
 * Exactly the dimensions the blueprint enumerates - search, status, date,
 * widget, domain, page URL, assignee, tag, country, city - and nothing else. An
 * unknown query parameter is ignored rather than rejected, so a future UI
 * cannot be broken by a stale bookmark.
 */
export const contactFilterSchema = z.object({
  search: z.string().trim().min(1).max(MAX_SEARCH_LENGTH).optional(),
  /**
   * Accepts `?status=new` as well as `?status=new&status=contacted`.
   *
   * Express parses a query parameter that appears once as a STRING and one
   * that repeats as an array, so a schema that only accepted an array rejected
   * the single-status filter every real UI sends first.
   */
  status: z
    .union([z.enum(CONTACT_STATUS_VALUES), z.array(z.enum(CONTACT_STATUS_VALUES)).min(1)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
  submittedAfter: z.coerce.date().optional(),
  submittedBefore: z.coerce.date().optional(),
  widgetId: objectIdSchema.optional(),
  domain: z.string().trim().min(1).max(253).optional(),
  pageUrl: z.string().trim().min(1).max(2048).optional(),
  /** The literal string "unassigned" selects contacts with no assignee. */
  assigneeUserId: z.union([objectIdSchema, z.literal('unassigned')]).optional(),
  tag: z.string().trim().min(1).max(MAX_TAG_LENGTH).optional(),
  country: z.string().trim().length(2).toUpperCase().optional(),
  city: z.string().trim().min(1).max(120).optional(),
});
export type ContactFilter = z.infer<typeof contactFilterSchema>;

export const contactListQuerySchema = contactFilterSchema.extend({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: z.enum(CONTACT_SORT_FIELDS).default('lastSubmissionAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});
export type ContactListQuery = z.infer<typeof contactListQuerySchema>;

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const tagSchema = z.string().trim().min(1).max(MAX_TAG_LENGTH);

/**
 * Workflow state, which every role may change (blueprint 11).
 *
 * At least one field must be present, so an empty body cannot produce an
 * activity entry recording that nothing happened.
 */
export const updateWorkflowSchema = z
  .object({
    status: z.enum(CONTACT_STATUS_VALUES).optional(),
    assigneeUserId: z.union([objectIdSchema, z.null()]).optional(),
    tags: z.array(tagSchema).max(MAX_TAGS_PER_CONTACT).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to change',
  });
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;

export const addNoteSchema = z.object({
  note: z.string().trim().min(1).max(MAX_NOTE_LENGTH),
});

/**
 * Canonical values, which only Owner/Admin may change (blueprint 11), and only
 * against the version they read (blueprint 9.3).
 *
 * `expectedVersion` is required, not optional. An optional precondition is one
 * a client can forget, and a forgotten precondition is a silent overwrite -
 * which is the single failure this endpoint exists to prevent.
 */
export const updateCanonicalSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    email: emailSchema.optional(),
    name: z.union([z.string().trim().max(200), z.null()]).optional(),
    phone: z.union([z.string().trim().max(60), z.null()]).optional(),
    company: z.union([z.string().trim().max(200), z.null()]).optional(),
  })
  .refine((value) => Object.keys(value).length > 1, {
    message: 'Provide at least one field to change',
  });
export type UpdateCanonicalInput = z.infer<typeof updateCanonicalSchema>;

export const mergeContactsSchema = z.object({
  /** The contact that survives and keeps its canonical values. */
  survivorId: objectIdSchema,
  /** The contact whose events and activities move to the survivor. */
  duplicateId: objectIdSchema,
});
export type MergeContactsInput = z.infer<typeof mergeContactsSchema>;

/**
 * Bulk actions (blueprint 4.7).
 *
 * The role split is NOT encoded here. Which actions a role may take is decided
 * by the section 11 capability matrix on the server, so this list is the set of
 * actions that exist, not the set any particular caller may use.
 */
export const CONTACT_BULK_ACTIONS = [
  'status',
  'assign',
  'tag',
  'untag',
  'archive',
  'delete',
] as const;
export type ContactBulkAction = (typeof CONTACT_BULK_ACTIONS)[number];

export const bulkActionSchema = z.object({
  action: z.enum(CONTACT_BULK_ACTIONS),
  contactIds: z.array(objectIdSchema).min(1).max(MAX_BULK_IDS),
  status: z.enum(CONTACT_STATUS_VALUES).optional(),
  assigneeUserId: z.union([objectIdSchema, z.null()]).optional(),
  tag: tagSchema.optional(),
});
export type BulkActionInput = z.infer<typeof bulkActionSchema>;

export const EXPORT_FORMATS = ['csv', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const exportQuerySchema = contactFilterSchema.extend({
  format: z.enum(EXPORT_FORMATS).default('csv'),
  sort: z.enum(CONTACT_SORT_FIELDS).default('lastSubmissionAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});
export type ExportQuery = z.infer<typeof exportQuerySchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** One row of the inbox. */
export interface ContactSummary {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly phone: string | null;
  readonly company: string | null;
  readonly status: ContactStatusValue;
  readonly assigneeUserId: string | null;
  readonly tags: readonly string[];
  readonly firstSubmissionAt: string;
  readonly lastSubmissionAt: string;
  readonly submissionCount: number;
  /**
   * Marketing consent (blueprint 4.8), added in Stage 11.
   *
   * On the summary rather than only the detail, because a team looking at a
   * lead needs to know whether they may email it before they open anything -
   * and because "did they unsubscribe" is the question that gets a company in
   * trouble when it is one click away rather than in view.
   */
  readonly consentState: ConsentStateValue;
  /** The value a canonical edit must echo back (blueprint 9.3). */
  readonly version: number;
  /** Which canonical fields a human has edited, so the UI can mark them. */
  readonly manuallyEditedFields: readonly string[];
}

export interface ContactPage {
  readonly contacts: readonly ContactSummary[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface ContactTimelineSubmission {
  readonly id: string;
  readonly widgetId: string;
  readonly widgetRevisionNumber: number;
  readonly values: Readonly<Record<string, string>>;
  readonly domain: string | null;
  readonly pageUrl: string | null;
  readonly country: string | null;
  readonly city: string | null;
  readonly submittedAt: string;
}

export interface ContactTimelineActivity {
  readonly id: string;
  readonly type: string;
  readonly actorUserId: string | null;
  readonly note: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

export interface ContactConsentEntry {
  readonly id: string;
  readonly type: string;
  readonly granted: boolean;
  readonly text: string;
  readonly occurredAt: string;
}

export interface ContactDetail {
  readonly contact: ContactSummary;
  readonly submissions: readonly ContactTimelineSubmission[];
  readonly activities: readonly ContactTimelineActivity[];
  readonly consent: readonly ContactConsentEntry[];
  /** Which actions this caller may take, derived server-side from section 11. */
  readonly allowedActions: readonly ContactBulkAction[];
  readonly canEditCanonical: boolean;
  readonly canExport: boolean;
}

// ---------------------------------------------------------------------------
// Live updates (blueprint 13.1)
// ---------------------------------------------------------------------------

/**
 * Event names carried on the workspace SSE stream.
 *
 * Blueprint 13.1 names four families. Stage 8a emits contact events; the other
 * names exist so Stages 9 and 10 attach to a stream that already knows about
 * them rather than redefining the contract.
 */
export const WORKSPACE_EVENT_TYPES = [
  'contact.created',
  'contact.updated',
  'submission.received',
  'usage.changed',
  'delivery.status_changed',
] as const;
export type WorkspaceEventType = (typeof WORKSPACE_EVENT_TYPES)[number];

export interface WorkspaceEvent {
  /** Monotonic within a process; sent as the SSE `id:` field. */
  readonly id: string;
  readonly type: WorkspaceEventType;
  readonly occurredAt: string;
  readonly data: Readonly<Record<string, unknown>>;
}
