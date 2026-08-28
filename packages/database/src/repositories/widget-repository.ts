import type { Db, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { WidgetRecord } from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import type { WorkspaceScope } from './workspace-scope.js';

export class WidgetRepository extends WorkspaceScopedRepository<WidgetRecord> {
  protected readonly collectionName = COLLECTIONS.widgets;

  constructor(db: Db) {
    super(db);
  }

  /** Widgets that have not been soft-deleted, newest first. */
  async listActive(scope: WorkspaceScope): Promise<WithId<WidgetRecord>[]> {
    return this.findMany(scope, { status: 'active' }, { sort: { createdAt: -1 } });
  }

  /** Soft-deleted widgets still inside the 30-day window (blueprint 9.5). */
  async listRecoverable(scope: WorkspaceScope, now: Date): Promise<WithId<WidgetRecord>[]> {
    return this.findMany(
      scope,
      { status: 'deleted', purgeAfter: { $gt: now } },
      { sort: { deletedAt: -1 } },
    );
  }

  /**
   * How many widgets count against the workspace's active-widget quota
   * (blueprint 4.10).
   *
   * A soft-deleted widget does not count: it is in the trash, servable to
   * nobody, and counting it would let a full workspace stay full for 30 days
   * after its owner cleared it out.
   */
  async countActive(scope: WorkspaceScope): Promise<number> {
    return this.count(scope, { status: 'active' });
  }

  /**
   * Allocate the next revision number for a widget, atomically.
   *
   * `$inc` inside `findOneAndUpdate` is what makes two concurrent publishes
   * impossible to give the same number; a read-then-write would race, and the
   * unique index would then turn that race into a failed publish rather than a
   * silently duplicated revision.
   */
  async allocateRevisionNumber(
    scope: WorkspaceScope,
    widgetId: WidgetRecord['_id'],
  ): Promise<number | null> {
    const updated = await this.collection.findOneAndUpdate(
      this.scopedFilter(scope, { _id: widgetId, status: 'active' }),
      { $inc: { lastRevisionNumber: 1 } },
      { returnDocument: 'after' },
    );
    return updated === null ? null : updated.lastRevisionNumber;
  }
}
