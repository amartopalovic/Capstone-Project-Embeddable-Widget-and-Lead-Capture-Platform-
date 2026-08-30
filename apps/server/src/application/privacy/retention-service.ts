import { ObjectId, type Db } from 'mongodb';
import {
  ANONYMOUS_ACTOR_HEX,
  COLLECTIONS,
  type ContactRecord,
  type UserRecord,
  type WidgetRecord,
  type WorkspaceRecord,
} from '@lcp/database';
import type { Logger } from '@lcp/contracts';
import type { Clock } from '../../ports/clock.js';
import { isBeyondRetention, isPurgeable } from '../../domain/workspace/retention.js';

/**
 * Retention and purge (blueprint 9.5, 12.1).
 *
 * Every "recoverable for 30 days" this product has promised since Stage 4 was,
 * until now, a stored date that nothing acted on. This is what makes those
 * promises true - and, just as importantly, what makes them true *no earlier
 * than promised*.
 *
 * Three properties every sweep here holds to:
 *
 * **Bounded.** Each pass takes a limit and returns what it did. Blueprint 5.2
 * expects a Render instance that sleeps, so a catch-up pass can meet a week of
 * backlog at once; an unbounded delete would turn waking up into an outage.
 * A pass that fills its limit simply leaves the rest for the next one.
 *
 * **Idempotent.** Every purge moves a record OUT of the state the query selects
 * for, so re-running finds nothing to do rather than doing it twice. A retry
 * after a crash mid-sweep is safe by construction, not by a lock.
 *
 * **Never early.** The deadline comparison lives in `domain/workspace/retention`
 * and is `now >= purgeAfter`, so a record is safe for the whole of its final
 * day. Tests drive an injected clock across each boundary from both sides.
 */

export interface RetentionSweepResult {
  readonly contactsPurged: number;
  readonly contactsExpired: number;
  readonly widgetsPurged: number;
  readonly workspacesPurged: number;
  readonly accountsPurged: number;
  readonly privacyRequestsExpired: number;
}

const EMPTY: RetentionSweepResult = {
  contactsPurged: 0,
  contactsExpired: 0,
  widgetsPurged: 0,
  workspacesPurged: 0,
  accountsPurged: 0,
  privacyRequestsExpired: 0,
};

/**
 * How much one pass will do.
 *
 * Small enough that a free-tier instance waking to a backlog stays responsive,
 * large enough that a daily schedule keeps up with a real workspace. A pass
 * that hits the limit is not an error; the next one continues.
 */
export const SWEEP_BATCH = 200;

