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

  /**
   * Find a SOFT-DELETED account by address (blueprint 9.5).
   *
   * Separate from `findByEmail`, which filters to active users so a deleted
   * account cannot sign in, cannot reset its password, and cannot be found by
   * anything that has not deliberately asked for it. Account recovery is the
   * one flow that has - and it still proves the password before restoring.
   */
  async findDeletedByEmail(email: string): Promise<WithId<UserRecord> | null> {
    return this.#collection.findOne({
      normalizedEmail: UserRepository.normalizeEmail(email),
      status: 'deleted',
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

  // --- Stage 3a: credential and token lookups ------------------------------

  /**
   * Find an active user by the HASH of a pending verification token.
   *
   * Callers hash the plaintext from the emailed link first; the plaintext is
   * never stored and never queried (blueprint section 17).
   */
  async findByEmailVerificationTokenHash(tokenHash: string): Promise<WithId<UserRecord> | null> {
    return this.#collection.findOne({
      'emailVerification.tokenHash': tokenHash,
      status: 'active',
    });
  }

  async findByPasswordResetTokenHash(tokenHash: string): Promise<WithId<UserRecord> | null> {
    return this.#collection.findOne({
      'passwordReset.tokenHash': tokenHash,
      status: 'active',
    });
  }

  /**
   * Consume a pending token atomically.
   *
   * The filter includes the token hash, so two concurrent redemptions cannot
   * both succeed: the second matches nothing because the first already cleared
   * it. That is what makes the token genuinely single-use, rather than relying
   * on a read-then-write that could interleave.
   */
  async consumeEmailVerification(
    id: ObjectId,
    tokenHash: string,
    verifiedAt: Date,
  ): Promise<boolean> {
    const result = await this.#collection.updateOne(
      { _id: id, 'emailVerification.tokenHash': tokenHash },
      {
        $set: {
          emailVerifiedAt: verifiedAt,
          emailVerification: null,
          updatedAt: verifiedAt,
        },
      },
    );
    return result.modifiedCount > 0;
  }

  async consumePasswordReset(
    id: ObjectId,
    tokenHash: string,
    passwordHash: string,
    changedAt: Date,
  ): Promise<boolean> {
    const result = await this.#collection.updateOne(
      { _id: id, 'passwordReset.tokenHash': tokenHash },
      {
        $set: {
          passwordHash,
          passwordUpdatedAt: changedAt,
          passwordReset: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
          updatedAt: changedAt,
        },
      },
    );
    return result.modifiedCount > 0;
  }

  async recordFailedLogin(id: ObjectId, lockedUntil: Date | null): Promise<number> {
    const result = await this.#collection.findOneAndUpdate(
      { _id: id },
      {
        $inc: { failedLoginAttempts: 1 },
        $set: { lockedUntil, updatedAt: new Date() },
      },
      { returnDocument: 'after' },
    );
    return result?.failedLoginAttempts ?? 0;
  }

  async recordSuccessfulLogin(id: ObjectId, at: Date): Promise<void> {
    await this.#collection.updateOne(
      { _id: id },
      { $set: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: at, updatedAt: at } },
    );
  }
}
