import type { Db, WithId } from 'mongodb';
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
}