export interface RetentionServiceDeps {
  readonly db: Db;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class RetentionService {
  readonly #deps: RetentionServiceDeps;

  constructor(deps: RetentionServiceDeps) {
    this.#deps = deps;
  }

  // -------------------------------------------------------------- contacts

  /**
   * Contact trash, 30 days on (blueprint 9.5).
   *
   * "Recoverable for 30 days, then PII/submission values purged or anonymized."
   * Anonymized, not deleted: the contact row and its submission events stay so
   * the workspace's counts, funnel aggregates, and timeline do not silently
   * change shape when a lead retires. What leaves is everything that identifies
   * a person.
   */
  async purgeContactTrash(limit = SWEEP_BATCH): Promise<number> {
    const now = this.#deps.clock.now();
    const contacts = this.#deps.db.collection<ContactRecord>(COLLECTIONS.contacts);

    const due = await contacts
      .find({ recordStatus: 'deleted', purgeAfter: { $lte: now } })
      .limit(limit)
      .toArray();

    let purged = 0;
    for (const contact of due) {
      // Belt and braces: the query already filtered, but the domain rule is
      // what the tests pin, so it decides here too.
      if (!isPurgeable(contact.purgeAfter, now)) continue;
      await this.#anonymizeContact(contact, now);
      purged += 1;
    }
    return purged;
  }

  /**
   * Active contacts past the workspace's retention setting (blueprint 9.5, 4.8).
   *
   * The anchor is the contact's own `retentionAnchorAt`, which moves on a new
   * submission and on deliberate human work - not `updatedAt`, which a bulk
   * re-tag would push forward and quietly grant another twelve months.
   *
   * A workspace set to indefinite is skipped entirely rather than swept with a
   * far-away deadline, so "keep forever" costs nothing per pass.
   */
  async expireActiveContacts(limit = SWEEP_BATCH): Promise<number> {
    const now = this.#deps.clock.now();
    const workspaces = await this.#deps.db
      .collection<WorkspaceRecord>(COLLECTIONS.workspaces)
      .find({ status: 'active', retentionDays: { $gt: 0 } })
      .toArray();

    const contacts = this.#deps.db.collection<ContactRecord>(COLLECTIONS.contacts);
    let expired = 0;

    for (const workspace of workspaces) {
      if (expired >= limit) break;
      const cutoff = new Date(now.getTime() - workspace.retentionDays * 24 * 60 * 60 * 1000);

      const due = await contacts
        .find({
          workspaceId: workspace._id,
          recordStatus: 'active',
          retentionAnchorAt: { $lte: cutoff },
        })
        .limit(limit - expired)
        .toArray();

      for (const contact of due) {
        if (!isBeyondRetention(contact.retentionAnchorAt, workspace.retentionDays, now)) continue;
        await this.#anonymizeContact(contact, now);
        expired += 1;
      }
    }
    return expired;
  }

  /**
   * Strip a contact down to a non-identifying shell.
   *
   * The email is replaced with a tombstone derived from the record's own id
   * rather than removed, because `normalizedEmail` is uniquely indexed among
   * active records and a null would collide the moment a second contact
   * retired. Deriving it from `_id` guarantees uniqueness without keeping
   * anything about the person.
   *
   * Submission values go entirely. They are the free-text a visitor typed, so
   * they are the most sensitive thing here and the least useful once the lead
   * is gone; the event rows survive with their timestamps and source so
   * analytics stay honest.
   *
   * Idempotent, and by construction rather than by a lock. Clearing
   * `purgeAfter` takes the record out of the trash sweep's match, and setting
   * `recordStatus` to deleted takes it out of the active-retention sweep's - so
   * a second pass over the same contact finds nothing rather than blanking an
   * already-blank row. `retentionAnchorAt` is deliberately left alone; it is
   * history, and rewriting it would erase when the lead was last real.
   */
  async #anonymizeContact(contact: ContactRecord & { _id: ObjectId }, now: Date): Promise<void> {
    const db = this.#deps.db;

    await db.collection<ContactRecord>(COLLECTIONS.contacts).updateOne(
      { _id: contact._id, workspaceId: contact.workspaceId },
      {
        $set: {
          email: '',
          normalizedEmail: `purged-${contact._id.toHexString()}`,
          name: null,
          phone: null,
          company: null,
          tags: [],
          assigneeUserId: null,
          recordStatus: 'deleted',
          deletedAt: contact.deletedAt ?? now,
          // Cleared so this record can never be selected by a purge query
          // again, which is what makes a repeated sweep a no-op.
          purgeAfter: null,
          updatedAt: now,
        },
      },
    );

    await db
      .collection(COLLECTIONS.submissionEvents)
      .updateMany(
        { workspaceId: contact.workspaceId, contactId: contact._id },
        { $set: { values: {} } },
      );

    /**
     * Notes are free text a teammate wrote about a person, so they go with the
     * PII. The structural entries - status changed, assigned, tagged - stay,
     * because they are the workspace's own accountability record and contain
     * nothing about the contact beyond what already happened to a row.
     */
    await db
      .collection(COLLECTIONS.contactActivities)
      .updateMany(
        { workspaceId: contact.workspaceId, contactId: contact._id, type: 'note_added' },
        { $set: { note: null } },
      );

    /**
     * Consent text stays, deliberately.
     *
     * It records what a sentence said, not who read it, and 4.8 requires the
     * evidence to be immutable. The link to a person is gone with the contact's
     * identity above.
     */

    this.#deps.logger.info('retention.contact_purged', {
      result: 'success',
      workspaceId: contact.workspaceId.toHexString(),
      contactId: contact._id.toHexString(),
    });
  }

  // --------------------------------------------------------------- widgets

  /**
   * Widget trash, 30 days on (blueprint 9.5).
   *
   * "Recoverable for 30 days; historical contacts/submissions remain." So the
   * widget and its revisions go, and everything the widget ever collected
   * stays - deleting a form must not delete the leads it gathered, which would
   * be a data-loss bug wearing a retention rule's clothes.
   */
  async purgeWidgetTrash(limit = SWEEP_BATCH): Promise<number> {
    const now = this.#deps.clock.now();
    const widgets = this.#deps.db.collection<WidgetRecord>(COLLECTIONS.widgets);

    const due = await widgets
      .find({ status: 'deleted', purgeAfter: { $lte: now } })
      .limit(limit)
      .toArray();

    let purged = 0;
    for (const widget of due) {
      if (!isPurgeable(widget.purgeAfter, now)) continue;

      await this.#deps.db
        .collection(COLLECTIONS.widgetRevisions)
        .deleteMany({ workspaceId: widget.workspaceId, widgetId: widget._id });
      await widgets.deleteOne({ _id: widget._id, workspaceId: widget.workspaceId });

      this.#deps.logger.info('retention.widget_purged', {
        result: 'success',
        workspaceId: widget.workspaceId.toHexString(),
        widgetId: widget._id.toHexString(),
      });
      purged += 1;
    }
    return purged;
  }

  // ------------------------------------------------------------ workspaces

  /**
   * Workspace trash, 30 days on (blueprint 9.5): "then tenant purge".
   *
   * Every workspace-owned collection, by workspaceId. The list is derived from
   * `COLLECTIONS` rather than typed out, so a collection added in a later stage
   * is purged automatically instead of being quietly left behind - a tenant
   * purge that misses a collection is a tenancy leak with a delay on it.
   */
  async purgeWorkspaceTrash(limit = SWEEP_BATCH): Promise<number> {
    const now = this.#deps.clock.now();
    const workspaces = this.#deps.db.collection<WorkspaceRecord>(COLLECTIONS.workspaces);

    const due = await workspaces
      .find({ status: 'deleted', purgeAfter: { $lte: now } })
      .limit(limit)
      .toArray();

    let purged = 0;
    for (const workspace of due) {
      if (!isPurgeable(workspace.purgeAfter, now)) continue;

      for (const collection of WORKSPACE_OWNED_COLLECTIONS) {
        await this.#deps.db.collection(collection).deleteMany({ workspaceId: workspace._id });
      }
      await workspaces.deleteOne({ _id: workspace._id });

      this.#deps.logger.info('retention.workspace_purged', {
        result: 'success',
        workspaceId: workspace._id.toHexString(),
      });
      purged += 1;
    }
    return purged;
  }

  // -------------------------------------------------------------- accounts

  /**
   * Account deletion, 30 days on (blueprint 9.5).
   *
   * "memberships/profile removed and historical actor references anonymized."
   * The last clause is the interesting one, and it is why nothing here
   * cascades: an audit trail exists to say what happened in a workspace, and
   * destroying it because its author left would hand anyone a way to erase
   * their own history by closing their account.
   *
   * So the record of the ACTION survives and the identity behind it is replaced
   * with a reserved id. History stays complete; the person stops being named.
   */
  async purgeAccounts(limit = SWEEP_BATCH): Promise<number> {
    const now = this.#deps.clock.now();
    const users = this.#deps.db.collection<UserRecord>(COLLECTIONS.users);

    const due = await users
      .find({ status: 'deleted', purgeAfter: { $lte: now } })
      .limit(limit)
      .toArray();

    const anonymous = new ObjectId(ANONYMOUS_ACTOR_HEX);
    let purged = 0;

    for (const user of due) {
      if (!isPurgeable(user.purgeAfter, now)) continue;

      await this.#deps.db.collection(COLLECTIONS.memberships).deleteMany({ userId: user._id });

      for (const [collection, field] of ACTOR_REFERENCES) {
        await this.#deps.db
          .collection(collection)
          .updateMany({ [field]: user._id }, { $set: { [field]: anonymous } });
      }

      /**
       * The profile itself is removed, not anonymized - blueprint 9.5 says
       * "memberships/profile removed". The row stays as a tombstone so a
       * dangling actor reference written between this sweep's two writes still
       * resolves, and it carries nothing about the person.
       */
      await users.updateOne(
        { _id: user._id },
        {
          $set: {
            email: '',
            normalizedEmail: `purged-${user._id.toHexString()}`,
            passwordHash: null,
            emailVerifiedAt: null,
            emailVerification: null,
            passwordReset: null,
            totpSecret: null,
            mfaEnabled: false,
            mfaEnabledAt: null,
            lastTotpCounter: null,
            recoveryCodes: [],
            lastLoginAt: null,
            purgeAfter: null,
            updatedAt: now,
          },
        },
      );

      this.#deps.logger.info('retention.account_purged', {
        result: 'success',
        userId: user._id.toHexString(),
      });
      purged += 1;
    }
    return purged;
  }

  // ------------------------------------------------------- privacy requests

  /**
   * Verification tokens that were never used (blueprint 4.8).
   *
   * Bounded like every other sweep: the ids are selected first and updated by
   * id, rather than one `updateMany` over an unbounded match. After a long
   * sleep that match could be the whole backlog at once.
   */
  async expirePrivacyRequests(limit = SWEEP_BATCH): Promise<number> {
    const now = this.#deps.clock.now();
    const requests = this.#deps.db.collection(COLLECTIONS.privacyRequests);

    const due = await requests
      .find(
        { status: 'pending_verification', expiresAt: { $lte: now } },
        { projection: { _id: 1 } },
      )
      .limit(limit)
      .toArray();
    if (due.length === 0) return 0;

    const result = await requests.updateMany(
      { _id: { $in: due.map((row) => row._id) } },
      {
        $set: {
          status: 'expired',
          // The address is not needed once the request can no longer be acted
          // on, and keeping it would leave a list of people who asked.
          email: null,
          updatedAt: now,
        },
      },
    );
    return result.modifiedCount;
  }

  // ------------------------------------------------------------- the sweep

  /**
   * One scheduled pass over everything (blueprint 9.5, 12.1).
   *
   * Order matters in one place: workspace purge runs LAST. It deletes contacts
   * and widgets wholesale, so running it first would leave the earlier sweeps
   * counting records that no longer exist - and make the returned figures a
   * worse description of what happened.
   */
  async sweep(limit = SWEEP_BATCH): Promise<RetentionSweepResult> {
    const contactsExpired = await this.expireActiveContacts(limit);
    const contactsPurged = await this.purgeContactTrash(limit);
    const widgetsPurged = await this.purgeWidgetTrash(limit);
    const accountsPurged = await this.purgeAccounts(limit);
    const privacyRequestsExpired = await this.expirePrivacyRequests(limit);
    const workspacesPurged = await this.purgeWorkspaceTrash(limit);

    const result: RetentionSweepResult = {
      contactsExpired,
      contactsPurged,
      widgetsPurged,
      accountsPurged,
      privacyRequestsExpired,
      workspacesPurged,
    };

    const total = Object.values(result).reduce((sum, count) => sum + count, 0);
    if (total > 0) {
      this.#deps.logger.info('retention.sweep_completed', { result: 'success', ...result });
    }
    return result;
  }

  /**
   * The catch-up pass that runs at startup (blueprint 9.5, 5.2).
   *
   * "Cleanup jobs run on a schedule when the service is active and also run
   * bounded catch-up sweeps during startup, so Render sleep delays but does not
   * permanently skip retention work."
   *
   * This is not belt-and-braces. A BullMQ job scheduler holds exactly ONE
   * pending iteration at a time and re-arms from the moment it is upserted, so
   * it does not backfill: a process that slept through four daily slots wakes
   * to one late run, not four, and an upsert during boot can move the next slot
   * forward past a deadline that has already passed. The schedule therefore
   * guarantees "eventually"; only a pass at startup guarantees "not skipped".
   *
   * Deliberately swallows its own failure. A retention backlog must not stop a
   * web process from coming up and serving requests - the work is still due,
   * and the schedule will reach it.
   */
  async catchUp(): Promise<RetentionSweepResult> {
    try {
      const result = await this.sweep();
      this.#deps.logger.info('retention.startup_catchup', { result: 'success', ...result });
      return result;
    } catch (error) {
      this.#deps.logger.error('retention.startup_catchup_failed', {
        result: 'degraded',
        reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      });
      return EMPTY;
    }
  }
}

