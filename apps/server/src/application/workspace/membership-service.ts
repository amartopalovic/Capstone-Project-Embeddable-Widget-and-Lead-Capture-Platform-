import type { ObjectId } from 'mongodb';
import type { WorkspaceScope } from '@lcp/database';
import type { Logger, MemberSummary, WorkspaceRoleName } from '@lcp/contracts';
import type {
  MembershipRepositoryPort,
  UserLookupPort,
  WithIdUser,
  WorkspaceAuditPort,
} from './types.js';
import type { Clock } from '../../ports/clock.js';
import {
  canChangeRole,
  canRemoveMember,
  type PolicySubject,
} from '../../domain/workspace/capabilities.js';

/**
 * Membership management (blueprint 4.1 and 11).
 *
 * The role asymmetry lives in the policy engine, not here: this service asks
 * `canChangeRole` and `canRemoveMember` rather than re-deriving who may do
 * what, so there is exactly one place the matrix is encoded.
 */

export type RoleChangeOutcome =
  { readonly kind: 'changed' } | { readonly kind: 'not_found' } | { readonly kind: 'forbidden' };

export type RemoveOutcome =
  | { readonly kind: 'removed'; readonly removedUserId: ObjectId }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'forbidden' };

export interface MembershipServiceDeps {
  readonly memberships: MembershipRepositoryPort;
  readonly users: UserLookupPort;
  readonly audit: WorkspaceAuditPort;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class MembershipService {
  readonly #deps: MembershipServiceDeps;

  constructor(deps: MembershipServiceDeps) {
    this.#deps = deps;
  }

  async list(scope: WorkspaceScope, callerUserId: ObjectId): Promise<readonly MemberSummary[]> {
    const { memberships, users } = this.#deps;
    const records = await memberships.findMany(scope);

    const summaries = await Promise.all(
      records.map(async (membership) => {
        const user = await users.findById(membership.userId);
        return {
          userId: membership.userId.toHexString(),
          // A membership whose user record is gone should not crash the list.
          email: user?.email ?? 'unknown',
          role: membership.role,
          emailVerified: user?.emailVerifiedAt !== null && user?.emailVerifiedAt !== undefined,
          joinedAt: membership.createdAt.toISOString(),
          isSelf: membership.userId.equals(callerUserId),
        } satisfies MemberSummary;
      }),
    );

    // Owner first, then admins, then members, then by email for stability.
    const order: Record<WorkspaceRoleName, number> = { owner: 0, admin: 1, member: 2 };
    return summaries.sort(
      (a, b) => order[a.role] - order[b.role] || a.email.localeCompare(b.email),
    );
  }

  async changeRole(
    scope: WorkspaceScope,
    actor: WithIdUser,
    actorRole: WorkspaceRoleName,
    targetUserId: ObjectId,
    nextRole: WorkspaceRoleName,
    correlationId: string,
  ): Promise<RoleChangeOutcome> {
    const { memberships, audit, clock } = this.#deps;

    const target = await memberships.findByUser(scope, targetUserId);
    if (target === null) return { kind: 'not_found' };

    const subject: PolicySubject & { userId: string } = {
      role: actorRole,
      emailVerified: actor.emailVerifiedAt !== null,
      userId: actor._id.toHexString(),
    };

    const permitted = canChangeRole(
      subject,
      { userId: targetUserId.toHexString(), role: target.role },
      nextRole,
    );
    if (!permitted) return { kind: 'forbidden' };

    if (target.role === nextRole) return { kind: 'changed' };

    const now = clock.now();
    await memberships.updateById(scope, target._id, { role: nextRole, updatedAt: now });

    await audit.record(scope, {
      type: 'membership.role_changed',
      actorUserId: actor._id,
      correlationId,
      metadata: {
        targetUserId: targetUserId.toHexString(),
        fromRole: target.role,
        toRole: nextRole,
      },
    });

    return { kind: 'changed' };
  }

  async remove(
    scope: WorkspaceScope,
    actor: WithIdUser,
    actorRole: WorkspaceRoleName,
    targetUserId: ObjectId,
    correlationId: string,
  ): Promise<RemoveOutcome> {
    const { memberships, audit } = this.#deps;

    const target = await memberships.findByUser(scope, targetUserId);
    if (target === null) return { kind: 'not_found' };

    const subject: PolicySubject & { userId: string } = {
      role: actorRole,
      emailVerified: actor.emailVerifiedAt !== null,
      userId: actor._id.toHexString(),
    };

    if (!canRemoveMember(subject, { userId: targetUserId.toHexString(), role: target.role })) {
      return { kind: 'forbidden' };
    }

    await memberships.deleteById(scope, target._id);

    await audit.record(scope, {
      type: 'membership.removed',
      actorUserId: actor._id,
      correlationId,
      metadata: { targetUserId: targetUserId.toHexString(), role: target.role },
    });

    return { kind: 'removed', removedUserId: targetUserId };
  }

  /** The caller's role in this workspace, or null if they are not a member. */
  async roleOf(scope: WorkspaceScope, userId: ObjectId): Promise<WorkspaceRoleName | null> {
    const membership = await this.#deps.memberships.findByUser(scope, userId);
    return membership?.role ?? null;
  }
}
