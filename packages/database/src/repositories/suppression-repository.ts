import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { SuppressionRecord } from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import { assertWorkspaceScope, type WorkspaceScope } from './workspace-scope.js';

/**
 * The workspace-wide marketing suppression list (blueprint 4.8).
 *
 * This is the one record that deliberately OUTLIVES the contact it refers to.
 * An email-verified deletion removes the lead entirely, but 4.8 permits
 * "minimal suppression data" to remain so the unsubscribe keeps being honored -
 * otherwise the next submission from that address would recreate the contact
 * and start mailing it again, which is precisely what the person asked not to
 * happen.
 */
export class SuppressionRepository extends WorkspaceScopedRepository<SuppressionRecord> {
  protected readonly collectionName = COLLECTIONS.suppressions;

  constructor(db: Db) {
    super(db);
  }

  /**
   * Suppress an address, or leave it suppressed.
   *
   * An upsert rather than an insert, because unsubscribing twice is a thing
   * people do - a second click on the same link in the same email must be a
   * quiet no-op, not a duplicate-key error shown to somebody who is trying to
   * opt out. `$setOnInsert` keeps the ORIGINAL timestamp and reason, so the
   * record still answers "when did they first say no".
   */
  async suppress(
    scope: WorkspaceScope,
    emailHash: string,
    reason: SuppressionRecord['reason'],
    now: Date,
  ): Promise<void> {
    const workspaceId = assertWorkspaceScope(scope);
    await this.collection.updateOne(
      { workspaceId, emailHash },
      { $setOnInsert: { _id: new ObjectId(), suppressedAt: now, reason } },
      { upsert: true },
    );
  }

  /** Whether this address may be sent marketing mail in this workspace. */
  async isSuppressed(scope: WorkspaceScope, emailHash: string): Promise<boolean> {
    return (await this.findOne(scope, { emailHash })) !== null;
  }

  /**
   * Lift a suppression.
   *
   * Only ever called when the same address gives fresh, confirmed consent -
   * never as an administrative override, because a workspace being able to
   * un-unsubscribe somebody would make the whole list decorative.
   */
  async release(scope: WorkspaceScope, emailHash: string): Promise<void> {
    const workspaceId = assertWorkspaceScope(scope);
    await this.collection.deleteOne({ workspaceId, emailHash });
  }
}
