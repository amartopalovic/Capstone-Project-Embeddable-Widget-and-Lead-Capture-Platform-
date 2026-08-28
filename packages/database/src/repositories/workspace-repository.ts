import type { Collection, Db, ObjectId, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { WorkspaceRecord } from '../records/index.js';
import { assertWorkspaceScope, type WorkspaceScope } from './workspace-scope.js';

/**
 * Workspace is the TENANT record itself, so it is scoped by its own _id rather
 * than by a workspaceId field. It therefore does not extend
 * WorkspaceScopedRepository, but every read still requires a scope: a caller
 * cannot fetch an arbitrary workspace without naming which one it is entitled
 * to, and `findInScope` returns null for any other tenant.
 */
export class WorkspaceRepository {
  readonly #collection: Collection<WorkspaceRecord>;

  constructor(db: Db) {
    this.#collection = db.collection<WorkspaceRecord>(COLLECTIONS.workspaces);
  }

  /** Fetch the workspace named by the scope, and only that one. */
  async findInScope(scope: WorkspaceScope): Promise<WithId<WorkspaceRecord> | null> {
    const workspaceId = assertWorkspaceScope(scope);
    return this.#collection.findOne({ _id: workspaceId });
  }

  async updateInScope(
    scope: WorkspaceScope,
    set: Partial<Omit<WorkspaceRecord, '_id'>>,
  ): Promise<boolean> {
    const workspaceId = assertWorkspaceScope(scope);
    const result = await this.#collection.updateOne({ _id: workspaceId }, { $set: set });
    return result.matchedCount > 0;
  }

  /**
   * Creating a workspace necessarily happens before a scope for it exists, so
   * this is the one entry point that takes no scope. Onboarding rules and the
   * one-owned-workspace constraint are enforced in Stage 4; the unique partial
   * index on an active ownerUserId backs it at the storage layer today.
   */
  async insert(
    document: Omit<WorkspaceRecord, '_id'> & { _id?: ObjectId },
  ): Promise<WithId<WorkspaceRecord>> {
    const result = await this.#collection.insertOne(document as WorkspaceRecord);
    return { ...document, _id: result.insertedId } as WithId<WorkspaceRecord>;
  }

  async findOwnedBy(ownerUserId: ObjectId): Promise<WithId<WorkspaceRecord> | null> {
    return this.#collection.findOne({ ownerUserId, status: 'active' });
  }

  /**
   * Load several workspaces by id.
   *
   * Used only to hydrate the switcher list, whose ids come from the caller's
   * OWN memberships. It never widens what a user can see: the id set is already
   * the set they belong to.
   */
  async findManyByIds(ids: readonly ObjectId[]): Promise<WithId<WorkspaceRecord>[]> {
    if (ids.length === 0) return [];
    return this.#collection.find({ _id: { $in: [...ids] } }).toArray();
  }

  /**
   * Soft-deleted workspaces this user owns that are still inside the recovery
   * window (blueprint 9.5).
   *
   * Filtered by `ownerUserId`, which is the caller's own id, so like
   * `findOwnedBy` this reads only records the caller already owns. It exists
   * because a deleted workspace is deliberately absent from the switcher and
   * can never be the ACTIVE workspace, so without it an owner would have no
   * way to name the workspace they are entitled to restore.
   */
  async listRecoverableOwnedBy(
    ownerUserId: ObjectId,
    now: Date,
  ): Promise<WithId<WorkspaceRecord>[]> {
    return this.#collection
      .find({ ownerUserId, status: 'deleted', purgeAfter: { $gt: now } })
      .sort({ deletedAt: -1 })
      .toArray();
  }

  /** Restore a soft-deleted workspace, scoped to the one being restored. */
  async restore(id: ObjectId, at: Date): Promise<boolean> {
    const result = await this.#collection.updateOne(
      { _id: id, status: 'deleted' },
      { $set: { status: 'active', deletedAt: null, purgeAfter: null, updatedAt: at } },
    );
    return result.modifiedCount > 0;
  }
}
