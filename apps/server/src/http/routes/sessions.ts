import { Router } from 'express';
import { ERROR_CODES, type Logger } from '@lcp/contracts';
import type { SessionService } from '../../application/auth/session-service.js';
import { ApiError } from '../middleware/error-handler.js';
import {
  requireAuth,
  sessionCookieOptions,
  type SessionCookieOptions,
} from '../middleware/session.js';

/**
 * Session and device management (blueprint section 4.2: device/session list
 * with individual or global revocation).
 *
 * API only in Stage 3a; the UI that consumes it is Stage 3b.
 *
 * A user may only ever see and revoke their OWN sessions. The service checks
 * ownership and returns the same negative answer whether a session belongs to
 * someone else or does not exist, so this cannot be used to probe for valid
 * session identifiers.
 */

export interface SessionsRouterDeps {
  readonly sessions: SessionService;
  readonly logger: Logger;
  readonly cookie: SessionCookieOptions;
}

export function createSessionsRouter(deps: SessionsRouterDeps): Router {
  const router = Router();
  const { sessions, cookie } = deps;

  router.use(requireAuth());

  router.get('/', async (request, response, next) => {
    try {
      const user = request.currentUser;
      const current = request.session;
      if (user === undefined || current === undefined) {
        throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required');
      }

      const list = await sessions.list(user._id.toHexString(), current.id);
      response.status(200).json({ sessions: list });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:sessionId', async (request, response, next) => {
    try {
      const user = request.currentUser;
      const current = request.session;
      if (user === undefined || current === undefined) {
        throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required');
      }

      const targetId = request.params.sessionId ?? '';
      const revoked = await sessions.revoke(
        user._id.toHexString(),
        targetId,
        user._id,
        request.correlationId,
      );

      if (!revoked) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, 'Session not found');
      }

      // Revoking the session making the request is a logout.
      if (targetId === current.id) {
        response.clearCookie(cookie.name, sessionCookieOptions(cookie));
      }

      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  /**
   * Revoke every other session, keeping the caller signed in.
   *
   * `?includeCurrent=true` signs out everywhere including here, which is the
   * control a user wants after suspecting a compromise.
   */
  router.post('/revoke-all', async (request, response, next) => {
    try {
      const user = request.currentUser;
      const current = request.session;
      if (user === undefined || current === undefined) {
        throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required');
      }

      const includeCurrent = request.query['includeCurrent'] === 'true';
      const revoked = await sessions.revokeAll(
        user._id.toHexString(),
        user._id,
        request.correlationId,
        includeCurrent ? undefined : current.id,
      );

      if (includeCurrent) {
        response.clearCookie(cookie.name, sessionCookieOptions(cookie));
      }

      response.status(200).json({ revoked });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
