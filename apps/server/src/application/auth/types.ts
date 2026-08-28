import type { ObjectId, WithId } from 'mongodb';
import type { UserRecord } from '@lcp/database';

/**
 * Narrow ports the auth service depends on.
 *
 * Declaring the slice it actually uses, rather than importing the concrete
 * repository classes, keeps the application layer testable with small fakes and
 * makes the dependency direction explicit (blueprint section 6.2).
 */

export type WithIdUser = WithId<UserRecord>;

export interface UserRepository {
  findById(id: ObjectId): Promise<WithIdUser | null>;
  findByEmail(email: string): Promise<WithIdUser | null>;
  insert(document: Omit<UserRecord, '_id'> & { _id?: ObjectId }): Promise<WithIdUser>;
  updateById(id: ObjectId, set: Partial<Omit<UserRecord, '_id'>>): Promise<boolean>;
  findByEmailVerificationTokenHash(tokenHash: string): Promise<WithIdUser | null>;
  findByPasswordResetTokenHash(tokenHash: string): Promise<WithIdUser | null>;
  consumeEmailVerification(id: ObjectId, tokenHash: string, verifiedAt: Date): Promise<boolean>;
  consumePasswordReset(
    id: ObjectId,
    tokenHash: string,
    passwordHash: string,
    changedAt: Date,
  ): Promise<boolean>;
  recordFailedLogin(id: ObjectId, lockedUntil: Date | null): Promise<number>;
  recordSuccessfulLogin(id: ObjectId, at: Date): Promise<void>;
}

export interface AccountAuditEvent {
  readonly type: string;
  readonly actorUserId: ObjectId;
  readonly correlationId: string;
  readonly occurredAt: Date;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface AuditEventRepository {
  insertAccountEvent(event: AccountAuditEvent): Promise<void>;
}
