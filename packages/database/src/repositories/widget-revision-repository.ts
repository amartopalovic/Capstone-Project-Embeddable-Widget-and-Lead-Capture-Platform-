import type { Db, ObjectId, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { WidgetRevisionRecord } from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import type { WorkspaceScope } from './workspace-scope.js';

export class WidgetRevisionRepository extends WorkspaceScopedRepository<WidgetRevisionRecord> {
  protected readonly collectionName = COLLECTIONS.widgetRevisions;

  constructor(db: Db) {
    super(db);
  }

  async findDraft(
    scope: WorkspaceScope,
    widgetId: ObjectId,
  ): Promise<WithId<WidgetRevisionRecord> | null> {
    return this.findOne(scope, { widgetId, status: 'draft' });
  }

  /** A widget's revisions, newest first. */
  async listForWidget(
    scope: WorkspaceScope,
    widgetId: ObjectId,
  ): Promise<WithId<WidgetRevisionRecord>[]> {
    return this.findMany(scope, { widgetId }, { sort: { revisionNumber: -1 } });
  }

  /**
   * Write a draft only if its version is still the one the caller read.
   *
   * This is the optimistic-concurrency precondition from blueprint 10.1,
   * expressed as part of the filter rather than as a read-then-write: the
   * version is matched and incremented in one atomic update, so two teammates
   * saving at once cannot both succeed and the loser is told, not ignored.
   *
   * `status: 'draft'` is in the filter as well, so this can never rewrite a
   * published revision even if a caller passed the wrong id (blueprint 9.3:
   * published revisions are immutable).
   */
  async updateDraftIfVersionMatches(
    scope: WorkspaceScope,
    revisionId: ObjectId,
    expectedVersion: number,
    set: Partial<Omit<WidgetRevisionRecord, '_id' | 'workspaceId' | 'version'>>,
  ): Promise<WithId<WidgetRevisionRecord> | null> {
    return this.collection.findOneAndUpdate(
      this.scopedFilter(scope, {
        _id: revisionId,
        status: 'draft',
        version: expectedVersion,
      }),
      { $set: set as never, $inc: { version: 1 } },
      { returnDocument: 'after' },
    );
  }

  /**
   * Promote the draft to the live revision, once.
   *
   * The filter still requires `status: 'draft'` and the expected version, so a
   * second concurrent publish of the same draft matches nothing and is
   * reported as a stale write instead of creating a second published revision
   * from the same content.
   */
  async promoteDraftToPublished(
    scope: WorkspaceScope,
    revisionId: ObjectId,
    expectedVersion: number,
    publishedAt: Date,
    publishedByUserId: ObjectId,
  ): Promise<WithId<WidgetRevisionRecord> | null> {
    return this.collection.findOneAndUpdate(
      this.scopedFilter(scope, {
        _id: revisionId,
        status: 'draft',
        version: expectedVersion,
      }),
      {
        $set: {
          status: 'published',
          publishedAt,
          publishedByUserId,
          updatedAt: publishedAt,
        } as never,
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    );
  }
}
