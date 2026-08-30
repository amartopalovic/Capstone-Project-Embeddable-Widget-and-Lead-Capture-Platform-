import type { Db, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { AbuseEventRecord } from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import type { WorkspaceScope } from './workspace-scope.js';

/** Minimal abuse evidence, never a shadow lead database (blueprint 7.4). */
export class AbuseEventRepository extends WorkspaceScopedRepository<AbuseEventRecord> {
  protected readonly collectionName = COLLECTIONS.abuseEvents;

  constructor(db: Db) {
    super(db);
  }

  async listRecent(scope: WorkspaceScope, limit = 50): Promise<WithId<AbuseEventRecord>[]> {
    return this.findMany(scope, {}, { sort: { occurredAt: -1 }, limit });
  }

  /**
   * How much spam and throttling a workspace saw, by type and day.
   *
   * Counts only. Blueprint 7.4 keeps this collection deliberately free of
   * captured values so it cannot become a shadow lead database, and an
   * aggregate over it must not reintroduce what the record refused to store.
   */
  async countsByType(
    scope: WorkspaceScope,
    since: Date,
  ): Promise<{ readonly type: string; readonly day: string; readonly count: number }[]> {
    return this.collection
      .aggregate<{ type: string; day: string; count: number }>([
        { $match: this.scopedFilter(scope, { occurredAt: { $gte: since } } as never) },
        {
          $group: {
            _id: {
              type: '$type',
              day: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt' } },
            },
            count: { $sum: 1 },
          },
        },
        { $project: { _id: 0, type: '$_id.type', day: '$_id.day', count: 1 } },
        { $sort: { day: 1 } },
      ])
      .toArray();
  }
}
