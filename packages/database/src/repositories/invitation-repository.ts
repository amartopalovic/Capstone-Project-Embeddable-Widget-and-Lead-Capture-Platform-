import type { Db, WithId } from 'mongodb';
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
