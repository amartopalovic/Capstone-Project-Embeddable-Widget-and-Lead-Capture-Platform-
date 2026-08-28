import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { Migration } from './types.js';

/**
 * Stage 5a: the widget and widget-revision collections and their indexes
 * (blueprint 9.2).
 *
 * Append-only, per the rule in runner.ts: 001-004 are untouched.
 *
 * Every index here backs a constraint the blueprint states, rather than a
 * query that happens to be convenient:
 *
 *  - "Unique public ID" is enforced across the whole platform, not per
 *    workspace, because the embed snippet carries only that identifier and the
 *    public loader resolves it with no tenant context to scope by.
 *  - "Workspace + widget + revision number unique" makes a duplicated revision
 *    number impossible even under a concurrent publish.
 *  - At most ONE draft revision may exist per widget. That is not stated as an
 *    index in 9.2, but it is what "creates or updates a draft revision"
 *    (blueprint 4.5, singular) means, and enforcing it in the storage engine
 *    is stronger than trusting every write path to check first.
 */
export const migration005Widget: Migration = {
  id: '005_widget',
  description: 'Widget and widget-revision collections, public-id uniqueness, and revision indexes',

  async up(db: Db): Promise<void> {
    await db.collection(COLLECTIONS.widgets).createIndexes([
      // Blueprint 9.2: unique public ID. Platform-wide, and unique even for
      // soft-deleted widgets, so a recovered widget's snippet still resolves
      // to exactly one record and an identifier is never recycled.
      { key: { publicId: 1 }, name: 'uniq_public_id', unique: true },

      // Blueprint 9.2: workspace + status. The widget list is scoped and
      // filtered by lifecycle state on every read.
      { key: { workspaceId: 1, status: 1 }, name: 'workspace_status' },

      // The 30-day widget-trash sweep in Stage 11, and "is this still
      // recoverable" here.
      { key: { status: 1, purgeAfter: 1 }, name: 'status_purge_after' },
    ]);

    await db.collection(COLLECTIONS.widgetRevisions).createIndexes([
      // Blueprint 9.2: workspace + widget + revision number unique.
      {
        key: { workspaceId: 1, widgetId: 1, revisionNumber: 1 },
        name: 'uniq_workspace_widget_revision',
        unique: true,
      },

      // Exactly one editable draft per widget (blueprint 4.5).
      {
        key: { workspaceId: 1, widgetId: 1 },
        name: 'uniq_widget_draft',
        unique: true,
        partialFilterExpression: { status: 'draft' },
      },

      // Listing a widget's revision history, newest first.
      {
        key: { workspaceId: 1, widgetId: 1, revisionNumber: -1 },
        name: 'workspace_widget_revision_desc',
      },
    ]);
  },
};
