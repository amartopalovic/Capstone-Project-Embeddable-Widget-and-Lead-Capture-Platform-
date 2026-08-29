import type { Db, ObjectId, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { ContactActivityRecord } from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import type { WorkspaceScope } from './workspace-scope.js';

/**
 * Append-only collaboration history for a Contact (blueprint 9.2, 9.3).
 *
 * There is deliberately no update or delete method. An activity entry is the
 * record of who did what; the ability to rewrite it would remove the only
 * reason to keep it.
 */
export class ContactActivityRepository extends WorkspaceScopedRepository<ContactActivityRecord> {
  protected readonly collectionName = COLLECTIONS.contactActivities;

  constructor(db: Db) {
    super(db);
  }

  /** Newest first, which is the order a timeline reads in. */
  async listForContact(
    scope: WorkspaceScope,
    contactId: ObjectId,
    limit = 100,
  ): Promise<WithId<ContactActivityRecord>[]> {
    return this.findMany(scope, { contactId }, { sort: { occurredAt: -1, _id: -1 }, limit });
  }

  /**
   * Move every entry from a retired duplicate onto the survivor.
   *
   * Returns how many moved, so the caller can record it in the audit trail
   * blueprint 9.3 requires of a merge.
   */
  async relinkContact(scope: WorkspaceScope, from: ObjectId, to: ObjectId): Promise<number> {
    const result = await this.collection.updateMany(this.scopedFilter(scope, { contactId: from }), {
      $set: { contactId: to },
    });
    return result.modifiedCount;
  }
}
