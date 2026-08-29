import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { Migration } from './types.js';

/**
 * Stage 8a: the contact inbox's collaboration history and the indexes the
 * inbox's own queries need (blueprint 4.7, 9.2).
 *
 * Append-only, per the rule in runner.ts: 001-006 are untouched.
 *
 * Migration 006 already created the indexes blueprint 9.2 names for the Contact
 * record itself. What this adds is the ContactActivity collection and the
 * compound keys that the inbox's DEFAULT query actually uses - which is not
 * quite what 006 anticipated, because every inbox query also filters on
 * `recordStatus` and sorts with `_id` as a tiebreaker.
 */
export const migration007ContactInbox: Migration = {
  id: '007_contact_inbox',
  description: 'Contact activity history and the inbox list/sort indexes',

  async up(db: Db): Promise<void> {
    await db
      .collection(COLLECTIONS.contactActivities)
      .createIndexes([
        { key: { workspaceId: 1, contactId: 1, occurredAt: -1 }, name: 'workspace_contact_date' },
      ]);

    await db.collection(COLLECTIONS.contacts).createIndexes([
      /**
       * The inbox's default page, exactly.
       *
       * Every list query filters `recordStatus` and sorts by the chosen field
       * with `_id` as a tiebreaker - MongoDB's own documentation is explicit
       * that `$sort` is not a stable sort and that a unique field must be
       * included for deterministic order, which is also what makes a keyset
       * cursor able to resume from a precise position. The index is built to
       * match that shape rather than the two-field one from 006.
       */
      {
        key: { workspaceId: 1, recordStatus: 1, lastSubmissionAt: -1, _id: -1 },
        name: 'workspace_status_date_id',
      },
      {
        key: { workspaceId: 1, recordStatus: 1, createdAt: -1, _id: -1 },
        name: 'workspace_created',
      },
      {
        key: { workspaceId: 1, recordStatus: 1, normalizedEmail: 1, _id: -1 },
        name: 'workspace_email_sort',
      },
      /** Resolving "which contacts absorbed this duplicate" without a scan. */
      { key: { workspaceId: 1, mergedIntoContactId: 1 }, name: 'workspace_merged_into' },
    ]);

    await db.collection(COLLECTIONS.submissionEvents).createIndexes([
      { key: { workspaceId: 1, 'source.pageUrl': 1 }, name: 'workspace_page_url' },
      { key: { workspaceId: 1, 'geo.city': 1 }, name: 'workspace_city' },
    ]);
  },
};
