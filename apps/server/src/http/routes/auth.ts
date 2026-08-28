import { Router, type Request, type Response } from 'express';
import {
  ERROR_CODES,
  GENERIC_ACK,
  confirmPasswordResetSchema,
  loginRequestSchema,
  registerRequestSchema,
  requestPasswordResetSchema,
  resendVerificationRequestSchema,
  validate,
  verifyEmailRequestSchema,
  type AuthenticatedUser,
  type Logger,
} from '@lcp/contracts';
import type { AuthService } from '../../application/auth/auth-service.js';
import type { SessionService } from '../../application/auth/session-service.js';
import type { RateLimiter } from '../../ports/rate-limiter.js';
import { AUTH_RATE_RULES } from '../../infrastructure/redis/rate-limiter.js';
import { ApiError } from '../middleware/error-handler.js';
import {
  requireAuth,
  sessionCookieOptions,
  type SessionCookieOptions,
} from '../middleware/session.js';
import { emailIdentifier, throttle } from '../middleware/throttle.js';
import type { WithIdUser } from '../../application/auth/types.js';

/**
 * Authentication HTTP adapter.
 *
 * Per blueprint section 6.2 these handlers contain no business logic: they
 * validate the payload against a shared schema, call an application service,
 * and map its outcome to a status code. Every security decision lives in the
 * service.
 */

export interface AuthRouterDeps {
  readonly auth: AuthService;
  readonly sessions: SessionService;
  readonly limiter: RateLimiter;
  readonly logger: Logger;
  readonly cookie: SessionCookieOptions;
  readonly generateCsrfToken: (
    request: Request,
    response: Response,
    options?: { overwrite?: boolean },
  ) => string;
}

