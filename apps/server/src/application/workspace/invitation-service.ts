import type { ObjectId } from 'mongodb';
import { workspaceScope, type WorkspaceScope } from '@lcp/database';
import {
  WORKSPACE_LIMITS,
  type InvitableRole,
  type InvitationSummary,
  type Logger,
} from '@lcp/contracts';
import type {
  InvitationRepositoryPort,
  MembershipRepositoryPort,
  UserLookupPort,
  WithIdInvitation,
  WithIdUser,
  WorkspaceAuditPort,
  WorkspaceRepositoryPort,
} from './types.js';
import type { Clock } from '../../ports/clock.js';
import type { EmailSender } from '../../ports/email-sender.js';
import { expiryFromNow, generateToken, hashToken, isExpired } from '../../domain/auth/tokens.js';
import { invitationEmail } from '../../infrastructure/email/templates.js';

/**
 * Invitations (blueprint 4.1).
 *
 * Tokens follow the pattern already established for email verification and
 * password reset in Stage 3a: 256 bits of randomness, only the SHA-256 hash
 * persisted, single use, and a fixed expiry - seven days here, per 4.1.
 */

/** Blueprint 4.1: an invitation expires after 7 days. */
export const INVITATION_TTL_HOURS = 7 * 24;

export type SendOutcome =
  | { readonly kind: 'sent'; readonly invitation: WithIdInvitation }
  | { readonly kind: 'already_a_member' }
  | { readonly kind: 'already_invited' }
  | { readonly kind: 'user_limit_reached' };

export type AcceptOutcome =
  | { readonly kind: 'joined'; readonly workspaceId: ObjectId; readonly role: InvitableRole }
  | { readonly kind: 'invalid_token' }
  | { readonly kind: 'registration_required'; readonly email: string }
  | { readonly kind: 'verification_required'; readonly email: string }
  | { readonly kind: 'already_a_member'; readonly workspaceId: ObjectId }
  | { readonly kind: 'workspace_unavailable' }
  | { readonly kind: 'user_limit_reached' };

export type RevokeOutcome = { readonly kind: 'revoked' } | { readonly kind: 'not_found' };

export interface InvitationServiceDeps {
  readonly invitations: InvitationRepositoryPort;
  readonly memberships: MembershipRepositoryPort;
  readonly workspaces: WorkspaceRepositoryPort;
  readonly users: UserLookupPort;
  readonly audit: WorkspaceAuditPort;
  readonly email: EmailSender;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly appBaseUrl: string;
  /**
   * Unscoped lookup by token hash.
   *
   * Acceptance is the one flow where the caller has no workspace context: they
   * hold only a link. The token IS the authorization, and the hash is globally
   * unique, so it resolves to exactly one invitation and therefore exactly one
   * workspace. This is the same shape as blueprint 9.1's "public widget
   * identifiers resolve to one workspace on the server", and it is the reason
   * this is a separate, narrowly-typed port rather than a general escape hatch
   * on the scoped repository.
   */
  readonly redeemByTokenHash: (tokenHash: string) => Promise<WithIdInvitation | null>;
}

export class InvitationService {
  readonly #deps: InvitationServiceDeps;

  constructor(deps: InvitationServiceDeps) {
    this.#deps = deps;
  }

  async listPending(scope: WorkspaceScope): Promise<readonly InvitationSummary[]> {
    const records = await this.#deps.invitations.listPending(scope);
    const now = this.#deps.clock.now();

    return (
      records
        // An expired-but-unswept invitation is not pending in any useful sense.
        .filter((invitation) => !isExpired(invitation.expiresAt, now))
        .map((invitation) => ({
          id: invitation._id.toHexString(),
          email: invitation.email,
          role: invitation.role,
          invitedAt: invitation.createdAt.toISOString(),
          expiresAt: invitation.expiresAt.toISOString(),
        }))
    );
  }

