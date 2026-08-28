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

  /**
   * Every membership belonging to one user, across ALL workspaces.
   *
   * This is deliberately unscoped, and it is the one shape of unscoped read the
   * tenancy invariant permits: the question "which workspaces does this user
   * belong to" cannot be answered from inside a single workspace, and it is
   * asked before any workspace has been selected. It filters by userId, so it
   * can only ever return memberships that user owns; it can never surface
   * another tenant's data.
   *
   * Everything reached AFTER a workspace is chosen goes back through the scoped
   * base class.
   */
  async listAllForUser(userId: ObjectId): Promise<WithId<MembershipRecord>[]> {
    return this.db.collection<MembershipRecord>(this.collectionName).find({ userId }).toArray();
  }

  async listByRole(
    scope: WorkspaceScope,
    role: WorkspaceRole,
  ): Promise<WithId<MembershipRecord>[]> {
    return this.findMany(scope, { role });
  }
}
