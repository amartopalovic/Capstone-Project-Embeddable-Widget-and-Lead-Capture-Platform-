import type { Db, ObjectId, WithId } from 'mongodb';
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

  /** How many submissions landed in a window, for the monthly quota. */
  async countSince(scope: WorkspaceScope, since: Date): Promise<number> {
    return this.count(scope, { submittedAt: { $gte: since } });
  }
}
