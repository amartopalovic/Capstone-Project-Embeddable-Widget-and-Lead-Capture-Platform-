import type { ClientSession, Db, Filter, WithId } from 'mongodb';
import { ObjectId } from 'mongodb';
import {
  COLLECTIONS,
  type ContactActivityRepository,
  type ContactRepository,
  type SubmissionEventRepository,
  type ConsentEventRecord,
  type ContactActivityRecord,
  type ContactActivityType,
  type ContactRecord,
  type WorkspaceScope,
} from '@lcp/database';
import {
  isRevisionStale,
  type ContactBulkAction,
  type ContactDetail,
  type ContactFilter,
  type ContactListQuery,
  type ContactPage,
  type ContactSortField,
  type ContactSummary,
  type ExportQuery,
  type Logger,
  type UpdateCanonicalInput,
  type UpdateWorkflowInput,
} from '@lcp/contracts';
import {
  applyResolvedIds,
  planContactQuery,
  submissionValueSearch,
  touchesSubmissions,
} from '../../domain/contact/search.js';
import {
  contactSort,
  decodeContactCursor,
  encodeContactCursor,
  keysetFilter,
  positionOf,
  withKeyset,
} from '../../domain/contact/cursor.js';
import { allowedBulkActions } from '../../domain/contact/bulk.js';
import { planMerge } from '../../domain/contact/merge.js';
import { can, type PolicySubject } from '../../domain/workspace/capabilities.js';
import type { Clock } from '../../ports/clock.js';
import type { WorkspaceAuditPort } from '../workspace/types.js';

/**
 * The contact inbox (blueprint 4.6, 4.7, 9.3, 9.5).
 *
 * Every method takes an explicit WorkspaceScope derived from session context,
 * and an Actor - because blueprint 9.3 requires that every delete, restore, and
 * merge record "the actor and request correlation ID", and an actor that is
 * optional is an actor that gets omitted.
 */

/** How many submission events one search may resolve to contact ids. */
const SEARCH_RESOLUTION_LIMIT = 5_000;
/** The trash window from blueprint 9.5. */
const TRASH_DAYS = 30;

export interface Actor {
  readonly userId: ObjectId;
  readonly correlationId: string;
  readonly subject: PolicySubject;
}

export type ContactWriteResult =
  | { readonly kind: 'ok'; readonly contact: ContactSummary }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'stale'; readonly currentVersion: number }
  | { readonly kind: 'conflict'; readonly reason: string };

export type MergeResult =
  | {
      readonly kind: 'ok';
      readonly contact: ContactSummary;
      readonly movedSubmissions: number;
      readonly movedActivities: number;
    }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'conflict'; readonly reason: string };

export interface BulkResult {
  readonly changed: number;
  readonly contactIds: readonly string[];
}

export interface ContactServiceDeps {
  readonly db: Db;
  readonly contacts: ContactRepository;
  readonly activities: ContactActivityRepository;
  readonly submissions: SubmissionEventRepository;
  readonly audit: WorkspaceAuditPort;
  readonly clock: Clock;
  readonly logger: Logger;
}

export function toSummary(contact: WithId<ContactRecord>): ContactSummary {
  return {
    id: contact._id.toHexString(),
    email: contact.email,
    name: contact.name,
    phone: contact.phone,
    company: contact.company,
    status: contact.status,
    assigneeUserId: contact.assigneeUserId?.toHexString() ?? null,
    tags: contact.tags,
    firstSubmissionAt: contact.firstSubmissionAt.toISOString(),
    lastSubmissionAt: contact.lastSubmissionAt.toISOString(),
    submissionCount: contact.submissionCount,
    consentState: contact.consentState,
    version: contact.version,
    manuallyEditedFields: contact.manuallyEditedFields,
  };
}

export class ContactService {
  readonly #deps: ContactServiceDeps;

  constructor(deps: ContactServiceDeps) {
    this.#deps = deps;
  }

  // ------------------------------------------------------------------ read

