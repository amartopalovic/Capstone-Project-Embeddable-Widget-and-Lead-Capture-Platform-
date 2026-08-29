import type { Db, Filter, ObjectId, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type {
  DeliveryAttempt,
  DeliveryRecord,
  DeliveryStatus,
  DeliveryType,
} from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import type { WorkspaceScope } from './workspace-scope.js';

/**
 * Delivery history (blueprint 9.2, 12.2).
 *
 * The queue moves work along; this collection is what an operator reads and
 * what survives a Redis flush.
 */
export class DeliveryRepository extends WorkspaceScopedRepository<DeliveryRecord> {
  protected readonly collectionName = COLLECTIONS.deliveries;

  constructor(db: Db) {
    super(db);
  }

  async findByIdempotencyKey(
    scope: WorkspaceScope,
    idempotencyKey: string,
  ): Promise<WithId<DeliveryRecord> | null> {
    return this.findOne(scope, { idempotencyKey });
  }

  /**
   * Claim a delivery for an attempt.
   *
   * Guarded on the record NOT already being delivered, so a duplicate job -
   * a queue replay, or the reconciler racing the original enqueue - cannot
   * start a second attempt at work that already succeeded. Returns null when
   * the claim was refused, which the worker treats as "somebody else has this".
   */
  async claimForAttempt(
    scope: WorkspaceScope,
    id: ObjectId,
    now: Date,
  ): Promise<WithId<DeliveryRecord> | null> {
    return this.collection.findOneAndUpdate(
      this.scopedFilter(scope, {
        _id: id,
        status: { $nin: ['delivered', 'failed'] },
      } as Filter<DeliveryRecord>),
      { $set: { status: 'retrying', updatedAt: now } as never },
      { returnDocument: 'after' },
    );
  }

  /** Record the outcome of one attempt, appending to the history. */
  async recordAttempt(
    scope: WorkspaceScope,
    id: ObjectId,
    attempt: DeliveryAttempt,
    next: {
      readonly status: DeliveryStatus;
      readonly nextAttemptAt: Date | null;
      readonly deliveredAt: Date | null;
      readonly lastError: string | null;
    },
  ): Promise<WithId<DeliveryRecord> | null> {
    return this.collection.findOneAndUpdate(
      this.scopedFilter(scope, { _id: id } as Filter<DeliveryRecord>),
      {
        $set: {
          status: next.status,
          nextAttemptAt: next.nextAttemptAt,
          deliveredAt: next.deliveredAt,
          lastError: next.lastError,
          attempts: attempt.attempt,
          updatedAt: attempt.at,
        } as never,
        $push: { history: attempt } as never,
      },
      { returnDocument: 'after' },
    );
  }

  async listRecent(
    scope: WorkspaceScope,
    filter: Filter<DeliveryRecord> = {},
    limit = 50,
  ): Promise<WithId<DeliveryRecord>[]> {
    return this.findMany(scope, filter, { sort: { createdAt: -1, _id: -1 }, limit });
  }

  /** Counts per status, for the health view's summary row. */
  async countsByStatus(scope: WorkspaceScope): Promise<Record<string, number>> {
    const rows = await this.collection
      .aggregate<{ _id: DeliveryStatus; n: number }>([
        { $match: this.scopedFilter(scope) },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ])
      .toArray();
    return Object.fromEntries(rows.map((row) => [row._id, row.n]));
  }

  async countsByType(scope: WorkspaceScope): Promise<Record<string, number>> {
    const rows = await this.collection
      .aggregate<{ _id: DeliveryType; n: number }>([
        { $match: this.scopedFilter(scope) },
        { $group: { _id: '$type', n: { $sum: 1 } } },
      ])
      .toArray();
    return Object.fromEntries(rows.map((row) => [row._id, row.n]));
  }

  /**
   * Dead letters that have not yet raised an operator alert.
   *
   * System-wide rather than workspace-scoped, because the alert is for the
   * platform operator (blueprint 12.2) - so this deliberately bypasses the
   * scoped base, and is the only method here that does.
   */
  async claimUnalertedDeadLetters(now: Date, limit = 20): Promise<WithId<DeliveryRecord>[]> {
    const pending = await this.collection
      .find({ status: 'dead_letter', alertedAt: null } as Filter<DeliveryRecord>)
      .limit(limit)
      .toArray();
    if (pending.length === 0) return [];

    await this.collection.updateMany(
      { _id: { $in: pending.map((row) => row._id) } } as Filter<DeliveryRecord>,
      { $set: { alertedAt: now } as never },
    );
    return pending;
  }
}
