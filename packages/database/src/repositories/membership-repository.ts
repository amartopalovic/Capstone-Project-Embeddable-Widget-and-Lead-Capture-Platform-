import type { Db, WithId } from 'mongodb';
import type { ObjectId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { MembershipRecord, WorkspaceRole } from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import type { WorkspaceScope } from './workspace-scope.js';

export class MembershipRepository extends WorkspaceScopedRepository<MembershipRecord> {
  protected readonly collectionName = COLLECTIONS.memberships;

  constructor(db: Db) {
    super(db);
  }

  async findByUser(
    scope: WorkspaceScope,
    userId: ObjectId,
  ): Promise<WithId<MembershipRecord> | null> {
    return this.findOne(scope, { userId });
  }

  async listByRole(
    scope: WorkspaceScope,
    role: WorkspaceRole,
  ): Promise<WithId<MembershipRecord>[]> {
    return this.findMany(scope, { role });
  }
}
