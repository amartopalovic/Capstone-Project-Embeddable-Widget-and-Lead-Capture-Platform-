import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { Migration } from './types.js';

/**
 * Stage 10a: raw interaction events and daily aggregates (blueprint 9.2, 13.2).
 *
 * Append-only, per the rule in runner.ts: 001-008 are untouched.
 */
export const migration009Analytics: Migration = {
  id: '009_analytics',
  description: 'Interaction events and daily analytics aggregates',

  async up(db: Db): Promise<void> {
    await db.collection(COLLECTIONS.interactionEvents).createIndexes([
      // Blueprint 9.2: workspace/widget/date.
      { key: { workspaceId: 1, widgetId: 1, occurredAt: -1 }, name: 'workspace_widget_date' },

      /**
       * The aggregation sweep's own query: everything for one workspace-day.
       * Leading with the day rather than the timestamp is what lets a re-run
       * for a single day read exactly the rows it needs.
       */
      { key: { workspaceId: 1, localDay: 1, widgetId: 1 }, name: 'workspace_day_widget' },

      /**
       * The expiry sweep, which is deliberately NOT a TTL index.
       *
       * Blueprint 13.2 step 5 retires raw events after 90 days, but 4.9 is
       * explicit that they are "removed after daily aggregates are produced".
       * A TTL index deletes on a clock alone and cannot check that
       * precondition, so it would happily destroy a day nothing had aggregated
       * yet - turning a retention rule into data loss. The sweep in
       * `AnalyticsService` checks the aggregate exists first, and this index is
       * what makes finding those rows cheap.
       */
      { key: { occurredAt: 1 }, name: 'occurred_at' },

      /**
       * Counting distinct visitors within a day, and the per-visitor rate
       * limit's own lookups.
       */
      { key: { workspaceId: 1, localDay: 1, visitorPseudonym: 1 }, name: 'workspace_day_visitor' },
    ]);

    await db.collection(COLLECTIONS.dailyAnalytics).createIndexes([
      /**
       * Blueprint 9.2: "Unique workspace/widget/day/dimensions".
       *
       * This is what makes the aggregation job idempotent. Re-running it for a
       * day upserts the same keys rather than adding a second set of counters,
       * so a retried or overlapping sweep cannot double a workspace's numbers.
       */
      {
        key: { workspaceId: 1, day: 1, widgetId: 1, dimension: 1, dimensionValue: 1 },
        name: 'uniq_workspace_day_widget_dimension',
        unique: true,
      },
      // The dashboard's range reads (Stage 10b).
      { key: { workspaceId: 1, day: -1, dimension: 1 }, name: 'workspace_day_dimension' },
    ]);
  },
};
