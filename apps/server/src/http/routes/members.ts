import { Router } from 'express';
import { ObjectId } from 'mongodb';
import {
  ERROR_CODES,
  acceptInvitationSchema,
  changeRoleSchema,
  inviteMemberSchema,
  validate,
  type Logger,
} from '@lcp/contracts';
import type { MembershipService } from '../../application/workspace/membership-service.js';
import type { InvitationService } from '../../application/workspace/invitation-service.js';
import type { WorkspaceService } from '../../application/workspace/workspace-service.js';
import type { SessionService } from '../../application/auth/session-service.js';
import type { RateLimiter } from '../../ports/rate-limiter.js';
import { AUTH_RATE_RULES } from '../../infrastructure/redis/rate-limiter.js';
import { ApiError } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/session.js';
import { requireCapability, requireWorkspaceContext } from '../middleware/workspace.js';
import { throttle } from '../middleware/throttle.js';

/**
 * Members and invitations (blueprint 4.1 and 11).
 *
 * `member.manage` carries the verified-email requirement in the policy table,
 * so attaching `requireCapability('member.manage')` is what finally gives
 * Stage 3a's `requireVerifiedEmail` semantics something real to gate: an
 * unverified Owner or Admin is refused with `email_not_verified`, not a bare
 * forbidden.
 */

/**
 * Express 5 types a route parameter as `string | string[]`, because a pattern
 * can capture repeats. These routes never do, so the first value is taken and
 * anything else is treated as absent rather than coerced.
 */
function pathParam(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? '';
  return '';
}

export interface MembersRouterDeps {
  readonly memberships: MembershipService;
  readonly invitations: InvitationService;
  readonly workspaces: WorkspaceService;
  readonly sessions: SessionService;
  readonly limiter: RateLimiter;
  readonly logger: Logger;
}

export function createMembersRouter(deps: MembersRouterDeps): Router {
  const router = Router();
  const { memberships, workspaces, sessions } = deps;

  router.use(requireAuth());
  const withWorkspace = requireWorkspaceContext(memberships, workspaces);

  // ---------------------------------------------------------------- members

  router.get(
    '/',
    withWorkspace,
    requireCapability('workspace.view'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        const user = request.currentUser;
        const role = request.workspaceRole;
        if (scope === undefined || user === undefined || role === undefined) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        }
        response.status(200).json({ members: await memberships.list(scope, user, role) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    '/:userId/role',
    withWorkspace,
    // The coarse gate. `changeRole` then applies the finer asymmetry, because
    // whether this needs `member.manage` or `admin.manage` depends on the roles
    // involved and cannot be known from the path alone.
    requireCapability('member.manage'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        const role = request.workspaceRole;
        const user = request.currentUser;
        if (scope === undefined || role === undefined || user === undefined) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        }

        const rawUserId = pathParam(request.params.userId);
        if (!ObjectId.isValid(rawUserId)) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'That person is not in this workspace');
        }

        const parsed = validate(changeRoleSchema, request.body);
        if (!parsed.ok) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_FAILED,
            'Check the submitted fields',
            parsed.errors,
          );
        }

        const outcome = await memberships.changeRole(
          scope,
          user,
          role,
          new ObjectId(rawUserId),
          parsed.data.role,
          request.correlationId,
        );

        if (outcome.kind === 'not_found') {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'That person is not in this workspace');
        }
        if (outcome.kind === 'forbidden') {
          throw new ApiError(ERROR_CODES.FORBIDDEN, 'Your role does not allow this change');
        }

        response.status(200).json({ status: 'changed' });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/:userId',
    withWorkspace,
    requireCapability('member.manage'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        const role = request.workspaceRole;
        const user = request.currentUser;
        if (scope === undefined || role === undefined || user === undefined) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        }

        const rawUserId = pathParam(request.params.userId);
        if (!ObjectId.isValid(rawUserId)) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'That person is not in this workspace');
        }

        const outcome = await memberships.remove(
          scope,
          user,
          role,
          new ObjectId(rawUserId),
          request.correlationId,
        );

        if (outcome.kind === 'not_found') {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'That person is not in this workspace');
        }
        if (outcome.kind === 'forbidden') {
          throw new ApiError(
            ERROR_CODES.FORBIDDEN,
            'Your role does not allow removing this person',
          );
        }

        // Revocation is immediate: any session of theirs pointed at this
        // workspace stops being able to act in it.
        await sessions.clearWorkspaceEverywhere(
          outcome.removedUserId.toHexString(),
          scope.workspaceId.toHexString(),
        );

        response.status(204).send();
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

/** The invitation routes need exactly the same collaborators. */
export type InvitationsRouterDeps = MembersRouterDeps;

