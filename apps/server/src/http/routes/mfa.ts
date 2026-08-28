import { Router } from 'express';
import {
  ERROR_CODES,
  mfaConfirmSchema,
  mfaDisableSchema,
  validate,
  type Logger,
} from '@lcp/contracts';
import type { MfaService } from '../../application/auth/mfa-service.js';
import type { SessionService } from '../../application/auth/session-service.js';
import type { RateLimiter } from '../../ports/rate-limiter.js';
import { AUTH_RATE_RULES } from '../../infrastructure/redis/rate-limiter.js';
import { ApiError } from '../middleware/error-handler.js';
import {
  requireAuth,
  sessionCookieOptions,
  type SessionCookieOptions,
} from '../middleware/session.js';
import { throttle } from '../middleware/throttle.js';

/**
 * MFA management for a signed-in user (blueprint 4.2).
 *
 * Every route here requires an existing session and, being state-changing,
 * a CSRF token. The login-time challenge is NOT here - it lives in the auth
 * router, because at that point there is no session yet.
 */

export interface MfaRouterDeps {
  readonly mfa: MfaService;
  readonly sessions: SessionService;
  readonly limiter: RateLimiter;
  readonly logger: Logger;
  readonly cookie: SessionCookieOptions;
}

export function createMfaRouter(deps: MfaRouterDeps): Router {
  const router = Router();
  const { mfa, sessions, limiter, logger, cookie } = deps;

  router.use(requireAuth());

  router.get('/', (request, response) => {
    const user = request.currentUser;
    if (user === undefined) {
      response.status(401).end();
      return;
    }
    response.status(200).json(mfa.status(user));
  });

  router.post('/enroll', async (request, response, next) => {
    try {
      const user = request.currentUser;
      if (user === undefined) {
        throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required');
      }

      const outcome = await mfa.beginEnrollment(user, request.correlationId);
      if (outcome.kind === 'already_enabled') {
        throw new ApiError(
          ERROR_CODES.CONFLICT,
          'Two-step verification is already on. Turn it off before setting it up again.',
        );
      }

      response.status(200).json(outcome.enrollment);
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/confirm',
    throttle(limiter, AUTH_RATE_RULES.mfaChallenge, logger),
    async (request, response, next) => {
      try {
        const user = request.currentUser;
        const session = request.session;
        if (user === undefined || session === undefined) {
          throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required');
        }

        const parsed = validate(mfaConfirmSchema, request.body);
        if (!parsed.ok) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_FAILED,
            'Check the submitted fields',
            parsed.errors,
          );
        }

        const outcome = await mfa.confirmEnrollment(
          user,
          parsed.data.totpCode,
          request.correlationId,
        );

        if (outcome.kind === 'no_pending_enrollment') {
          throw new ApiError(ERROR_CODES.CONFLICT, 'Start two-step verification setup first.');
        }
        if (outcome.kind === 'invalid_code') {
          throw new ApiError(
            ERROR_CODES.MFA_INVALID,
            'That code did not match. Try the current one.',
          );
        }

        // Section 10.3: rotate the session identifier after an MFA change.
        const rotated = await sessions.rotate(session);
        response.cookie(cookie.name, rotated.id, sessionCookieOptions(cookie));

        // The only time these are ever returned.
        response.status(200).json({ recoveryCodes: outcome.recoveryCodes });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/disable',
    throttle(limiter, AUTH_RATE_RULES.mfaChallenge, logger),
    async (request, response, next) => {
      try {
        const user = request.currentUser;
        const session = request.session;
        if (user === undefined || session === undefined) {
          throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required');
        }

        const parsed = validate(mfaDisableSchema, request.body);
        if (!parsed.ok) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_FAILED,
            'Check the submitted fields',
            parsed.errors,
          );
        }

        const outcome = await mfa.disable(
          user,
          parsed.data.password,
          parsed.data.totpCode,
          request.correlationId,
        );

        if (outcome.kind === 'not_enabled') {
          throw new ApiError(ERROR_CODES.CONFLICT, 'Two-step verification is not on.');
        }
        if (outcome.kind === 'invalid_credentials') {
          // One message for a wrong password and a wrong code alike, so the
          // response does not say which half was correct.
          throw new ApiError(ERROR_CODES.MFA_INVALID, 'Password or code is incorrect.');
        }

        const rotated = await sessions.rotate(session);
        response.cookie(cookie.name, rotated.id, sessionCookieOptions(cookie));

        response.status(200).json({ status: 'disabled' });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
