import type { Db, Filter, ObjectId, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { OutboxEventRecord } from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import type { WorkspaceScope } from './workspace-scope.js';

export class OutboxRepository extends WorkspaceScopedRepository<OutboxEventRecord> {
  protected readonly collectionName = COLLECTIONS.outboxEvents;

  constructor(db: Db) {
    super(db);
  }

  async listPending(
    scope: WorkspaceScope,
    now: Date = new Date(),
  ): Promise<WithId<OutboxEventRecord>[]> {
    return this.findMany(
      scope,
      { status: 'pending', nextAttemptAt: { $lte: now } },
      { sort: { nextAttemptAt: 1 } },
    );
  }

  async findByIdempotencyKey(
    scope: WorkspaceScope,
    idempotencyKey: string,
  ): Promise<WithId<OutboxEventRecord> | null> {
    return this.findOne(scope, { idempotencyKey });
  }

  /**
   * Rows the reconciler should try to enqueue, across every workspace.
   *
   * Deliberately NOT workspace-scoped: reconciliation is a system job whose
   * whole purpose is to find work that no request is going to come back for
   * (blueprint 12.2). It is the one method here that bypasses the scoped base,
   * and it is used from exactly one place - the reconciler - which then writes
   * through the scoped methods below.
   */
  async listDueAcrossWorkspaces(now: Date, limit = 100): Promise<WithId<OutboxEventRecord>[]> {
    return this.collection
      .find({ status: 'pending', nextAttemptAt: { $lte: now } } as Filter<OutboxEventRecord>)
      .sort({ nextAttemptAt: 1 })
      .limit(limit)
      .toArray();
  }

  /** Mark a row as handed to the queue. */
  async markProcessing(scope: WorkspaceScope, id: ObjectId, now: Date): Promise<boolean> {
    const result = await this.collection.updateOne(
      this.scopedFilter(scope, { _id: id, status: 'pending' } as Filter<OutboxEventRecord>),
      { $set: { status: 'processing', updatedAt: now } as never },
    );
    return result.modifiedCount === 1;
  }

  async markSent(scope: WorkspaceScope, id: ObjectId, now: Date): Promise<void> {
    await this.updateById(scope, id, { status: 'sent', updatedAt: now, lastError: null });
  }

  /**
   * Hand a row back for another try.
   *
   * Returns it to `pending` with a later `nextAttemptAt`, which is what makes
   * a transient Redis outage self-healing: the row was never lost, and the
   * next sweep picks it up.
   */
  async markForRetry(
    scope: WorkspaceScope,
    id: ObjectId,
    nextAttemptAt: Date,
    error: string,
    attempts: number,
    now: Date,
  ): Promise<void> {
    await this.updateById(scope, id, {
      status: 'pending',
      nextAttemptAt,
      lastError: error,
      attempts,
      updatedAt: now,
    });
  }

  async markDeadLetter(
    scope: WorkspaceScope,
    id: ObjectId,
    error: string,
    now: Date,
  ): Promise<void> {
    await this.updateById(scope, id, { status: 'dead_letter', lastError: error, updatedAt: now });
  }
}
