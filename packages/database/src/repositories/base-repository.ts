import type {
  Collection,
  Db,
  Filter,
  FindOptions,
  OptionalUnlessRequiredId,
  WithId,
} from 'mongodb';
import { ObjectId } from 'mongodb';
import type { WorkspaceOwned } from '../records/index.js';
import { assertWorkspaceScope, type WorkspaceScope } from './workspace-scope.js';

/**
 * Base class for every workspace-owned collection.
 *
 * Two properties make the tenancy invariant structural rather than a
 * convention someone has to remember:
 *
 *  1. Every public method requires a WorkspaceScope as its first parameter, so
 *     an unscoped call is a compile error.
 *  2. Filters are only ever built through `scopedFilter`, which merges the
 *     workspaceId LAST. A caller cannot override the tenant by passing their
 *     own workspaceId in a filter, because the scope wins.
 *
 * Writes force workspaceId from the scope for the same reason: a document is
 * stored in the caller's tenant regardless of what its body claims.
 */
export abstract class WorkspaceScopedRepository<TRecord extends WorkspaceOwned> {
  protected abstract readonly collectionName: string;

  constructor(protected readonly db: Db) {}

  protected get collection(): Collection<TRecord> {
    return this.db.collection<TRecord>(this.collectionName);
  }

  /**
   * Build a tenant-scoped filter. The workspace clause is applied after the
   * caller filter so it cannot be overridden.
   */
  protected scopedFilter(scope: WorkspaceScope, filter: Filter<TRecord> = {}): Filter<TRecord> {
    const workspaceId = assertWorkspaceScope(scope);
    return { ...filter, workspaceId } as Filter<TRecord>;
  }

  async findById(scope: WorkspaceScope, id: ObjectId): Promise<WithId<TRecord> | null> {
    return this.collection.findOne(this.scopedFilter(scope, { _id: id } as Filter<TRecord>));
  }

  async findOne(
    scope: WorkspaceScope,
    filter: Filter<TRecord> = {},
    options?: FindOptions,
  ): Promise<WithId<TRecord> | null> {
    return this.collection.findOne(this.scopedFilter(scope, filter), options ?? {});
  }

  async findMany(
    scope: WorkspaceScope,
    filter: Filter<TRecord> = {},
    options?: FindOptions,
  ): Promise<WithId<TRecord>[]> {
    return this.collection.find(this.scopedFilter(scope, filter), options ?? {}).toArray();
  }

  async count(scope: WorkspaceScope, filter: Filter<TRecord> = {}): Promise<number> {
    return this.collection.countDocuments(this.scopedFilter(scope, filter));
  }

  /**
   * Insert a document into the caller's workspace.
   *
   * workspaceId is taken from the scope and overwrites anything in the input,
   * so a document cannot be written into another tenant.
   */
  async insert(
    scope: WorkspaceScope,
    document: Omit<TRecord, '_id' | 'workspaceId'> & { _id?: ObjectId },
  ): Promise<WithId<TRecord>> {
    const workspaceId = assertWorkspaceScope(scope);
    const toInsert = {
      _id: document._id ?? new ObjectId(),
      ...document,
      workspaceId,
    } as unknown as OptionalUnlessRequiredId<TRecord>;

    await this.collection.insertOne(toInsert);
    return toInsert as WithId<TRecord>;
  }

  /** Returns true when a document in THIS workspace was modified. */
  async updateById(
    scope: WorkspaceScope,
    id: ObjectId,
    set: Partial<Omit<TRecord, '_id' | 'workspaceId'>>,
  ): Promise<boolean> {
    const result = await this.collection.updateOne(
      this.scopedFilter(scope, { _id: id } as Filter<TRecord>),
      { $set: set as never },
    );
    return result.matchedCount > 0;
  }

  /** Returns true when a document in THIS workspace was deleted. */
  async deleteById(scope: WorkspaceScope, id: ObjectId): Promise<boolean> {
    const result = await this.collection.deleteOne(
      this.scopedFilter(scope, { _id: id } as Filter<TRecord>),
    );
    return result.deletedCount > 0;
  }
}