/**
 * Every collection carrying a workspaceId (blueprint 9.1).
 *
 * Derived from the canonical map so a tenant purge cannot fall behind the
 * schema: a collection added in a later stage is swept without anyone
 * remembering to add it here, and a tenant purge that misses a collection is a
 * tenancy leak with a delay on it.
 *
 * The three exclusions are the collections with no `workspaceId` to match on.
 * `workspaces` is excluded because the row itself is deleted separately, after
 * its contents.
 */
const NOT_WORKSPACE_OWNED = new Set<string>([
  COLLECTIONS.users,
  COLLECTIONS.workspaces,
  COLLECTIONS.migrations,
]);

export const WORKSPACE_OWNED_COLLECTIONS: readonly string[] = Object.values(COLLECTIONS).filter(
  (name) => !NOT_WORKSPACE_OWNED.has(name),
);

/**
 * Where a user id appears as an actor in history.
 *
 * Listed explicitly rather than discovered, because the difference between an
 * actor reference and an ownership reference matters: `ownerUserId` on a
 * workspace is not history and must never be anonymized out from under a live
 * tenant - a workspace with an anonymous owner is a workspace nobody can
 * administer.
 */
const ACTOR_REFERENCES: readonly (readonly [string, string])[] = [
  [COLLECTIONS.auditEvents, 'actorUserId'],
  [COLLECTIONS.contactActivities, 'actorUserId'],
  [COLLECTIONS.contacts, 'assigneeUserId'],
  [COLLECTIONS.widgetRevisions, 'publishedByUserId'],
  [COLLECTIONS.widgetRevisions, 'createdByUserId'],
  [COLLECTIONS.invitations, 'invitedByUserId'],
];
