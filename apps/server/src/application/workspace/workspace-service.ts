import type { ObjectId } from 'mongodb';
import {
  workspaceScope,
  DEFAULT_OPT_IN_MODE,
  DEFAULT_RETENTION_DAYS,
  type OptInMode,
  type WorkspaceScope,
} from '@lcp/database';
import {
  WORKSPACE_LIMITS,
  type Logger,
  type WorkspaceRoleName,
  type RecoverableWorkspaceSummary,
  type WorkspaceSummary,
  type WorkspaceUsage,
} from '@lcp/contracts';
import type {
  MembershipRepositoryPort,
  UserLookupPort,
  WithIdUser,
  WithIdWorkspace,
  WidgetCountPort,
  WorkspaceAuditPort,
  WorkspaceRepositoryPort,
} from './types.js';
import type { Clock } from '../../ports/clock.js';
import { monthStartInZone } from '../../domain/submission/quota.js';
import { isValidTimezone } from '../../domain/workspace/timezone.js';
import { purgeDeadline } from '../../domain/workspace/retention.js';

/**
 * Workspace lifecycle: onboarding, the switcher list, ownership transfer, and
 * soft delete/recover (blueprint 4.1 and 9.5).
 */

export type OnboardOutcome =
  | { readonly kind: 'created'; readonly workspace: WithIdWorkspace }
  | { readonly kind: 'already_owns_workspace' }
  | { readonly kind: 'invalid_timezone' };

export type TransferOutcome =
  | { readonly kind: 'transferred' }
  | { readonly kind: 'not_a_member' }
  | { readonly kind: 'not_an_admin' }
  | { readonly kind: 'not_verified' }
  | { readonly kind: 'target_already_owns_workspace' };

export type DeleteOutcome = { readonly kind: 'deleted' } | { readonly kind: 'not_found' };
export type RecoverOutcome =
  | { readonly kind: 'recovered' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'window_expired' };

/** Counts a workspace's records since an instant, for a monthly meter. */
export interface MonthlyCountPort {
  countSince(scope: WorkspaceScope, since: Date): Promise<number>;
}

