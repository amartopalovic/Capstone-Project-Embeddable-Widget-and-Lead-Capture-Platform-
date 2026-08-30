import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import { DEFAULT_OPT_IN_MODE } from '../records/index.js';
import type { Migration } from './types.js';

/**
 * Stage 11: consent, suppression, privacy requests, and retention anchors
 * (blueprint 4.8, 9.2, 9.5).
 *
 * Append-only, per the rule in runner.ts: 001-009 are untouched.
 *
 * The backfills below matter as much as the indexes. Four collections gain
 * required fields, and a required field with no value on existing rows is a
 * field the application has to defend against forever. Backfilling once, here,
 * is what lets the record types stay non-optional.
 */
export const migration010Privacy: Migration = {
  id: '010_privacy',
  description: 'Marketing suppression, privacy requests, consent state, and retention anchors',

  async up(db: Db): Promise<void> {
    // --- suppression (blueprint 4.8) --------------------------------------

    await db.collection(COLLECTIONS.suppressions).createIndexes([
      /**
       * The lookup every marketing send performs, and the uniqueness that makes
       * a second unsubscribe a no-op rather than a duplicate row.
       */
      {
        key: { workspaceId: 1, emailHash: 1 },
        name: 'workspace_email_hash_unique',
        unique: true,
      },
    ]);

    // --- privacy requests (blueprint 9.2: workspace/contact/status/token) --

    await db.collection(COLLECTIONS.privacyRequests).createIndexes([
      { key: { workspaceId: 1, contactId: 1, createdAt: -1 }, name: 'workspace_contact_date' },

      /**
       * Verification is a lookup BY TOKEN HASH alone, then a workspace check -
       * because the person clicking the link has no session and no workspace
       * context. The hash is 256 bits of randomness, so it identifies the
       * request on its own; the scope check afterwards is what keeps the answer
       * tenant-correct.
       */
      { key: { tokenHash: 1 }, name: 'token_hash', unique: true },

      /** The sweep that expires unverified requests. */
      { key: { status: 1, expiresAt: 1 }, name: 'status_expiry' },
    ]);

    // --- consent evidence gains version, source, and pseudonym ------------

    await db
      .collection(COLLECTIONS.consentEvents)
      .createIndexes([
        { key: { workspaceId: 1, contactId: 1, occurredAt: -1 }, name: 'workspace_contact_date' },
      ]);

    /**
     * Existing consent events predate the version/source fields.
     *
     * They were all written by the submission path from a widget form, so that
     * is what they are labelled - a truthful backfill rather than a guess. The
     * text version is derived from the stored wording by the same function the
     * application uses, but a migration cannot import application code, so
     * these are marked `legacy` instead of being given a fingerprint that might
     * not match what the application would compute today.
     */
    await db
      .collection(COLLECTIONS.consentEvents)
      .updateMany(
        { source: { $exists: false } },
        { $set: { source: 'widget_form', textVersion: 'legacy', ipPseudonym: null } },
      );

    // --- contacts gain consent state and a retention anchor ---------------

    await db.collection(COLLECTIONS.contacts).createIndexes([
      /**
       * The active-contact retention sweep: everything in one workspace whose
       * anchor has passed. Leading with the record status keeps trashed and
       * merged rows out of the scan entirely, since they retire on their own
       * timetable.
       */
      {
        key: { workspaceId: 1, recordStatus: 1, retentionAnchorAt: 1 },
        name: 'workspace_status_retention_anchor',
      },
      { key: { workspaceId: 1, consentState: 1 }, name: 'workspace_consent_state' },
    ]);

    /**
     * The anchor starts at the last submission (blueprint 9.5: "measured from
     * the latest retained submission or intentional workspace activity").
     *
     * `$set` with an aggregation pipeline rather than a loop, so a large
     * collection is one server-side pass.
     */
    await db
      .collection(COLLECTIONS.contacts)
      .updateMany({ retentionAnchorAt: { $exists: false } }, [
        {
          $set: {
            retentionAnchorAt: { $ifNull: ['$lastSubmissionAt', '$createdAt'] },
            consentState: 'none',
            consentUpdatedAt: null,
          },
        },
      ]);

    // --- workspaces gain the opt-in mode ----------------------------------

    await db
      .collection(COLLECTIONS.workspaces)
      .updateMany({ optInMode: { $exists: false } }, { $set: { optInMode: DEFAULT_OPT_IN_MODE } });

    /**
     * The purge sweeps for widget, workspace, and account trash.
     *
     * Contacts already have a deadline index from 007. These three did not,
     * because until this stage nothing swept them - the windows were recorded
     * and never enforced.
     */
    await db
      .collection(COLLECTIONS.widgets)
      .createIndex({ status: 1, purgeAfter: 1 }, { name: 'status_purge_after' });
    await db
      .collection(COLLECTIONS.workspaces)
      .createIndex({ status: 1, purgeAfter: 1 }, { name: 'status_purge_after' });
    await db
      .collection(COLLECTIONS.users)
      .createIndex({ status: 1, purgeAfter: 1 }, { name: 'status_purge_after' });
  },
};
