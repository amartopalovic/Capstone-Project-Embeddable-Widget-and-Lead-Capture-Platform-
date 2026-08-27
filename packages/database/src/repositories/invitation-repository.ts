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