export interface WorkspaceServiceDeps {
  readonly workspaces: WorkspaceRepositoryPort;
  readonly memberships: MembershipRepositoryPort;
  readonly users: UserLookupPort;
  /**
   * Read-only widget count for the usage meter (blueprint 4.10).
   *
   * A one-method port rather than the whole widget repository: the workspace
   * service has no business reaching into widget lifecycle, and this keeps the
   * dependency direction honest under blueprint 6.2.
   */
  readonly widgets: WidgetCountPort;
  /**
   * The two monthly meters (blueprint 4.10), added in Stage 10a.
   *
   * Narrow ports rather than the repositories themselves: this service needs
   * exactly one method from each, and depending on the whole repository would
   * let a later change reach into submissions from the workspace service.
   */
  readonly submissionEvents: MonthlyCountPort;
  readonly interactionEvents: MonthlyCountPort;
  readonly audit: WorkspaceAuditPort;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class WorkspaceService {
  readonly #deps: WorkspaceServiceDeps;

  constructor(deps: WorkspaceServiceDeps) {
    this.#deps = deps;
  }

  /**
   * Create a user's first workspace (blueprint 4.1).
   *
   * The one-active-owned-workspace limit is checked here AND enforced by the
   * Stage 2 partial unique index. The application check exists so the caller
   * gets a clean 409 rather than a driver duplicate-key error surfacing as a
   * 500; the index is what makes the rule true under a race, since two
   * concurrent onboardings would both pass the read.
   */
  async onboard(
    owner: WithIdUser,
    name: string,
    timezone: string,
    correlationId: string,
  ): Promise<OnboardOutcome> {
    const { workspaces, memberships, audit, clock } = this.#deps;

    if (!isValidTimezone(timezone)) return { kind: 'invalid_timezone' };

    const existing = await workspaces.findOwnedBy(owner._id);
    if (existing !== null) return { kind: 'already_owns_workspace' };

    const now = clock.now();

    let workspace: WithIdWorkspace;
    try {
      workspace = await workspaces.insert({
        name: name.trim(),
        ownerUserId: owner._id,
        timezone,
        retentionDays: DEFAULT_RETENTION_DAYS,
        optInMode: DEFAULT_OPT_IN_MODE,
        // Workspaces people create are never the sandbox (blueprint 14.3).
        isDemo: false,
        status: 'active',
        deletedAt: null,
        purgeAfter: null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      // The unique index caught a race the read above could not.
      if (isDuplicateKeyError(error)) return { kind: 'already_owns_workspace' };
      throw error;
    }

    const scope = workspaceScope(workspace._id);
    await memberships.insert(scope, {
      userId: owner._id,
      role: 'owner',
      createdAt: now,
      updatedAt: now,
    });

    await audit.record(scope, {
      type: 'workspace.created',
      actorUserId: owner._id,
      correlationId,
      metadata: { name: workspace.name, timezone },
    });

    return { kind: 'created', workspace };
  }

  /** Every workspace the user belongs to, with their role in each. */
  async listForUser(
    userId: ObjectId,
    activeWorkspaceId: string | null,
  ): Promise<readonly WorkspaceSummary[]> {
    const { memberships, workspaces } = this.#deps;

    const owned = await memberships.listAllForUser(userId);
    if (owned.length === 0) return [];

    const roleByWorkspace = new Map<string, WorkspaceRoleName>();
    for (const membership of owned) {
      roleByWorkspace.set(membership.workspaceId.toHexString(), membership.role);
    }

    const records = await workspaces.findManyByIds(owned.map((m) => m.workspaceId));

    return (
      records
        // A soft-deleted workspace is not offered in the switcher; the owner
        // recovers it explicitly rather than stumbling back into it.
        .filter((workspace) => workspace.status === 'active')
        .map((workspace) => {
          const id = workspace._id.toHexString();
          return {
            id,
            name: workspace.name,
            timezone: workspace.timezone,
            role: roleByWorkspace.get(id) ?? 'member',
            isActive: id === activeWorkspaceId,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  /**
   * Deleted workspaces this user may still restore.
   *
   * The switcher deliberately hides deleted workspaces, so this is the only
   * place a recoverable one can be named. It reports the deadline rather than
   * a remaining-days count, leaving the presentation to the caller.
   */
  async listRecoverable(userId: ObjectId): Promise<readonly RecoverableWorkspaceSummary[]> {
    const now = this.#deps.clock.now();
    const records = await this.#deps.workspaces.listRecoverableOwnedBy(userId, now);
    return records.map((workspace) => ({
      id: workspace._id.toHexString(),
      name: workspace.name,
      deletedAt: (workspace.deletedAt ?? now).toISOString(),
      purgeAfter: (workspace.purgeAfter ?? purgeDeadline(now)).toISOString(),
    }));
  }

  async findActive(scope: WorkspaceScope): Promise<WithIdWorkspace | null> {
    const workspace = await this.#deps.workspaces.findInScope(scope);
    if (workspace === null || workspace.status !== 'active') return null;
    return workspace;
  }

  /**
   * Transfer ownership to a verified Admin of the same workspace.
   *
   * The two role writes are ordered old-owner-first. The unique index covers
   * `ownerUserId` where `status: 'active'`, so demoting before promoting means
   * there is never an instant with two owner memberships, and a failure between
   * the two leaves the workspace with an owner rather than none.
   */
  async transferOwnership(
    scope: WorkspaceScope,
    currentOwner: WithIdUser,
    targetUserId: ObjectId,
    correlationId: string,
  ): Promise<TransferOutcome> {
    const { memberships, workspaces, users, audit, clock } = this.#deps;
    const now = clock.now();

    const targetMembership = await memberships.findByUser(scope, targetUserId);
    if (targetMembership === null) return { kind: 'not_a_member' };
    if (targetMembership.role !== 'admin') return { kind: 'not_an_admin' };

    const targetUser = await users.findById(targetUserId);
    if (targetUser === null || targetUser.emailVerifiedAt === null) {
      return { kind: 'not_verified' };
    }

    // The incoming owner must not already own a different active workspace,
    // or the transfer would violate the one-owned-workspace rule.
    const targetOwns = await workspaces.findOwnedBy(targetUserId);
    if (targetOwns !== null && !targetOwns._id.equals(scope.workspaceId)) {
      return { kind: 'target_already_owns_workspace' };
    }

    const ownerMembership = await memberships.findByUser(scope, currentOwner._id);
    if (ownerMembership === null) return { kind: 'not_a_member' };

    // Step down first, so the active-owner index is never contended.
    await memberships.updateById(scope, ownerMembership._id, { role: 'admin', updatedAt: now });
    await memberships.updateById(scope, targetMembership._id, { role: 'owner', updatedAt: now });
    await workspaces.updateInScope(scope, { ownerUserId: targetUserId, updatedAt: now });

    await audit.record(scope, {
      type: 'workspace.ownership_transferred',
      actorUserId: currentOwner._id,
      correlationId,
      metadata: {
        fromUserId: currentOwner._id.toHexString(),
        toUserId: targetUserId.toHexString(),
      },
    });

    return { kind: 'transferred' };
  }

  /** Owner-only soft delete, recoverable for 30 days (blueprint 9.5). */
  async softDelete(
    scope: WorkspaceScope,
    actor: WithIdUser,
    correlationId: string,
  ): Promise<DeleteOutcome> {
    const { workspaces, audit, clock } = this.#deps;
    const now = clock.now();

    const workspace = await workspaces.findInScope(scope);
    if (workspace === null || workspace.status !== 'active') return { kind: 'not_found' };

    await workspaces.updateInScope(scope, {
      status: 'deleted',
      deletedAt: now,
      purgeAfter: purgeDeadline(now),
      updatedAt: now,
    });

    await audit.record(scope, {
      type: 'workspace.deleted',
      actorUserId: actor._id,
      correlationId,
      metadata: { purgeAfter: purgeDeadline(now).toISOString() },
    });

    return { kind: 'deleted' };
  }

  async recover(
    scope: WorkspaceScope,
    actor: WithIdUser,
    correlationId: string,
  ): Promise<RecoverOutcome> {
    const { workspaces, audit, clock } = this.#deps;
    const now = clock.now();

    const workspace = await workspaces.findInScope(scope);
    if (workspace === null || workspace.status !== 'deleted') return { kind: 'not_found' };

    // Past the window the workspace is awaiting purge and is no longer the
    // user's to restore.
    if (workspace.purgeAfter !== null && now.getTime() >= workspace.purgeAfter.getTime()) {
      return { kind: 'window_expired' };
    }

    await workspaces.restore(workspace._id, now);
    await audit.record(scope, {
      type: 'workspace.recovered',
      actorUserId: actor._id,
      correlationId,
      metadata: {},
    });

    return { kind: 'recovered' };
  }

  /**
   * Usage meters (blueprint 4.10).
   *
   * Users and active widgets are real counts. Submissions and interaction
   * events still report null rather than zero, because "none have happened
   * yet" and "this is not counted yet" are different claims and a zero would
   * quietly assert the first. Stage 5a made the widget meter real; Stages 7
   * and 10 do the same for the other two.
   */
  /**
   * Change the consent and retention settings (blueprint 4.8, 9.5).
   *
   * Audited like every other settings change, and audited with BOTH the old and
   * the new retention value. That detail matters more here than elsewhere:
   * shortening retention is the one setting in this product that schedules the
   * destruction of data already collected, and an audit line saying only what it
   * became would leave nobody able to answer "how long did we used to keep
   * things" after the fact.
   *
   * Nothing is destroyed by this call. The new setting takes effect on the next
   * retention sweep, which is what keeps the decision reversible for as long as
   * the sweep has not run.
   */
  async updatePrivacySettings(
    scope: WorkspaceScope,
    settings: { readonly retentionDays: number; readonly optInMode: OptInMode },
    actorUserId: ObjectId,
    correlationId: string,
  ): Promise<{ retentionDays: number; optInMode: OptInMode } | null> {
    const { workspaces, audit, clock } = this.#deps;

    const workspace = await workspaces.findInScope(scope);
    if (workspace === null || workspace.status !== 'active') return null;

    const now = clock.now();
    const updated = await workspaces.updateInScope(scope, {
      retentionDays: settings.retentionDays,
      optInMode: settings.optInMode,
      updatedAt: now,
    });
    if (!updated) return null;

    await audit.record(scope, {
      type: 'workspace.privacy_settings_changed',
      actorUserId,
      correlationId,
      metadata: {
        retentionDaysFrom: workspace.retentionDays,
        retentionDaysTo: settings.retentionDays,
        optInModeFrom: workspace.optInMode,
        optInModeTo: settings.optInMode,
      },
    });

    return { retentionDays: settings.retentionDays, optInMode: settings.optInMode };
  }

  /**
   * The four usage meters (blueprint 4.10).
   *
   * The two monthly meters were `null` - "not measured yet" - until the data
   * they count existed. Stage 10a fills them in, and the boundary they count
   * from is the WORKSPACE's month, not UTC and not the server's: 4.10 says
   * "Monthly boundaries use the workspace timezone", so a workspace in Auckland
   * resets roughly half a day before one in UTC would.
   *
   * `monthStartInZone` is the same function the submission and interaction
   * quotas enforce with, so what the meter shows and what the gate refuses can
   * never disagree about when the month turned.
   */
  async usage(scope: WorkspaceScope): Promise<WorkspaceUsage> {
    const workspace = await this.#deps.workspaces.findInScope(scope);
    const timezone = workspace?.timezone ?? 'UTC';
    const monthStart = monthStartInZone(this.#deps.clock.now(), timezone);

    const [users, activeWidgets, submissions, interactions] = await Promise.all([
      this.#deps.memberships.count(scope),
      this.#deps.widgets.countActive(scope),
      this.#deps.submissionEvents.countSince(scope, monthStart),
      this.#deps.interactionEvents.countSince(scope, monthStart),
    ]);

    return {
      users: { used: users, limit: WORKSPACE_LIMITS.users },
      activeWidgets: { used: activeWidgets, limit: WORKSPACE_LIMITS.activeWidgets },
      submissionsThisMonth: { used: submissions, limit: WORKSPACE_LIMITS.submissionsPerMonth },
      interactionEventsThisMonth: {
        used: interactions,
        limit: WORKSPACE_LIMITS.interactionEventsPerMonth,
      },
    };
  }

  /**
   * Whether this user may delete their account yet (blueprint 4.1).
   *
   * An owner must transfer or resolve their workspace first, so a workspace can
   * never be orphaned by an account deletion.
   */
  async accountDeletionBlockers(
    userId: ObjectId,
  ): Promise<{ readonly blocked: boolean; readonly ownedWorkspaceId: string | null }> {
    const owned = await this.#deps.workspaces.findOwnedBy(userId);
    return {
      blocked: owned !== null,
      ownedWorkspaceId: owned?._id.toHexString() ?? null,
    };
  }
}

/** Mongo signals a unique-index violation with code 11000. */
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}
