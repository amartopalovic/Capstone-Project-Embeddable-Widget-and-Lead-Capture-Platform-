import type { Db, Filter, ObjectId, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { NotificationRecipientRecord, WebhookEndpointRecord } from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import type { WorkspaceScope } from './workspace-scope.js';

/** Configured webhook destinations (blueprint 9.2, 12.4). */
export class WebhookEndpointRepository extends WorkspaceScopedRepository<WebhookEndpointRecord> {
  protected readonly collectionName = COLLECTIONS.webhookEndpoints;

  constructor(db: Db) {
    super(db);
  }

  /**
   * Endpoints that should receive a widget's events.
   *
   * A `widgetId` of null means workspace-wide, so both match - a customer who
   * wants one destination for everything should not have to add it per widget.
   */
  async listForWidget(
    scope: WorkspaceScope,
    widgetId: ObjectId,
  ): Promise<WithId<WebhookEndpointRecord>[]> {
    return this.findMany(scope, {
      enabled: true,
      $or: [{ widgetId }, { widgetId: null }],
    } as Filter<WebhookEndpointRecord>);
  }

  async listAll(scope: WorkspaceScope): Promise<WithId<WebhookEndpointRecord>[]> {
    return this.findMany(scope, {}, { sort: { createdAt: -1 } });
  }
}

/** Per-widget notification recipients (blueprint 12.3). */
export class NotificationRecipientRepository extends WorkspaceScopedRepository<NotificationRecipientRecord> {
  protected readonly collectionName = COLLECTIONS.notificationRecipients;

  constructor(db: Db) {
    super(db);
  }

  async listForWidget(
    scope: WorkspaceScope,
    widgetId: ObjectId,
  ): Promise<WithId<NotificationRecipientRecord>[]> {
    return this.findMany(scope, { widgetId }, { sort: { createdAt: 1 } });
  }

  /**
   * Only addresses that may actually be emailed.
   *
   * The filter is `verifiedAt != null`, not "kind is workspace_user OR
   * verified": a workspace user's row is created already verified, so one rule
   * covers both kinds and there is no branch here that could be got wrong.
   */
  async listVerifiedForWidget(
    scope: WorkspaceScope,
    widgetId: ObjectId,
  ): Promise<WithId<NotificationRecipientRecord>[]> {
    return this.findMany(scope, {
      widgetId,
      verifiedAt: { $ne: null },
    } as Filter<NotificationRecipientRecord>);
  }

  async findByNormalizedEmail(
    scope: WorkspaceScope,
    widgetId: ObjectId,
    normalizedEmail: string,
  ): Promise<WithId<NotificationRecipientRecord> | null> {
    return this.findOne(scope, { widgetId, normalizedEmail });
  }
}