function toAuthenticatedUser(user: WithIdUser): AuthenticatedUser {
  return {
    id: user._id.toHexString(),
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();
  const { auth, sessions, limiter, logger, cookie, generateCsrfToken } = deps;

  /** Issue a session cookie and a fresh CSRF token bound to it. */
  function establishSession(request: Request, response: Response, sessionId: string): void {
    response.cookie(cookie.name, sessionId, sessionCookieOptions(cookie));
    generateCsrfToken(request, response, { overwrite: true });
  }

  // ------------------------------------------------------------- register

  router.post(
    '/register',
    throttle(limiter, AUTH_RATE_RULES.register, logger),
    async (request, response, next) => {
      try {
        const parsed = validate(registerRequestSchema, request.body);
        if (!parsed.ok) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_FAILED,
            'Check the submitted fields',
            parsed.errors,
          );
        }

        const policy = await auth.checkPassword(parsed.data.password, parsed.data.email);
        if (policy.kind === 'weak_password') {
          throw new ApiError(
            ERROR_CODES.WEAK_PASSWORD,
            'Choose a stronger password',
            policy.problems.map((problem) => ({ path: 'password', message: problem })),
          );
        }

        await auth.register(parsed.data.email, parsed.data.password, request.correlationId);

        // Identical response whether the address was free or already taken.
        response.status(202).json(GENERIC_ACK);
      } catch (error) {
        next(error);
      }
    },
  );

  // --------------------------------------------------------- verification

  router.post('/verify', async (request, response, next) => {
    try {
      const parsed = validate(verifyEmailRequestSchema, request.body);
      if (!parsed.ok) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          'Check the submitted fields',
          parsed.errors,
        );
      }

      const outcome = await auth.verifyEmail(parsed.data.token, request.correlationId);
      if (outcome.kind === 'invalid_token') {
        throw new ApiError(ERROR_CODES.INVALID_TOKEN, 'This link is invalid or has expired');
      }

      response.status(200).json({ status: 'verified' });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/verify/resend',
    throttle(limiter, AUTH_RATE_RULES.verificationResend, logger, emailIdentifier),
    async (request, response, next) => {
      try {
        const parsed = validate(resendVerificationRequestSchema, request.body);
        if (!parsed.ok) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_FAILED,
            'Check the submitted fields',
            parsed.errors,
          );
        }
        await auth.resendVerification(parsed.data.email, request.correlationId);
        response.status(202).json(GENERIC_ACK);
      } catch (error) {
        next(error);
      }
    },
  );

  // ---------------------------------------------------------------- login

  router.post(
    '/login',
    throttle(limiter, AUTH_RATE_RULES.login, logger),
    throttle(limiter, AUTH_RATE_RULES.loginPerAccount, logger, emailIdentifier),
    async (request, response, next) => {
      try {
        const parsed = validate(loginRequestSchema, request.body);
        if (!parsed.ok) {
          // Deliberately the same error as a wrong password: a malformed login
          // must not be distinguishable from a failed one.
          throw new ApiError(ERROR_CODES.INVALID_CREDENTIALS, 'Email or password is incorrect');
        }

        const outcome = await auth.login(
          parsed.data.email,
          parsed.data.password,
          request.correlationId,
        );
        if (outcome.kind === 'invalid_credentials') {
          throw new ApiError(ERROR_CODES.INVALID_CREDENTIALS, 'Email or password is incorrect');
        }

        // Section 10.3: the session identifier rotates after authentication.
        // There is no pre-auth session to rotate here, so a brand new one is
        // minted and any cookie the client already held stops resolving.
        const session = await sessions.start(outcome.user._id, request.get('user-agent'));
        establishSession(request, response, session.id);

        response.status(200).json({ user: toAuthenticatedUser(outcome.user) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post('/logout', requireAuth(), async (request, response, next) => {
    try {
      const session = request.session;
      const user = request.currentUser;
      if (session === undefined || user === undefined) {
        throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required');
      }

      await sessions.end(session.id, user._id, request.correlationId);
      response.clearCookie(cookie.name, sessionCookieOptions(cookie));
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------------- password reset

  router.post(
    '/password/reset-request',
    throttle(limiter, AUTH_RATE_RULES.passwordResetRequest, logger, emailIdentifier),
    async (request, response, next) => {
      try {
        const parsed = validate(requestPasswordResetSchema, request.body);
        if (!parsed.ok) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_FAILED,
            'Check the submitted fields',
            parsed.errors,
          );
        }
        await auth.requestPasswordReset(parsed.data.email, request.correlationId);
        // Identical response whether or not the account exists.
        response.status(202).json(GENERIC_ACK);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/password/reset-confirm',
    throttle(limiter, AUTH_RATE_RULES.passwordResetConfirm, logger),
    async (request, response, next) => {
      try {
        const parsed = validate(confirmPasswordResetSchema, request.body);
        if (!parsed.ok) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_FAILED,
            'Check the submitted fields',
            parsed.errors,
          );
        }

        const outcome = await auth.confirmPasswordReset(
          parsed.data.token,
          parsed.data.password,
          request.correlationId,
        );

        if (outcome.kind === 'invalid_token') {
          throw new ApiError(ERROR_CODES.INVALID_TOKEN, 'This link is invalid or has expired');
        }
        if (outcome.kind === 'weak_password') {
          throw new ApiError(
            ERROR_CODES.WEAK_PASSWORD,
            'Choose a stronger password',
            outcome.problems.map((problem) => ({ path: 'password', message: problem })),
          );
        }

        // Section 4.2: a completed reset revokes every existing session, so a
        // stolen session cannot outlive the password that created it.
        const revoked = await sessions.revokeAll(
          outcome.userId.toHexString(),
          outcome.userId,
          request.correlationId,
        );
        response.clearCookie(cookie.name, sessionCookieOptions(cookie));

        response.status(200).json({ status: 'reset', sessionsRevoked: revoked });
      } catch (error) {
        next(error);
      }
    },
  );

  // ----------------------------------------------------------------- self

  router.get('/me', requireAuth(), (request, response) => {
    const user = request.currentUser;
    if (user === undefined) {
      response.status(401).end();
      return;
    }
    response.status(200).json({ user: toAuthenticatedUser(user) });
  });

  /** Mint a CSRF token for the current session, for the Stage 3b UI to read. */
  router.get('/csrf', (request, response) => {
    const token = generateCsrfToken(request, response, { overwrite: true });
    response.status(200).json({ csrfToken: token });
  });

  return router;
}
