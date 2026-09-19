import type { Db, Filter, ObjectId, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { InvitationRecord } from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import type { WorkspaceScope } from './workspace-scope.js';

export class InvitationRepository extends WorkspaceScopedRepository<InvitationRecord> {
  protected readonly collectionName = COLLECTIONS.invitations;

  constructor(db: Db) {
    super(db);
  }

  async listPending(scope: WorkspaceScope): Promise<WithId<InvitationRecord>[]> {
    return this.findMany(scope, { status: 'pending' });
  }

  /**
   * Every pending invitation addressed to one email, across ALL workspaces.
   *
   * Unscoped for the same reason as `listAllForUser`: a person who has just
   * verified a brand-new account has no workspace context yet, and their
   * pending invitations may span several workspaces. The filter is the
   * recipient's own normalized email, so it can only return invitations
   * addressed to them.
   */
  async listPendingForRecipient(normalizedEmail: string): Promise<WithId<InvitationRecord>[]> {
    return this.db
      .collection<InvitationRecord>(this.collectionName)
      .find({ normalizedEmail, status: 'pending' })
      .toArray();
  }

  /**
   * Consume a PENDING invitation, exactly once.
   *
   * The status is part of the filter rather than only part of the update, so
   * two concurrent redemptions of the same link cannot both win: MongoDB
   * applies the update to one document at a time, and the loser matches
   * nothing because the status is no longer `pending`. `updateById` cannot do
   * this - it matches on `_id` and workspace alone, so both callers would be
   * told they consumed the invitation and both would go on to insert a
   * membership, leaving the unique index to reject the second one with a
   * driver error the caller cannot act on (Stage 15 correction).
   *
   * Returns true only for the caller that actually moved it out of `pending`.
   */
  async consumePending(scope: WorkspaceScope, id: ObjectId, acceptedAt: Date): Promise<boolean> {
    const result = await this.collection.updateOne(
      this.scopedFilter(scope, { _id: id, status: 'pending' } as Filter<InvitationRecord>),
      { $set: { status: 'accepted', acceptedAt, updatedAt: acceptedAt } as never },
    );
    return result.modifiedCount > 0;
  }

  /**
   * Look up an invitation by the HASH of its token, within a workspace.
   *
   * The plaintext token is never stored, so callers hash first. Stage 4 owns
   * the acceptance flow; this is the storage-shape half only.
   */
  async findByTokenHash(
    scope: WorkspaceScope,
    tokenHash: string,
  ): Promise<WithId<InvitationRecord> | null> {
    return this.findOne(scope, { tokenHash });
  }
}
