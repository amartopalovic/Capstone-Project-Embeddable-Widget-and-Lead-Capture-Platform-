import type { Db, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { PrivacyRequestRecord } from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';

/**
 * Self-service export and deletion requests (blueprint 4.8, 9.2).
 */
export class PrivacyRequestRepository extends WorkspaceScopedRepository<PrivacyRequestRecord> {
  protected readonly collectionName = COLLECTIONS.privacyRequests;

  constructor(db: Db) {
    super(db);
  }

  /**
   * Find a request by its token hash, WITHOUT a workspace scope.
   *
   * The one deliberate exception to the rule that every read is scoped, and it
   * is safe for a specific reason: the person following this link out of an
   * email has no session, so there is no scope to check against yet. The token
   * hash is 256 bits of randomness and uniquely indexed, so it identifies one
   * request on its own - it is the credential, not a hint. The caller derives
   * the scope FROM the record it returns rather than being trusted to supply
   * one, so nothing downstream is unscoped.
   *
   * Named to be conspicuous in a review, and kept off the scoped base class so
   * it cannot be reached by habit.
   */
  async findByTokenHashUnscoped(tokenHash: string): Promise<WithId<PrivacyRequestRecord> | null> {
    return this.db.collection<PrivacyRequestRecord>(this.collectionName).findOne({ tokenHash });
  }

  /**
   * Requests whose verification window has closed.
   *
   * Bounded by the caller: after a long sleep this is a backlog, not a stream,
   * and an unbounded sweep on a free-tier instance is how a catch-up pass
   * becomes an outage.
   */
  async findExpirable(now: Date, limit: number): Promise<WithId<PrivacyRequestRecord>[]> {
    return this.db
      .collection<PrivacyRequestRecord>(this.collectionName)
      .find({ status: 'pending_verification', expiresAt: { $lte: now } })
      .limit(limit)
      .toArray();
  }
}
