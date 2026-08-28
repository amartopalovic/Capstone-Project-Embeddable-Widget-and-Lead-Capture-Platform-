import type { ObjectId, WithId } from 'mongodb';
import type { WidgetRecord, WidgetRevisionRecord, WorkspaceScope } from '@lcp/database';

/**
 * Narrow ports for the widget layer.
 *
 * As in the auth and workspace layers, the service declares the slice it
 * actually uses rather than importing concrete repository classes, so the
 * dependency direction stays explicit (blueprint 6.2) and a test can substitute
 * a small fake.
 */

export type WithIdWidget = WithId<WidgetRecord>;
export type WithIdRevision = WithId<WidgetRevisionRecord>;

export interface WidgetRepositoryPort {
  findById(scope: WorkspaceScope, id: ObjectId): Promise<WithIdWidget | null>;
  findOne(scope: WorkspaceScope, filter?: Record<string, unknown>): Promise<WithIdWidget | null>;
  listActive(scope: WorkspaceScope): Promise<WithIdWidget[]>;
  listRecoverable(scope: WorkspaceScope, now: Date): Promise<WithIdWidget[]>;
  countActive(scope: WorkspaceScope): Promise<number>;
  insert(
    scope: WorkspaceScope,
    document: Omit<WidgetRecord, '_id' | 'workspaceId'> & { _id?: ObjectId },
  ): Promise<WithIdWidget>;
  updateById(
    scope: WorkspaceScope,
    id: ObjectId,
    set: Partial<Omit<WidgetRecord, '_id' | 'workspaceId'>>,
  ): Promise<boolean>;
  allocateRevisionNumber(scope: WorkspaceScope, widgetId: ObjectId): Promise<number | null>;
}

export interface WidgetRevisionRepositoryPort {
  findById(scope: WorkspaceScope, id: ObjectId): Promise<WithIdRevision | null>;
  findDraft(scope: WorkspaceScope, widgetId: ObjectId): Promise<WithIdRevision | null>;
  listForWidget(scope: WorkspaceScope, widgetId: ObjectId): Promise<WithIdRevision[]>;
  insert(
    scope: WorkspaceScope,
    document: Omit<WidgetRevisionRecord, '_id' | 'workspaceId'> & { _id?: ObjectId },
  ): Promise<WithIdRevision>;
  updateDraftIfVersionMatches(
    scope: WorkspaceScope,
    revisionId: ObjectId,
    expectedVersion: number,
    set: Partial<Omit<WidgetRevisionRecord, '_id' | 'workspaceId' | 'version'>>,
  ): Promise<WithIdRevision | null>;
  promoteDraftToPublished(
    scope: WorkspaceScope,
    revisionId: ObjectId,
    expectedVersion: number,
    publishedAt: Date,
    publishedByUserId: ObjectId,
  ): Promise<WithIdRevision | null>;
}
