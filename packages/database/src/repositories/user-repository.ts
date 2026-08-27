import type { Collection, Db, ObjectId, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { UserRecord } from '../records/index.js';

/**
 * User is an ACCOUNT-level record and is deliberately NOT workspace-scoped.
 *
 * A user may belong to many workspaces (blueprint 4.1), so scoping the identity
 * record to one tenant would be wrong. Tenancy for a user is expressed through
 * Membership, which IS workspace-scoped. This repository therefore does not
 * extend WorkspaceScopedRepository, and that asymmetry is intentional.
 *
 * Because it is unscoped, it must never be used to answer "who is in this
 * workspace" - that question belongs to MembershipRepository.
 */
export class UserRepository {
  readonly #collection: Collection<UserRecord>;

  constructor(db: Db) {
    this.#collection = db.collection<UserRecord>(COLLECTIONS.users);
  }

  /** Lowercase and trim, so lookups are case-insensitive and stable. */
  static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async findById(id: ObjectId): Promise<WithId<UserRecord> | null> {
    return this.#collection.findOne({ _id: id });
  }

  async findByEmail(email: string): Promise<WithId<UserRecord> | null> {
    return this.#collection.findOne({
      normalizedEmail: UserRepository.normalizeEmail(email),
      status: 'active',
    });
  }

  async insert(
    document: Omit<UserRecord, '_id'> & { _id?: ObjectId },
  ): Promise<WithId<UserRecord>> {
    const result = await this.#collection.insertOne(document as UserRecord);
    return { ...document, _id: result.insertedId } as WithId<UserRecord>;
  }

  async updateById(id: ObjectId, set: Partial<Omit<UserRecord, '_id'>>): Promise<boolean> {
    const result = await this.#collection.updateOne({ _id: id }, { $set: set });
    return result.matchedCount > 0;
  }
}