  /**
   * Send an invitation.
   *
   * The caller has already been checked for the `member.manage` capability,
   * which itself requires a verified email, so this method assumes authority
   * and enforces only the workspace-level rules.
   */
  async send(
    scope: WorkspaceScope,
    inviter: WithIdUser,
    email: string,
    role: InvitableRole,
    correlationId: string,
  ): Promise<SendOutcome> {
    const { invitations, memberships, workspaces, users, audit, clock } = this.#deps;
    const now = clock.now();
    const normalized = email.trim().toLowerCase();

    // Blueprint 4.10: at most 10 users per workspace. Pending invitations count
    // toward it, or ten simultaneous invites could overshoot the cap.
    const currentMembers = await memberships.count(scope);
    const pending = (await invitations.listPending(scope)).filter(
      (invitation) => !isExpired(invitation.expiresAt, now),
    );
    if (currentMembers + pending.length >= WORKSPACE_LIMITS.users) {
      return { kind: 'user_limit_reached' };
    }

    const existingUser = await users.findByEmail(normalized);
    if (existingUser !== null) {
      const membership = await memberships.findByUser(scope, existingUser._id);
      if (membership !== null) return { kind: 'already_a_member' };
    }

    if (pending.some((invitation) => invitation.normalizedEmail === normalized)) {
      return { kind: 'already_invited' };
    }

    const token = generateToken();
    const invitation = await invitations.insert(scope, {
      email: email.trim(),
      normalizedEmail: normalized,
      role,
      invitedByUserId: inviter._id,
      tokenHash: hashToken(token),
      status: 'pending',
      expiresAt: expiryFromNow(now, INVITATION_TTL_HOURS),
      acceptedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const workspace = await workspaces.findInScope(scope);
    const url = `${this.#deps.appBaseUrl}/invitations/accept?token=${encodeURIComponent(token)}`;

    // Reuses the Stage 3a sender, so invitations draw on the same Brevo daily
    // budget as auth mail rather than opening an unbounded second path.
    await this.#deps.email.send(
      invitationEmail(invitation.email, workspace?.name ?? 'a workspace', inviter.email, url),
    );

    await audit.record(scope, {
      type: 'invitation.sent',
      actorUserId: inviter._id,
      correlationId,
      // The recipient address is workspace-visible information, unlike a token.
      metadata: { email: invitation.email, role },
    });

    return { kind: 'sent', invitation };
  }

  /**
   * Redeem an invitation token.
   *
   * `acceptingUser` is null when nobody is signed in. The flow deliberately
   * never creates a membership for an unverified identity: an unknown recipient
   * is told to register, and a known but unverified one is told to confirm
   * their address. The invitation waits for them either way.
   */
  async accept(
    token: string,
    acceptingUser: WithIdUser | null,
    correlationId: string,
  ): Promise<AcceptOutcome> {
    const { memberships, workspaces, users, audit, invitations, clock } = this.#deps;
    const now = clock.now();

    const invitation = await this.#deps.redeemByTokenHash(hashToken(token));
    if (invitation === null || invitation.status !== 'pending') return { kind: 'invalid_token' };
    if (isExpired(invitation.expiresAt, now)) return { kind: 'invalid_token' };

    const scope = workspaceScope(invitation.workspaceId);

    const workspace = await workspaces.findInScope(scope);
    if (workspace === null || workspace.status !== 'active') {
      return { kind: 'workspace_unavailable' };
    }

    // Who is redeeming? The signed-in user if there is one, otherwise whoever
    // already holds the invited address.
    const recipient = acceptingUser ?? (await users.findByEmail(invitation.normalizedEmail));

    if (recipient === null) return { kind: 'registration_required', email: invitation.email };
    if (recipient.emailVerifiedAt === null) {
      return { kind: 'verification_required', email: invitation.email };
    }

    // A signed-in user may only redeem an invitation addressed to them, or an
    // intercepted link would let anyone join with someone else's invite.
    if (recipient.normalizedEmail !== invitation.normalizedEmail) {
      return { kind: 'invalid_token' };
    }

    const existing = await memberships.findByUser(scope, recipient._id);
    if (existing !== null) {
      // Consume the invitation anyway, so the link cannot be replayed.
      await invitations.updateById(scope, invitation._id, {
        status: 'accepted',
        acceptedAt: now,
        updatedAt: now,
      });
      return { kind: 'already_a_member', workspaceId: invitation.workspaceId };
    }

    if ((await memberships.count(scope)) >= WORKSPACE_LIMITS.users) {
      return { kind: 'user_limit_reached' };
    }

    // Consume the token FIRST, filtered on its still being pending, so two
    // concurrent redemptions cannot both create a membership.
    const consumed = await invitations.updateById(scope, invitation._id, {
      status: 'accepted',
      acceptedAt: now,
      updatedAt: now,
    });
    if (!consumed) return { kind: 'invalid_token' };

    const role = invitation.role === 'owner' ? 'member' : invitation.role;
    await memberships.insert(scope, {
      userId: recipient._id,
      role,
      createdAt: now,
      updatedAt: now,
    });

    await audit.record(scope, {
      type: 'invitation.accepted',
      actorUserId: recipient._id,
      correlationId,
      metadata: { email: invitation.email, role },
    });

    return { kind: 'joined', workspaceId: invitation.workspaceId, role: role as InvitableRole };
  }

  /**
   * Join a freshly verified account to every invitation waiting for it.
   *
   * Called after email verification, so someone invited before they had an
   * account lands in the right workspaces without hunting for the original
   * link. Each invitation is still consumed exactly once.
   */
  async acceptAllPendingFor(user: WithIdUser, correlationId: string): Promise<number> {
    if (user.emailVerifiedAt === null) return 0;

    const { invitations, memberships, workspaces, audit, clock } = this.#deps;
    const now = clock.now();
    const waiting = await invitations.listPendingForRecipient(user.normalizedEmail);

    let joined = 0;
    for (const invitation of waiting) {
      if (isExpired(invitation.expiresAt, now)) continue;

      const scope = workspaceScope(invitation.workspaceId);
      const workspace = await workspaces.findInScope(scope);
      if (workspace === null || workspace.status !== 'active') continue;
      if ((await memberships.findByUser(scope, user._id)) !== null) continue;
      if ((await memberships.count(scope)) >= WORKSPACE_LIMITS.users) continue;

      const consumed = await invitations.updateById(scope, invitation._id, {
        status: 'accepted',
        acceptedAt: now,
        updatedAt: now,
      });
      if (!consumed) continue;

      const role = invitation.role === 'owner' ? 'member' : invitation.role;
      await memberships.insert(scope, {
        userId: user._id,
        role,
        createdAt: now,
        updatedAt: now,
      });

      await audit.record(scope, {
        type: 'invitation.accepted',
        actorUserId: user._id,
        correlationId,
        metadata: { email: invitation.email, role, viaVerification: true },
      });

      joined += 1;
    }

    return joined;
  }

  async revoke(
    scope: WorkspaceScope,
    actor: WithIdUser,
    invitationId: ObjectId,
    correlationId: string,
  ): Promise<RevokeOutcome> {
    const { invitations, audit, clock } = this.#deps;
    const now = clock.now();

    const invitation = await invitations.findById(scope, invitationId);
    if (invitation === null || invitation.status !== 'pending') return { kind: 'not_found' };

    await invitations.updateById(scope, invitation._id, { status: 'revoked', updatedAt: now });

    await audit.record(scope, {
      type: 'invitation.revoked',
      actorUserId: actor._id,
      correlationId,
      metadata: { email: invitation.email },
    });

    return { kind: 'revoked' };
  }
}