export function createInvitationsRouter(deps: InvitationsRouterDeps): Router {
  const router = Router();
  const { memberships, invitations, workspaces, sessions, limiter, logger } = deps;

  router.use(requireAuth());
  const withWorkspace = requireWorkspaceContext(memberships, workspaces);

  router.get(
    '/',
    withWorkspace,
    requireCapability('member.manage'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        if (scope === undefined) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        response.status(200).json({ invitations: await invitations.listPending(scope) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/',
    withWorkspace,
    requireCapability('member.manage'),
    throttle(limiter, AUTH_RATE_RULES.invitationAcceptance, logger),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        const role = request.workspaceRole;
        const user = request.currentUser;
        if (scope === undefined || role === undefined || user === undefined) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        }

        const parsed = validate(inviteMemberSchema, request.body);
        if (!parsed.ok) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_FAILED,
            'Check the submitted fields',
            parsed.errors,
          );
        }

        // Inviting an Admin is assigning Admin status, which section 11 gives
        // to the Owner alone. The coarse gate above only proves `member.manage`.
        if (parsed.data.role === 'admin' && role !== 'owner') {
          throw new ApiError(
            ERROR_CODES.FORBIDDEN,
            'Only the Owner can invite someone as an Admin',
          );
        }

        const outcome = await invitations.send(
          scope,
          user,
          parsed.data.email,
          parsed.data.role,
          request.correlationId,
        );

        switch (outcome.kind) {
          case 'sent':
            response.status(202).json({ status: 'sent' });
            return;
          case 'already_a_member':
            throw new ApiError(ERROR_CODES.CONFLICT, 'That person is already in this workspace');
          case 'already_invited':
            throw new ApiError(
              ERROR_CODES.CONFLICT,
              'That person already has a pending invitation',
            );
          case 'user_limit_reached':
            throw new ApiError(
              ERROR_CODES.QUOTA_EXCEEDED,
              'This workspace has reached its 10-user limit',
            );
        }
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/:invitationId',
    withWorkspace,
    requireCapability('member.manage'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        const user = request.currentUser;
        if (scope === undefined || user === undefined) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        }

        const raw = pathParam(request.params.invitationId);
        if (!ObjectId.isValid(raw)) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Invitation not found');
        }

        const outcome = await invitations.revoke(
          scope,
          user,
          new ObjectId(raw),
          request.correlationId,
        );
        if (outcome.kind === 'not_found') {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Invitation not found');
        }

        response.status(204).send();
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Redeem an invitation.
   *
   * Deliberately NOT behind `requireWorkspaceContext`: the recipient has no
   * workspace selected, and may not be a member of anything yet. The token
   * itself resolves to exactly one workspace.
   *
   * It IS behind `requireAuth`, because a membership is only ever created for a
   * signed-in, verified identity.
   */
  router.post(
    '/accept',
    throttle(limiter, AUTH_RATE_RULES.invitationAcceptance, logger),
    async (request, response, next) => {
      try {
        const user = request.currentUser;
        const session = request.session;
        if (user === undefined || session === undefined) {
          throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Sign in to accept this invitation');
        }

        const parsed = validate(acceptInvitationSchema, request.body);
        if (!parsed.ok) {
          throw new ApiError(ERROR_CODES.INVALID_TOKEN, 'This invitation link is not valid');
        }

        const outcome = await invitations.accept(parsed.data.token, user, request.correlationId);

        switch (outcome.kind) {
          case 'joined': {
            // Land them in the workspace they just joined.
            await sessions.selectWorkspace(session.id, outcome.workspaceId.toHexString());
            response
              .status(200)
              .json({ status: 'joined', workspaceId: outcome.workspaceId.toHexString() });
            return;
          }
          case 'already_a_member':
            await sessions.selectWorkspace(session.id, outcome.workspaceId.toHexString());
            response
              .status(200)
              .json({ status: 'joined', workspaceId: outcome.workspaceId.toHexString() });
            return;
          case 'verification_required':
            throw new ApiError(
              ERROR_CODES.EMAIL_NOT_VERIFIED,
              'Confirm your email address before joining a workspace',
            );
          case 'registration_required':
            throw new ApiError(
              ERROR_CODES.UNAUTHENTICATED,
              'Create an account with the invited address first',
            );
          case 'workspace_unavailable':
            throw new ApiError(ERROR_CODES.NOT_FOUND, 'That workspace is no longer available');
          case 'user_limit_reached':
            throw new ApiError(
              ERROR_CODES.QUOTA_EXCEEDED,
              'That workspace has reached its 10-user limit',
            );
          case 'invalid_token':
            throw new ApiError(
              ERROR_CODES.INVALID_TOKEN,
              'This invitation is invalid, expired, or already used',
            );
        }
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
