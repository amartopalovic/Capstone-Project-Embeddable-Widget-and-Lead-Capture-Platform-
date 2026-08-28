import type { ObjectId, WithId } from 'mongodb';
import type {
  AuditEventRecord,
  InvitationRecord,
  MembershipRecord,
  UserRecord,
  WorkspaceRecord,
  WorkspaceScope,
} from '@lcp/database';

/**
 * Narrow ports for the workspace layer.
 *
 * As in the auth layer, the services declare the slice they actually use rather
 * than importing concrete repository classes, so the dependency direction stays
 * explicit and tests can substitute small fakes.
 */

export type WithIdWorkspace = WithId<WorkspaceRecord>;
export type WithIdMembership = WithId<MembershipRecord>;
export type WithIdInvitation = WithId<InvitationRecord>;
export type WithIdUser = WithId<UserRecord>;

export interface WorkspaceRepositoryPort {
  findInScope(scope: WorkspaceScope): Promise<WithIdWorkspace | null>;
  updateInScope(
    scope: WorkspaceScope,
    set: Partial<Omit<WorkspaceRecord, '_id'>>,
  ): Promise<boolean>;
  insert(document: Omit<WorkspaceRecord, '_id'> & { _id?: ObjectId }): Promise<WithIdWorkspace>;
  findOwnedBy(ownerUserId: ObjectId): Promise<WithIdWorkspace | null>;
  findManyByIds(ids: readonly ObjectId[]): Promise<WithIdWorkspace[]>;
  restore(id: ObjectId, at: Date): Promise<boolean>;
  listRecoverableOwnedBy(ownerUserId: ObjectId, now: Date): Promise<WithIdWorkspace[]>;
}

/** Only what the usage meter needs; the widget layer owns the rest. */
export interface WidgetCountPort {
  countActive(scope: WorkspaceScope): Promise<number>;
}

export interface MembershipRepositoryPort {
  findById(scope: WorkspaceScope, id: ObjectId): Promise<WithIdMembership | null>;
  findByUser(scope: WorkspaceScope, userId: ObjectId): Promise<WithIdMembership | null>;
  findMany(scope: WorkspaceScope, filter?: Record<string, unknown>): Promise<WithIdMembership[]>;
  count(scope: WorkspaceScope, filter?: Record<string, unknown>): Promise<number>;
  insert(
    scope: WorkspaceScope,
    document: Omit<MembershipRecord, '_id' | 'workspaceId'> & { _id?: ObjectId },
  ): Promise<WithIdMembership>;
  updateById(
    scope: WorkspaceScope,
    id: ObjectId,
    set: Partial<Omit<MembershipRecord, '_id' | 'workspaceId'>>,
  ): Promise<boolean>;
  deleteById(scope: WorkspaceScope, id: ObjectId): Promise<boolean>;
  listAllForUser(userId: ObjectId): Promise<WithIdMembership[]>;
}

export interface InvitationRepositoryPort {
  findById(scope: WorkspaceScope, id: ObjectId): Promise<WithIdInvitation | null>;
  findMany(scope: WorkspaceScope, filter?: Record<string, unknown>): Promise<WithIdInvitation[]>;
  listPending(scope: WorkspaceScope): Promise<WithIdInvitation[]>;
  findByTokenHash(scope: WorkspaceScope, tokenHash: string): Promise<WithIdInvitation | null>;
  listPendingForRecipient(normalizedEmail: string): Promise<WithIdInvitation[]>;
  insert(
    scope: WorkspaceScope,
    document: Omit<InvitationRecord, '_id' | 'workspaceId'> & { _id?: ObjectId },
  ): Promise<WithIdInvitation>;
  updateById(
    scope: WorkspaceScope,
    id: ObjectId,
    set: Partial<Omit<InvitationRecord, '_id' | 'workspaceId'>>,
  ): Promise<boolean>;
}

export interface WorkspaceAuditPort {
  record(
    scope: WorkspaceScope,
    event: {
      readonly type: string;
      readonly actorUserId: ObjectId | null;
      readonly correlationId: string;
      readonly metadata: Readonly<Record<string, unknown>>;
    },
  ): Promise<void>;
  listRecent(scope: WorkspaceScope, limit?: number): Promise<WithId<AuditEventRecord>[]>;
}

export interface UserLookupPort {
  findById(id: ObjectId): Promise<WithIdUser | null>;
  findByEmail(email: string): Promise<WithIdUser | null>;
}