  /**
   * Resolve a filter to the Mongo query the list and the export both run.
   *
   * Shared deliberately: blueprint 4.7 requires the export to match "the
   * caller's active filters exactly", and the only way to guarantee that is for
   * there to be one query builder rather than two that are meant to agree.
   */
  async #buildFilter(
    scope: WorkspaceScope,
    filter: ContactFilter,
    recordStatus: ContactRecord['recordStatus'],
  ): Promise<Filter<ContactRecord>> {
    const plan = planContactQuery(filter, recordStatus);

    if (!touchesSubmissions(filter)) return plan.contactFilter;

    let narrowingIds: ObjectId[] | null = null;
    if (plan.submissionFilter !== null) {
      narrowingIds = await this.#deps.submissions.distinctContactIds(
        scope,
        plan.submissionFilter,
        SEARCH_RESOLUTION_LIMIT,
      );
    }

    let searchMatchIds: ObjectId[] | null = null;
    if (plan.searchesSubmissionValues && filter.search !== undefined) {
      searchMatchIds = await this.#deps.submissions.distinctContactIds(
        scope,
        submissionValueSearch(filter.search),
        SEARCH_RESOLUTION_LIMIT,
      );
    }

    return applyResolvedIds(plan, narrowingIds, searchMatchIds);
  }

  async list(scope: WorkspaceScope, query: ContactListQuery): Promise<ContactPage> {
    const base = await this.#buildFilter(scope, query, 'active');
    return this.#pageFrom(scope, base, query.sort, query.direction, query.limit, query.cursor);
  }

  /** The 30-day contact trash (blueprint 9.5), same builder, deleted records. */
  async listTrash(scope: WorkspaceScope, query: ContactListQuery): Promise<ContactPage> {
    const base = await this.#buildFilter(scope, query, 'deleted');
    return this.#pageFrom(scope, base, query.sort, query.direction, query.limit, query.cursor);
  }

  async #pageFrom(
    scope: WorkspaceScope,
    base: Filter<ContactRecord>,
    sort: ContactSortField,
    direction: 'asc' | 'desc',
    limit: number,
    cursor: string | undefined,
  ): Promise<ContactPage> {
    const position = cursor === undefined ? null : decodeContactCursor(cursor);
    const filter = withKeyset(
      base,
      position === null ? null : keysetFilter(sort, direction, position),
    );

    /**
     * One extra row is fetched to answer "is there another page" without a
     * second count query - and without the lie a count would tell anyway, since
     * rows can arrive between the two.
     */
    const rows = await this.#deps.contacts.page(
      scope,
      filter,
      contactSort(sort, direction),
      limit + 1,
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      contacts: page.map(toSummary),
      nextCursor:
        hasMore && last !== undefined ? encodeContactCursor(positionOf(last, sort)) : null,
      hasMore,
    };
  }

  /** Canonical values plus the immutable timeline behind them (blueprint 4.6). */
  async detail(
    scope: WorkspaceScope,
    contactId: ObjectId,
    subject: PolicySubject,
  ): Promise<ContactDetail | null> {
    const contact = await this.#deps.contacts.findById(scope, contactId);
    if (contact === null || contact.recordStatus === 'merged') return null;

    const [submissions, activities, consent] = await Promise.all([
      this.#deps.submissions.listForContact(scope, contactId),
      this.#deps.activities.listForContact(scope, contactId),
      this.#deps.db
        .collection<ConsentEventRecord>(COLLECTIONS.consentEvents)
        .find({ workspaceId: scope.workspaceId, contactId })
        .sort({ occurredAt: -1 })
        .toArray(),
    ]);

    return {
      contact: toSummary(contact),
      submissions: submissions.map((event) => ({
        id: event._id.toHexString(),
        widgetId: event.widgetId.toHexString(),
        widgetRevisionNumber: event.widgetRevisionNumber,
        values: event.values,
        domain: event.source.domain,
        pageUrl: event.source.pageUrl,
        country: event.geo?.countryCode ?? null,
        city: event.geo?.city ?? null,
        submittedAt: event.submittedAt.toISOString(),
      })),
      activities: activities.map((entry) => ({
        id: entry._id.toHexString(),
        type: entry.type,
        actorUserId: entry.actorUserId?.toHexString() ?? null,
        note: entry.note,
        metadata: entry.metadata,
        occurredAt: entry.occurredAt.toISOString(),
      })),
      consent: consent.map((entry) => ({
        id: entry._id.toHexString(),
        type: entry.type,
        granted: entry.granted,
        text: entry.text,
        occurredAt: entry.occurredAt.toISOString(),
      })),
      /**
       * The UI's action list is DERIVED from the same matrix the routes
       * enforce, so the browser never holds its own copy of the role rules -
       * the pattern established for workspace members in Stage 4.
       */
      allowedActions: allowedBulkActions(subject),
      canEditCanonical: can(subject, 'contact.canonical.write'),
      canExport: can(subject, 'contact.export'),
    };
  }

  // ----------------------------------------------------------------- write

  /**
   * Status, assignee, and tags - the collaboration fields every role may
   * change (blueprint 11), each one recorded as an activity entry (9.2).
   */
  async updateWorkflow(
    scope: WorkspaceScope,
    contactId: ObjectId,
    input: UpdateWorkflowInput,
    actor: Actor,
  ): Promise<ContactWriteResult> {
    const before = await this.#deps.contacts.findById(scope, contactId);
    if (before === null || before.recordStatus !== 'active') return { kind: 'not_found' };

    const now = this.#deps.clock.now();
    const set: Record<string, unknown> = { updatedAt: now };
    const entries: { type: ContactActivityType; metadata: Record<string, unknown> }[] = [];

    if (input.status !== undefined && input.status !== before.status) {
      set['status'] = input.status;
      entries.push({
        type: 'status_changed',
        metadata: { from: before.status, to: input.status },
      });
    }

    if (input.assigneeUserId !== undefined) {
      const next = input.assigneeUserId === null ? null : new ObjectId(input.assigneeUserId);
      const changed = (before.assigneeUserId?.toHexString() ?? null) !== input.assigneeUserId;
      if (changed) {
        set['assigneeUserId'] = next;
        entries.push({
          type: 'assignee_changed',
          metadata: {
            from: before.assigneeUserId?.toHexString() ?? null,
            to: input.assigneeUserId,
          },
        });
      }
    }

    if (input.tags !== undefined) {
      // Deduplicated and ordered, so "added a tag twice" is not a change and
      // two clients sending the same set in different orders agree.
      const next = [...new Set(input.tags)].sort();
      if (!sameTags(next, before.tags)) {
        set['tags'] = next;
        entries.push({ type: 'tags_changed', metadata: { from: before.tags, to: next } });
      }
    }

    if (entries.length === 0) return { kind: 'ok', contact: toSummary(before) };

    const updated = await this.#deps.contacts.updateWorkflow(scope, contactId, set);
    if (updated === null) return { kind: 'not_found' };

    for (const entry of entries) {
      await this.#recordActivity(scope, contactId, entry.type, actor, null, entry.metadata);
    }

    return { kind: 'ok', contact: toSummary(updated) };
  }

  async addNote(
    scope: WorkspaceScope,
    contactId: ObjectId,
    note: string,
    actor: Actor,
  ): Promise<ContactWriteResult> {
    const contact = await this.#deps.contacts.findById(scope, contactId);
    if (contact === null || contact.recordStatus !== 'active') return { kind: 'not_found' };

    await this.#recordActivity(scope, contactId, 'note_added', actor, note, {});
    return { kind: 'ok', contact: toSummary(contact) };
  }

  /**
   * A canonical edit, guarded by the version the caller read (blueprint 9.3).
   *
   * Two different overwrites are prevented by one mechanism, which is why the
   * guard is on the record's `version` rather than on an edit-only counter:
   *
   *  - a TEAMMATE's concurrent edit bumps the version, so the second edit is
   *    refused rather than silently winning;
   *  - a later SUBMISSION also bumps the version (the Stage 7 upsert does), so
   *    an edit composed against values a submission has since refreshed is
   *    refused too. The editor is shown the newer values and decides.
   *
   * The complementary half - a submission never overwriting an edited value -
   * is `manuallyEditedFields`, which this method extends. Concurrency protects
   * the human from the machine at write time; the field list protects the
   * human's decision afterwards, permanently.
   */
  async updateCanonical(
    scope: WorkspaceScope,
    contactId: ObjectId,
    input: UpdateCanonicalInput,
    actor: Actor,
  ): Promise<ContactWriteResult> {
    const before = await this.#deps.contacts.findById(scope, contactId);
    if (before === null || before.recordStatus !== 'active') return { kind: 'not_found' };

    if (isRevisionStale(before.version, { expectedRevision: input.expectedVersion })) {
      return { kind: 'stale', currentVersion: before.version };
    }

    const now = this.#deps.clock.now();
    const set: Record<string, unknown> = { updatedAt: now };
    const edited = new Set(before.manuallyEditedFields);
    const changes: Record<string, unknown> = {};

    if (input.email !== undefined && input.email !== before.email) {
      const normalized = input.email.trim().toLowerCase();
      /**
       * A contact is unique by normalized email within a workspace (4.6), so
       * an edit that collides with another lead is a conflict rather than a
       * merge - merging is a separate, deliberate action with its own audit
       * trail, and doing it implicitly here would destroy a record the editor
       * never named.
       */
      const clash = await this.#deps.contacts.findByNormalizedEmail(scope, normalized);
      if (clash !== null && !clash._id.equals(contactId)) {
        return { kind: 'conflict', reason: 'email_in_use' };
      }
      set['email'] = input.email;
      set['normalizedEmail'] = normalized;
      edited.add('email');
      changes['email'] = true;
    }

    for (const field of ['name', 'phone', 'company'] as const) {
      const value = input[field];
      if (value === undefined) continue;
      const next = value === null || value.trim() === '' ? null : value.trim();
      if (next === before[field]) continue;
      set[field] = next;
      edited.add(field);
      changes[field] = true;
    }

    if (Object.keys(changes).length === 0) return { kind: 'ok', contact: toSummary(before) };

    set['manuallyEditedFields'] = [...edited].sort();

    const updated = await this.#deps.contacts.updateIfVersionMatches(
      scope,
      contactId,
      input.expectedVersion,
      set,
    );
    /**
     * A null here means the version moved between the read above and this
     * write - a genuinely concurrent edit, caught by the atomic guard rather
     * than by the earlier check. Re-reading gives the caller the current
     * version to retry against.
     */
    if (updated === null) {
      const current = await this.#deps.contacts.findById(scope, contactId);
      return current === null
        ? { kind: 'not_found' }
        : { kind: 'stale', currentVersion: current.version };
    }

    await this.#recordActivity(scope, contactId, 'canonical_edited', actor, null, {
      // Which fields changed, never the values themselves - an activity entry
      // is a history of decisions, not a second copy of the lead's PII.
      fields: Object.keys(changes).sort(),
    });

    return { kind: 'ok', contact: toSummary(updated) };
  }

  // ----------------------------------------------------------------- merge

  /**
   * Merge a duplicate into a survivor (blueprint 9.3).
   *
   * Everything happens in one transaction, because a half-merged pair is worse
   * than either outcome: submission events pointing at a contact that was never
   * retired, or a retired contact whose events still point at it and are
   * therefore invisible in both timelines.
   */
  async merge(
    scope: WorkspaceScope,
    survivorId: ObjectId,
    duplicateId: ObjectId,
    actor: Actor,
  ): Promise<MergeResult> {
    if (survivorId.equals(duplicateId)) {
      return { kind: 'conflict', reason: 'same_contact' };
    }

    const [survivor, duplicate] = await Promise.all([
      this.#deps.contacts.findById(scope, survivorId),
      this.#deps.contacts.findById(scope, duplicateId),
    ]);

    if (
      survivor === null ||
      duplicate === null ||
      survivor.recordStatus !== 'active' ||
      duplicate.recordStatus !== 'active'
    ) {
      return { kind: 'not_found' };
    }

    const plan = planMerge(survivor, duplicate);
    const now = this.#deps.clock.now();

    let movedSubmissions = 0;
    let movedActivities = 0;

    const run = async (session: ClientSession | null): Promise<void> => {
      const options = session === null ? {} : { session };
      const contacts = this.#deps.db.collection<ContactRecord>(COLLECTIONS.contacts);

      movedSubmissions = (
        await this.#deps.db
          .collection(COLLECTIONS.submissionEvents)
          .updateMany(
            { workspaceId: scope.workspaceId, contactId: duplicateId },
            { $set: { contactId: survivorId } },
            options,
          )
      ).modifiedCount;

      movedActivities = (
        await this.#deps.db
          .collection(COLLECTIONS.contactActivities)
          .updateMany(
            { workspaceId: scope.workspaceId, contactId: duplicateId },
            { $set: { contactId: survivorId } },
            options,
          )
      ).modifiedCount;

      // Consent evidence follows its contact, or the survivor would appear
      // never to have consented to anything (blueprint 4.8).
      await this.#deps.db
        .collection(COLLECTIONS.consentEvents)
        .updateMany(
          { workspaceId: scope.workspaceId, contactId: duplicateId },
          { $set: { contactId: survivorId } },
          options,
        );

      await contacts.updateOne(
        { _id: survivorId, workspaceId: scope.workspaceId },
        {
          $set: {
            ...plan.canonical,
            manuallyEditedFields: plan.manuallyEditedFields,
            tags: plan.tags,
            firstSubmissionAt: plan.firstSubmissionAt,
            lastSubmissionAt: plan.lastSubmissionAt,
            submissionCount: plan.submissionCount,
            updatedAt: now,
          },
          $inc: { version: 1 },
        },
        options,
      );

      /**
       * The duplicate is RETIRED, not trashed. `merged` keeps it out of the
       * inbox and out of the 30-day recovery list alike - recovering it would
       * resurrect a contact whose events now belong to someone else.
       */
      await contacts.updateOne(
        { _id: duplicateId, workspaceId: scope.workspaceId },
        {
          $set: {
            recordStatus: 'merged',
            mergedIntoContactId: survivorId,
            updatedAt: now,
          },
          $inc: { version: 1 },
        },
        options,
      );
    };

    await this.#inTransaction(run, 'contact.merge');

    // The audit trail blueprint 9.3 requires, on both sides of the merge, so
    // the survivor's timeline shows what it absorbed and the retired record
    // still explains where it went.
    await this.#recordActivity(scope, survivorId, 'merged_from', actor, null, {
      duplicateContactId: duplicateId.toHexString(),
      movedSubmissions,
      movedActivities,
      filledFields: plan.filledFields,
    });
    await this.#recordActivity(scope, duplicateId, 'merged_into', actor, null, {
      survivorContactId: survivorId.toHexString(),
    });
    await this.#deps.audit.record(scope, {
      type: 'contact.merged',
      actorUserId: actor.userId,
      correlationId: actor.correlationId,
      metadata: {
        survivorContactId: survivorId.toHexString(),
        duplicateContactId: duplicateId.toHexString(),
        movedSubmissions,
      },
    });

    const merged = await this.#deps.contacts.findById(scope, survivorId);
    if (merged === null) return { kind: 'not_found' };
    return { kind: 'ok', contact: toSummary(merged), movedSubmissions, movedActivities };
  }

  // ------------------------------------------------- trash and recovery

  /** Soft-delete with a 30-day recovery window (blueprint 9.5). */
  async softDelete(
    scope: WorkspaceScope,
    contactId: ObjectId,
    actor: Actor,
  ): Promise<ContactWriteResult> {
    const now = this.#deps.clock.now();
    const purgeAfter = new Date(now.getTime() + TRASH_DAYS * 86_400_000);

    const updated = await this.#deps.contacts.updateWorkflow(scope, contactId, {
      recordStatus: 'deleted',
      deletedAt: now,
      purgeAfter,
      updatedAt: now,
    });
    if (updated === null) return { kind: 'not_found' };

    await this.#recordActivity(scope, contactId, 'deleted', actor, null, {
      purgeAfter: purgeAfter.toISOString(),
    });
    await this.#deps.audit.record(scope, {
      type: 'contact.deleted',
      actorUserId: actor.userId,
      correlationId: actor.correlationId,
      metadata: { contactId: contactId.toHexString(), purgeAfter: purgeAfter.toISOString() },
    });

    return { kind: 'ok', contact: toSummary(updated) };
  }

  async recover(
    scope: WorkspaceScope,
    contactId: ObjectId,
    actor: Actor,
  ): Promise<ContactWriteResult> {
    const contact = await this.#deps.contacts.findById(scope, contactId);
    if (contact === null || contact.recordStatus !== 'deleted') return { kind: 'not_found' };

    /**
     * The uniqueness index is partial on `recordStatus: 'active'`, so a
     * contact with the same address may have been created while this one was
     * in the trash. Recovering would then violate the index; saying so is
     * better than a driver error, and better still than silently merging two
     * records nobody asked to merge.
     */
    const clash = await this.#deps.contacts.findByNormalizedEmail(scope, contact.normalizedEmail);
    if (clash !== null) return { kind: 'conflict', reason: 'email_in_use' };

    const now = this.#deps.clock.now();
    const updated = await this.#deps.db
      .collection<ContactRecord>(COLLECTIONS.contacts)
      .findOneAndUpdate(
        { _id: contactId, workspaceId: scope.workspaceId, recordStatus: 'deleted' },
        {
          $set: { recordStatus: 'active', deletedAt: null, purgeAfter: null, updatedAt: now },
          $inc: { version: 1 },
        },
        { returnDocument: 'after' },
      );
    if (updated === null) return { kind: 'not_found' };

    await this.#recordActivity(scope, contactId, 'recovered', actor, null, {});
    await this.#deps.audit.record(scope, {
      type: 'contact.recovered',
      actorUserId: actor.userId,
      correlationId: actor.correlationId,
      metadata: { contactId: contactId.toHexString() },
    });

    return { kind: 'ok', contact: toSummary(updated) };
  }

  // ------------------------------------------------------------------ bulk

  /**
   * Apply one action to many contacts (blueprint 4.7).
   *
   * The caller's capability is checked by the ROUTE, per action, before this is
   * reached. What happens here is the write and its history: every affected
   * contact gets its own activity entry, because "someone bulk-archived 40
   * leads" has to be answerable per lead when one of them turns out to have
   * been archived by mistake.
   */
  async bulk(
    scope: WorkspaceScope,
    action: ContactBulkAction,
    contactIds: readonly ObjectId[],
    input: {
      readonly status?: string;
      readonly assigneeUserId?: string | null;
      readonly tag?: string;
    },
    actor: Actor,
  ): Promise<BulkResult> {
    const now = this.#deps.clock.now();

    if (action === 'tag' || action === 'untag') {
      return this.#bulkTag(scope, action, contactIds, input.tag ?? '', actor, now);
    }

    const set: Record<string, unknown> = { updatedAt: now };
    let activityType: ContactActivityType;
    let metadata: Record<string, unknown>;

    switch (action) {
      case 'status':
        set['status'] = input.status;
        activityType = 'status_changed';
        metadata = { to: input.status, bulk: true };
        break;
      case 'assign':
        set['assigneeUserId'] =
          input.assigneeUserId === null || input.assigneeUserId === undefined
            ? null
            : new ObjectId(input.assigneeUserId);
        activityType = 'assignee_changed';
        metadata = { to: input.assigneeUserId ?? null, bulk: true };
        break;
      case 'archive':
        set['status'] = 'archived';
        activityType = 'status_changed';
        metadata = { to: 'archived', bulk: true };
        break;
      case 'delete':
        set['recordStatus'] = 'deleted';
        set['deletedAt'] = now;
        set['purgeAfter'] = new Date(now.getTime() + TRASH_DAYS * 86_400_000);
        activityType = 'deleted';
        metadata = { bulk: true };
        break;
    }

    const changed = await this.#deps.contacts.updateManyInScope(scope, contactIds, set);
    for (const id of changed) {
      await this.#recordActivity(scope, id, activityType, actor, null, metadata);
    }

    if (action === 'delete' && changed.length > 0) {
      await this.#deps.audit.record(scope, {
        type: 'contact.bulk_deleted',
        actorUserId: actor.userId,
        correlationId: actor.correlationId,
        metadata: { count: changed.length },
      });
    }

    return { changed: changed.length, contactIds: changed.map((id) => id.toHexString()) };
  }

  async #bulkTag(
    scope: WorkspaceScope,
    action: 'tag' | 'untag',
    contactIds: readonly ObjectId[],
    tag: string,
    actor: Actor,
    now: Date,
  ): Promise<BulkResult> {
    if (tag === '') return { changed: 0, contactIds: [] };

    const contacts = this.#deps.db.collection<ContactRecord>(COLLECTIONS.contacts);
    const filter = {
      _id: { $in: [...contactIds] },
      recordStatus: 'active' as const,
      // The workspace clause is last, so it cannot be widened by anything above.
      workspaceId: scope.workspaceId,
    };

    const matched = await contacts.find(filter, { projection: { _id: 1 } }).toArray();
    if (matched.length === 0) return { changed: 0, contactIds: [] };

    await contacts.updateMany(filter, {
      ...(action === 'tag' ? { $addToSet: { tags: tag } } : { $pull: { tags: tag } }),
      $set: { updatedAt: now },
      $inc: { version: 1 },
    } as never);

    for (const row of matched) {
      await this.#recordActivity(scope, row._id, 'tags_changed', actor, null, {
        action,
        tag,
        bulk: true,
      });
    }

    return { changed: matched.length, contactIds: matched.map((row) => row._id.toHexString()) };
  }

  // ---------------------------------------------------------------- export

  /**
   * The export's rows, as a cursor, matching the caller's filter exactly.
   *
   * The filter goes through the same `#buildFilter` the list uses, so "matches
   * what I am looking at" is structural rather than a promise. The route
   * streams this; nothing here materialises the result set.
   */
  async exportCursor(
    scope: WorkspaceScope,
    query: ExportQuery,
  ): Promise<AsyncIterable<WithId<ContactRecord>>> {
    const filter = await this.#buildFilter(scope, query, 'active');
    return this.#deps.contacts.stream(scope, filter, contactSort(query.sort, query.direction));
  }

  /** Blueprint 9.3 requires an export to record its actor and what it covered. */
  async recordExport(
    scope: WorkspaceScope,
    query: ExportQuery,
    rowCount: number,
    actor: Actor,
  ): Promise<void> {
    await this.#deps.audit.record(scope, {
      type: 'contact.exported',
      actorUserId: actor.userId,
      correlationId: actor.correlationId,
      metadata: {
        format: query.format,
        rowCount,
        // The FILTER is recorded, never the exported rows - the audit log must
        // not become a second copy of the leads it is auditing.
        filter: describeFilter(query),
      },
    });
  }

  // --------------------------------------------------------------- helpers

  async #recordActivity(
    scope: WorkspaceScope,
    contactId: ObjectId,
    type: ContactActivityType,
    actor: Actor,
    note: string | null,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const entry: Omit<ContactActivityRecord, '_id' | 'workspaceId'> = {
      contactId,
      type,
      actorUserId: actor.userId,
      correlationId: actor.correlationId,
      occurredAt: this.#deps.clock.now(),
      note,
      metadata,
    };
    await this.#deps.activities.insert(scope, entry);
  }

  /**
   * Run a multi-document write atomically, falling back to sequential writes
   * where the deployment has no replica set - the same shape the submission
   * path uses, so there is one answer to "what happens without transactions"
   * rather than two.
   */
  async #inTransaction(
    run: (session: ClientSession | null) => Promise<void>,
    label: string,
  ): Promise<void> {
    const session = this.#deps.db.client.startSession();
    try {
      await session.withTransaction(async () => {
        await run(session);
      });
    } catch (error) {
      if (isTransactionUnsupported(error)) {
        this.#deps.logger.warn('contact.no_transaction', {
          result: 'degraded',
          operation: label,
          reason: 'deployment does not support transactions; writing sequentially',
        });
        await run(null);
        return;
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }
}

/**
 * Whether two tag sets are the same set.
 *
 * Compared element by element on sorted copies rather than by joining into a
 * string: any separator character can also appear inside a tag, so a join-based
 * comparison can call two different sets equal.
 */
function sameTags(next: readonly string[], previous: readonly string[]): boolean {
  if (next.length !== previous.length) return false;
  const sorted = [...previous].sort();
  return next.every((tag, index) => tag === sorted[index]);
}

/** A short, non-identifying description of what an export covered. */
function describeFilter(query: ExportQuery): Readonly<Record<string, unknown>> {
  return {
    hasSearch: query.search !== undefined,
    status: query.status ?? null,
    widgetId: query.widgetId ?? null,
    domain: query.domain ?? null,
    country: query.country ?? null,
    submittedAfter: query.submittedAfter?.toISOString() ?? null,
    submittedBefore: query.submittedBefore?.toISOString() ?? null,
  };
}

function isTransactionUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Transaction numbers are only allowed') ||
    message.includes('not supported') ||
    message.includes('replica set')
  );
}
