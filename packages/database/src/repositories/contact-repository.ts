import type { Db, Filter, FindCursor, Sort, WithId } from 'mongodb';
import type { ObjectId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { ContactRecord } from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import type { WorkspaceScope } from './workspace-scope.js';

export class ContactRepository extends WorkspaceScopedRepository<ContactRecord> {
  protected readonly collectionName = COLLECTIONS.contacts;

  constructor(db: Db) {
    super(db);
  }

  async findByNormalizedEmail(
    scope: WorkspaceScope,
    normalizedEmail: string,
  ): Promise<WithId<ContactRecord> | null> {
    return this.findOne(scope, { normalizedEmail, recordStatus: 'active' });
  }

  async countActive(scope: WorkspaceScope): Promise<number> {
    return this.count(scope, { recordStatus: 'active' });
  }

  /**
   * One page of the inbox.
   *
   * The filter is built by the caller from a validated query, and merged
   * beneath the workspace clause by `scopedFilter` - so however elaborate the
   * inbox filter becomes, it can never widen past the tenant.
   */
  async page(
    scope: WorkspaceScope,
    filter: Filter<ContactRecord>,
    sort: Sort,
    limit: number,
  ): Promise<WithId<ContactRecord>[]> {
    return this.collection.find(this.scopedFilter(scope, filter)).sort(sort).limit(limit).toArray();
  }

  /**
   * The same query as `page`, as a cursor rather than an array.
   *
   * Export uses this so a large result set is streamed row by row instead of
   * being materialised in memory first (blueprint 4.7).
   */
  stream(
    scope: WorkspaceScope,
    filter: Filter<ContactRecord>,
    sort: Sort,
  ): FindCursor<WithId<ContactRecord>> {
    return this.collection.find(this.scopedFilter(scope, filter)).sort(sort);
  }

  /**
   * Apply a change only if the record still carries the version the caller
   * read (blueprint 9.3: optimistic concurrency "to prevent silent overwrites
   * by teammates").
   *
   * Returning null rather than throwing lets the caller tell the two failures
   * apart: no such contact, versus a contact someone else has since changed.
   * The version guard is part of the FILTER, so the check and the write are one
   * atomic operation - checking first and writing after would leave exactly the
   * gap this is meant to close.
   */
  async updateIfVersionMatches(
    scope: WorkspaceScope,
    id: ObjectId,
    expectedVersion: number,
    set: Partial<Omit<ContactRecord, '_id' | 'workspaceId'>>,
  ): Promise<WithId<ContactRecord> | null> {
    return this.collection.findOneAndUpdate(
      this.scopedFilter(scope, { _id: id, version: expectedVersion } as Filter<ContactRecord>),
      { $set: set as never, $inc: { version: 1 } as never },
      { returnDocument: 'after' },
    );
  }

  /**
   * A workflow change: status, assignee, or tags.
   *
   * Deliberately NOT version-guarded. Blueprint 9.3 puts optimistic concurrency
   * on "Contact canonical values"; workflow state is the field every role edits
   * all day, and making two teammates tagging the same lead a 409 would be a
   * worse inbox without protecting anything. The version still increments, so a
   * canonical edit that raced a workflow change is still caught.
   */
  async updateWorkflow(
    scope: WorkspaceScope,
    id: ObjectId,
    set: Partial<Omit<ContactRecord, '_id' | 'workspaceId'>>,
  ): Promise<WithId<ContactRecord> | null> {
    return this.collection.findOneAndUpdate(
      this.scopedFilter(scope, { _id: id, recordStatus: 'active' } as Filter<ContactRecord>),
      { $set: set as never, $inc: { version: 1 } as never },
      { returnDocument: 'after' },
    );
  }

  /** Apply one workflow change to many contacts at once (blueprint 4.7). */
  async updateManyInScope(
    scope: WorkspaceScope,
    ids: readonly ObjectId[],
    set: Partial<Omit<ContactRecord, '_id' | 'workspaceId'>>,
  ): Promise<ObjectId[]> {
    if (ids.length === 0) return [];
    const filter = this.scopedFilter(scope, {
      _id: { $in: [...ids] },
      recordStatus: 'active',
    } as Filter<ContactRecord>);

    // Read the matching ids BEFORE the write, so the caller learns exactly
    // which contacts it touched - a bulk action across tenants must be able to
    // report that it changed nothing, not merely that it failed to error.
    const matched = await this.collection.find(filter, { projection: { _id: 1 } }).toArray();
    if (matched.length === 0) return [];

    await this.collection.updateMany(filter, { $set: set as never, $inc: { version: 1 } as never });
    return matched.map((row) => row._id);
  }

  /** Soft-deleted contacts still inside the 30-day window (blueprint 9.5). */
  async listRecoverable(scope: WorkspaceScope, limit = 100): Promise<WithId<ContactRecord>[]> {
    return this.findMany(
      scope,
      { recordStatus: 'deleted' },
      { sort: { deletedAt: -1, _id: -1 }, limit },
    );
  }

  /** Distinct tag names in use, so the inbox can offer them as filters. */
  async distinctTags(scope: WorkspaceScope): Promise<string[]> {
    const values = await this.collection.distinct(
      'tags',
      this.scopedFilter(scope, { recordStatus: 'active' }),
    );
    return values.filter((value): value is string => typeof value === 'string').sort();
  }
}
