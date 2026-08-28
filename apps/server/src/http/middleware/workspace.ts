import type { NextFunction, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { workspaceScope, type WorkspaceScope } from '@lcp/database';
import { ERROR_CODES, type Capability, type WorkspaceRoleName } from '@lcp/contracts';
import { ApiError } from './error-handler.js';
import { blockedOnlyByVerification, can } from '../../domain/workspace/capabilities.js';
import type { MembershipService } from '../../application/workspace/membership-service.js';
import type { WorkspaceService } from '../../application/workspace/workspace-service.js';

/**
 * Workspace context and RBAC guards (blueprint 9.1, 10.3, 11).
 *
 * The scope is derived from the SESSION, never from the request. There is no
 * code path here that reads a workspace id out of a body, a query string, or a
 * URL parameter, which is what makes the tenancy invariant hold at the HTTP
 * edge as well as in the repositories.
 */
declare module 'express-serve-static-core' {
  interface Request {
    workspaceScope?: WorkspaceScope;
    workspaceRole?: WorkspaceRoleName;
  }
}

/**
 * Resolve the active workspace and the caller's role in it.
 *
 * Membership is re-checked on EVERY request rather than trusted from the
 * session. A session may have been switched into a workspace the user has since
 * been removed from, and revocation has to take effect immediately, not at the
 * next switch.
 */
export function requireWorkspaceContext(
  memberships: MembershipService,
  workspaces: WorkspaceService,
) {
  return async (request: Request, _response: Response, next: NextFunction): Promise<void> => {
    try {
      const session = request.session;
      const user = request.currentUser;
      if (session === undefined || user === undefined) {
        next(new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required'));
        return;
      }

      const activeWorkspaceId = session.activeWorkspaceId;
      if (activeWorkspaceId === null || !ObjectId.isValid(activeWorkspaceId)) {
        next(
          new ApiError(ERROR_CODES.NOT_FOUND, 'Select a workspace before performing this action'),
        );
        return;
      }

      const scope = workspaceScope(new ObjectId(activeWorkspaceId));

      // A soft-deleted workspace is unusable without being purged.
      const workspace = await workspaces.findActive(scope);
      if (workspace === null) {
        next(new ApiError(ERROR_CODES.NOT_FOUND, 'This workspace is not available'));
        return;
      }

      const role = await memberships.roleOf(scope, user._id);
      if (role === null) {
        // Same answer as a workspace that does not exist, so a non-member
        // cannot use this to discover which workspaces are real.
        next(new ApiError(ERROR_CODES.NOT_FOUND, 'This workspace is not available'));
        return;
      }

      request.workspaceScope = scope;
      request.workspaceRole = role;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Enforce one capability from the section 11 matrix.
 *
 * A refusal distinguishes "your role may never do this" from "confirm your
 * email first", because those are different problems with different fixes.
 */
export function requireCapability(capability: Capability) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const role = request.workspaceRole;
    const user = request.currentUser;

    if (role === undefined || user === undefined) {
      next(new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required'));
      return;
    }

    const subject = { role, emailVerified: user.emailVerifiedAt !== null };

    if (can(subject, capability)) {
      next();
      return;
    }

    if (blockedOnlyByVerification(subject, capability)) {
      next(
        new ApiError(
          ERROR_CODES.EMAIL_NOT_VERIFIED,
          'Confirm your email address before performing this action',
        ),
      );
      return;
    }

    next(new ApiError(ERROR_CODES.FORBIDDEN, 'Your role does not allow this action'));
  };
}
