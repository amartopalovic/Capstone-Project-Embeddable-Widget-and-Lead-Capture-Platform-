import { Router } from 'express';
import { ObjectId } from 'mongodb';
import {
  CAPABILITIES,
  ERROR_CODES,
  onboardWorkspaceSchema,
  switchWorkspaceSchema,
  transferOwnershipSchema,
  validate,
  type AuditEntrySummary,
  type Logger,
  type WorkspaceSummary,
} from '@lcp/contracts';
import { workspaceScope } from '@lcp/database';
import type { WorkspaceService } from '../../application/workspace/workspace-service.js';
import type { MembershipService } from '../../application/workspace/membership-service.js';
import type { SessionService } from '../../application/auth/session-service.js';
import type { WorkspaceAuditPort } from '../../application/workspace/types.js';
import { ApiError } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/session.js';
import { requireCapability, requireWorkspaceContext } from '../middleware/workspace.js';
import { can } from '../../domain/workspace/capabilities.js';

/**
 * Workspace lifecycle and context (blueprint 4.1, 9.5, 10.3, 11).
 *
 * Every route reaches the workspace through session-derived scope. None of them
 * accepts a workspace id in a body or a path segment, apart from `/switch`,
 * which is the one place a user names a workspace - and it verifies membership
 * before writing the selection into the session.
 */

/** Express 5 types a route parameter as `string | string[]`; see members.ts. */
function pathParam(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? '';
  return '';
}

export interface WorkspacesRouterDeps {
  readonly workspaces: WorkspaceService;
  readonly memberships: MembershipService;
  readonly sessions: SessionService;
  readonly audit: WorkspaceAuditPort;
  readonly logger: Logger;
}

