import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { Migration } from './types.js';

/**
 * Stage 9: deliveries, webhook endpoints, and notification recipients
 * (blueprint 9.2, 9.5, 12.2, 12.4).
 *
 * Append-only, per the rule in runner.ts: 001-007 are untouched.
 */
export const migration008Delivery: Migration = {
  id: '008_delivery',
  description: 'Delivery history, webhook endpoints, and notification recipients',

  async up(db: Db): Promise<void> {
    await db.collection(COLLECTIONS.deliveries).createIndexes([
      // Blueprint 9.2: workspace/type/status/date.
      { key: { workspaceId: 1, type: 1, status: 1, createdAt: -1 }, name: 'workspace_type_status' },
      // The delivery health view's default ordering.
      { key: { workspaceId: 1, createdAt: -1, _id: -1 }, name: 'workspace_created' },
      // Finding a contact's deliveries from its timeline.
      { key: { workspaceId: 1, contactId: 1, createdAt: -1 }, name: 'workspace_contact' },

      /**
       * The guarantee behind "retries do not send duplicate logical
       * notifications" (blueprint 12.2).
       *
       * Unique per workspace, and enforced by the DATABASE rather than only by
       * the queue: BullMQ deduplicates by job id within Redis, but Redis is a
       * cache that can be flushed and the outbox reconciler deliberately
       * re-enqueues work it thinks was lost. This index is what makes the
       * second enqueue a no-op instead of a second email.
       */
      {
        key: { workspaceId: 1, idempotencyKey: 1 },
        name: 'uniq_workspace_idempotency_key',
        unique: true,
      },

      /**
       * Blueprint 9.5: delivery logs are kept 90 days. A TTL index means the
       * retention promise needs no sweep job to be true, which matters on a
       * service that sleeps.
       */
      { key: { expiresAt: 1 }, name: 'ttl_expires_at', expireAfterSeconds: 0 },
    ]);

    await db.collection(COLLECTIONS.webhookEndpoints).createIndexes([
      // Blueprint 9.2: workspace/widget; enabled state.
      { key: { workspaceId: 1, widgetId: 1 }, name: 'workspace_widget' },
      { key: { workspaceId: 1, enabled: 1 }, name: 'workspace_enabled' },
    ]);

    await db.collection(COLLECTIONS.notificationRecipients).createIndexes([
      /**
       * One address per widget. Partial on the widget so the uniqueness is
       * per-widget rather than per-workspace: the same person may well be a
       * recipient for two different widgets.
       */
      {
        key: { workspaceId: 1, widgetId: 1, normalizedEmail: 1 },
        name: 'uniq_widget_recipient',
        unique: true,
      },
      { key: { workspaceId: 1, widgetId: 1, verifiedAt: 1 }, name: 'workspace_widget_verified' },
    ]);

    /**
     * The outbox gains the index its reconciler actually queries on.
     *
     * Stage 2 created the collection and Stage 7 started writing to it, but
     * nothing read it until now. The reconciler sweeps for pending rows whose
     * next attempt is due, ACROSS workspaces - it is a system job, not a tenant
     * one - so the key leads with status rather than workspaceId.
     */
    await db.collection(COLLECTIONS.outboxEvents).createIndexes([
      { key: { status: 1, nextAttemptAt: 1 }, name: 'status_next_attempt' },
      {
        key: { workspaceId: 1, idempotencyKey: 1 },
        name: 'uniq_workspace_outbox_key',
        unique: true,
      },
    ]);
  },
};
