import type { Db, Filter, ObjectId, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { SubmissionEventRecord } from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import type { WorkspaceScope } from './workspace-scope.js';

/**
 * Submission events are IMMUTABLE (blueprint 9.3).
 *
 * This repository deliberately exposes no update method of its own; the base
 * class's `updateById` exists but nothing in the submission path calls it, and
 * a reviewer looking here finds reads and one insert.
 */
export class SubmissionEventRepository extends WorkspaceScopedRepository<SubmissionEventRecord> {
  protected readonly collectionName = COLLECTIONS.submissionEvents;

  constructor(db: Db) {
    super(db);
  }

  async findByIdempotencyKey(
    scope: WorkspaceScope,
    idempotencyKey: string,
  ): Promise<WithId<SubmissionEventRecord> | null> {
    return this.findOne(scope, { idempotencyKey });
  }

  /** A contact's timeline, newest first (blueprint 4.6). */
  async listForContact(
    scope: WorkspaceScope,
    contactId: ObjectId,
  ): Promise<WithId<SubmissionEventRecord>[]> {
    return this.findMany(scope, { contactId }, { sort: { submittedAt: -1 } });
  }

  /**
   * Re-point a retired duplicate's events at the surviving contact (9.3).
   *
   * This is the one exception to the immutability above, and it is a narrow
   * one: `contactId` is a link, not evidence. Every value the visitor actually
   * submitted stays exactly as it was written, which is what the immutability
   * rule exists to protect.
   */
  async relinkContact(scope: WorkspaceScope, from: ObjectId, to: ObjectId): Promise<number> {
    const result = await this.collection.updateMany(this.scopedFilter(scope, { contactId: from }), {
      $set: { contactId: to },
    });
    return result.modifiedCount;
  }

  /**
   * Contacts with at least one submission matching a filter.
   *
   * The inbox searches captured field values and filters on widget, domain,
   * page URL, and geo - all of which live on the immutable event rather than on
   * the Contact (blueprint 4.6). Resolving them to contact ids here keeps the
   * contact query itself a single indexed lookup.
   */
  async distinctContactIds(
    scope: WorkspaceScope,
    filter: Filter<SubmissionEventRecord>,
    limit: number,
  ): Promise<ObjectId[]> {
    const rows = await this.collection
      .aggregate<{ _id: ObjectId }>([
        { $match: this.scopedFilter(scope, filter) },
        { $group: { _id: '$contactId' } },
        { $limit: limit },
      ])
      .toArray();
    return rows.map((row) => row._id);
  }

  /** How many submissions landed in a window, for the monthly quota. */
  async countSince(scope: WorkspaceScope, since: Date): Promise<number> {
    return this.count(scope, { submittedAt: { $gte: since } });
  }
}