export function createWorkspacesRouter(deps: WorkspacesRouterDeps): Router {
  const router = Router();
  const { workspaces, memberships, sessions, audit } = deps;

  router.use(requireAuth());

  const withWorkspace = requireWorkspaceContext(memberships, workspaces);

  // ------------------------------------------------------------ onboarding

  router.post('/', async (request, response, next) => {
    try {
      const user = request.currentUser;
      const session = request.session;
      if (user === undefined || session === undefined) {
        throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required');
      }

      const parsed = validate(onboardWorkspaceSchema, request.body);
      if (!parsed.ok) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          'Check the submitted fields',
          parsed.errors,
        );
      }

      const outcome = await workspaces.onboard(
        user,
        parsed.data.name,
        parsed.data.timezone,
        request.correlationId,
      );

      if (outcome.kind === 'invalid_timezone') {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Check the submitted fields', [
          { path: 'timezone', message: 'This is not a time zone this server recognises' },
        ]);
      }
      if (outcome.kind === 'already_owns_workspace') {
        // Blueprint 4.1: a verified user may own one workspace at a time. The
        // unique index would also stop this, but it must not reach the client
        // as a driver error.
        throw new ApiError(
          ERROR_CODES.CONFLICT,
          'You already own a workspace. Transfer or delete it before creating another.',
        );
      }

      // Creating a workspace selects it, so the next request has context.
      await sessions.selectWorkspace(session.id, outcome.workspace._id.toHexString());

      const summary: WorkspaceSummary = {
        id: outcome.workspace._id.toHexString(),
        name: outcome.workspace.name,
        timezone: outcome.workspace.timezone,
        role: 'owner',
        isActive: true,
      };
      response.status(201).json({ workspace: summary });
    } catch (error) {
      next(error);
    }
  });

  // -------------------------------------------------------------- switcher

  router.get('/', async (request, response, next) => {
    try {
      const user = request.currentUser;
      const session = request.session;
      if (user === undefined || session === undefined) {
        throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required');
      }

      const list = await workspaces.listForUser(user._id, session.activeWorkspaceId);
      response.status(200).json({ workspaces: list, activeWorkspaceId: session.activeWorkspaceId });
    } catch (error) {
      next(error);
    }
  });

  router.post('/switch', async (request, response, next) => {
    try {
      const user = request.currentUser;
      const session = request.session;
      if (user === undefined || session === undefined) {
        throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required');
      }

      const parsed = validate(switchWorkspaceSchema, request.body);
      if (!parsed.ok) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, 'Workspace not found');
      }

      const target = workspaceScope(new ObjectId(parsed.data.workspaceId));

      // Membership is verified BEFORE the selection is written, so switching
      // can never be used to reach a workspace the caller does not belong to.
      const workspace = await workspaces.findActive(target);
      const role = workspace === null ? null : await memberships.roleOf(target, user._id);
      if (workspace === null || role === null) {
        // One answer for "no such workspace" and "not yours", so this cannot
        // enumerate which workspace ids exist.
        throw new ApiError(ERROR_CODES.NOT_FOUND, 'Workspace not found');
      }

      await sessions.selectWorkspace(session.id, parsed.data.workspaceId);

      response.status(200).json({
        workspace: {
          id: parsed.data.workspaceId,
          name: workspace.name,
          timezone: workspace.timezone,
          role,
          isActive: true,
        } satisfies WorkspaceSummary,
      });
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------------- current context

  router.get(
    '/current',
    withWorkspace,
    requireCapability('workspace.view'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        const role = request.workspaceRole;
        if (scope === undefined || role === undefined) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'This workspace is not available');
        }

        const workspace = await workspaces.findActive(scope);
        if (workspace === null) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'This workspace is not available');
        }

        /**
         * The caller's capabilities, computed from the SAME section 11 table
         * the guards use.
         *
         * This is what lets the UI hide a control it may not use without
         * keeping its own copy of the matrix: a second copy in the frontend
         * could drift out of step with the server's, and the drift would be
         * invisible until someone saw a button that always 403s - or worse,
         * did not see one they were entitled to. The list is derived, never
         * hand-maintained.
         */
        const user = request.currentUser;
        const subject = {
          role,
          emailVerified: user !== undefined && user.emailVerifiedAt !== null,
        };
        const capabilities = CAPABILITIES.filter((capability) => can(subject, capability));

        response.status(200).json({
          workspace: {
            id: workspace._id.toHexString(),
            name: workspace.name,
            timezone: workspace.timezone,
            role,
            isActive: true,
          } satisfies WorkspaceSummary,
          capabilities,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/usage',
    withWorkspace,
    requireCapability('workspace.view'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        if (scope === undefined) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        response.status(200).json(await workspaces.usage(scope));
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/audit',
    withWorkspace,
    requireCapability('audit.view'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        if (scope === undefined) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');

        const events = await audit.listRecent(scope, 50);
        const entries: AuditEntrySummary[] = events.map((event) => ({
          id: event._id.toHexString(),
          type: event.type,
          actorUserId: event.actorUserId?.toHexString() ?? null,
          occurredAt: event.occurredAt.toISOString(),
          metadata: event.metadata,
        }));

        response.status(200).json({ events: entries });
      } catch (error) {
        next(error);
      }
    },
  );

  // ------------------------------------------------- ownership and deletion

  router.post(
    '/transfer-ownership',
    withWorkspace,
    requireCapability('workspace.transfer'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        const user = request.currentUser;
        if (scope === undefined || user === undefined) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        }

        const parsed = validate(transferOwnershipSchema, request.body);
        if (!parsed.ok) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_FAILED,
            'Check the submitted fields',
            parsed.errors,
          );
        }

        const outcome = await workspaces.transferOwnership(
          scope,
          user,
          new ObjectId(parsed.data.toUserId),
          request.correlationId,
        );

        switch (outcome.kind) {
          case 'transferred':
            response.status(200).json({ status: 'transferred' });
            return;
          case 'not_a_member':
            throw new ApiError(ERROR_CODES.NOT_FOUND, 'That person is not in this workspace');
          case 'not_an_admin':
            throw new ApiError(
              ERROR_CODES.CONFLICT,
              'Ownership can only transfer to an Admin. Promote them first.',
            );
          case 'not_verified':
            throw new ApiError(
              ERROR_CODES.CONFLICT,
              'That person must confirm their email address before becoming Owner.',
            );
          case 'target_already_owns_workspace':
            throw new ApiError(ERROR_CODES.CONFLICT, 'That person already owns another workspace.');
        }
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/current',
    withWorkspace,
    requireCapability('workspace.delete'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        const user = request.currentUser;
        if (scope === undefined || user === undefined) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        }

        const outcome = await workspaces.softDelete(scope, user, request.correlationId);
        if (outcome.kind === 'not_found') {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'This workspace is not available');
        }

        // Nobody keeps operating in a workspace that has just been deleted.
        await sessions.clearWorkspaceEverywhere(
          user._id.toHexString(),
          scope.workspaceId.toHexString(),
        );

        response.status(200).json({ status: 'deleted' });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Soft-deleted workspaces the caller owns and can still restore.
   *
   * Registered BEFORE `/:workspaceId/recover` only for readability; the paths
   * cannot collide, since `recoverable` is a single segment and that route
   * needs two. Like the recover route it sits outside `requireWorkspaceContext`,
   * because a deleted workspace can never be the active one.
   */
  router.get('/recoverable', async (request, response, next) => {
    try {
      const user = request.currentUser;
      if (user === undefined) {
        throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required');
      }
      response.status(200).json({ workspaces: await workspaces.listRecoverable(user._id) });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Recover a soft-deleted workspace.
   *
   * This one takes the id in the path rather than from session context, because
   * a deleted workspace cannot be the ACTIVE workspace - `requireWorkspaceContext`
   * refuses it, by design. Ownership is therefore checked directly here instead
   * of through the usual middleware.
   */
  router.post('/:workspaceId/recover', async (request, response, next) => {
    try {
      const user = request.currentUser;
      if (user === undefined) {
        throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required');
      }

      const raw = pathParam(request.params.workspaceId);
      if (!ObjectId.isValid(raw)) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, 'Workspace not found');
      }

      const scope = workspaceScope(new ObjectId(raw));
      const role = await memberships.roleOf(scope, user._id);

      // Only the Owner recovers, per section 11, and a non-member gets the
      // same not-found answer as a nonexistent workspace.
      if (role !== 'owner') {
        throw new ApiError(ERROR_CODES.NOT_FOUND, 'Workspace not found');
      }

      const outcome = await workspaces.recover(scope, user, request.correlationId);
      if (outcome.kind === 'not_found') {
        throw new ApiError(ERROR_CODES.NOT_FOUND, 'Workspace not found');
      }
      if (outcome.kind === 'window_expired') {
        throw new ApiError(
          ERROR_CODES.CONFLICT,
          'The 30-day recovery window for this workspace has passed.',
        );
      }

      response.status(200).json({ status: 'recovered' });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Whether this account can be deleted yet (blueprint 4.1).
   *
   * Full self-service account deletion is a later stage; the PRECONDITION lives
   * here because it is defined entirely by workspace ownership, which this
   * stage owns.
   */
  router.get('/account-deletion-eligibility', async (request, response, next) => {
    try {
      const user = request.currentUser;
      if (user === undefined) {
        throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required');
      }

      const blockers = await workspaces.accountDeletionBlockers(user._id);
      response.status(200).json({
        canDelete: !blockers.blocked,
        reason: blockers.blocked
          ? 'Transfer or delete the workspace you own before deleting your account.'
          : null,
        ownedWorkspaceId: blockers.ownedWorkspaceId,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
