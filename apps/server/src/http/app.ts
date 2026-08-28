import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { API_PREFIX, ERROR_CODES, createErrorPayload } from '@lcp/contracts';
import type { HealthService } from '../application/health-service.js';
import type { AppDependencies } from '../composition.js';
import type { ServerEnv } from '../config/env.js';
import { createHealthRouter } from './routes/health.js';
import { createAuthRouter } from './routes/auth.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createMfaRouter } from './routes/mfa.js';
import { createWorkspacesRouter } from './routes/workspaces.js';
import { createInvitationsRouter, createMembersRouter } from './routes/members.js';
import { createWidgetsRouter } from './routes/widgets.js';
import { correlationMiddleware } from './middleware/correlation.js';
import { errorHandler } from './middleware/error-handler.js';
import { sessionMiddleware, type SessionCookieOptions } from './middleware/session.js';
import { createCsrf } from './middleware/csrf.js';

/**
 * Express application factory.
 *
 * Middleware order is load-bearing and deliberate:
 *   correlation -> cookies -> body -> session resolution -> CSRF -> routes
 *
 * CSRF must run AFTER session resolution because the token is bound to the
 * session identifier, and after the body parser so a form-encoded token could
 * be read if a later stage needs one.
 */

export interface CreateAppOptions {
  readonly env: ServerEnv;
  readonly healthService: HealthService;
  readonly deps: AppDependencies;
}

export function createApp(options: CreateAppOptions): Express {
  const { env, healthService, deps } = options;
  const app = express();

  app.disable('x-powered-by');
  // Behind Render's proxy, so the client IP used for throttling comes from the
  // forwarded header rather than the proxy's own address.
  app.set('trust proxy', 1);

  const secureCookies = env.nodeEnv === 'production';
  const cookie: SessionCookieOptions = {
    name: env.sessionCookieName,
    secure: secureCookies,
    // Lax rather than Strict: the dashboard is same-origin, and Strict would
    // break the top-level navigation arriving from a verification email link.
    sameSite: 'lax',
  };

  app.use(correlationMiddleware());
  app.use(cookieParser());
  // Blueprint section 7.3 caps request bodies at 32 KB. An oversized body is
  // translated into a clean 413 by the error handler, never a 500.
  app.use(express.json({ limit: '32kb' }));

  // Health endpoints sit outside the versioned API and before session handling,
  // so a probe never depends on Redis being reachable.
  app.use('/health', createHealthRouter(healthService));

  app.use(sessionMiddleware(deps.sessionService, deps.userRepository, cookie.name));

  const { generateCsrfToken, doubleCsrfProtection } = createCsrf({
    secret: env.sessionSecret,
    cookieName: secureCookies ? '__Host-lcp.csrf' : 'lcp.csrf',
    secure: secureCookies,
    sameSite: 'lax',
  });

  const authRouter = createAuthRouter({
    auth: deps.authService,
    sessions: deps.sessionService,
    mfa: deps.mfaService,
    mfaChallenges: deps.mfaChallengeStore,
    invitations: deps.invitationService,
    users: deps.userRepository,
    limiter: deps.rateLimiter,
    logger: deps.logger,
    cookie,
    mfaChallengeCookieName: cookie.name.replace('.sid', '.mfa'),
    generateCsrfToken,
  });

  const mfaRouter = createMfaRouter({
    mfa: deps.mfaService,
    sessions: deps.sessionService,
    limiter: deps.rateLimiter,
    logger: deps.logger,
    cookie,
  });

  const workspaceRouterDeps = {
    workspaces: deps.workspaceService,
    memberships: deps.membershipService,
    invitations: deps.invitationService,
    sessions: deps.sessionService,
    audit: deps.workspaceAudit,
    limiter: deps.rateLimiter,
    logger: deps.logger,
  };

  const workspacesRouter = createWorkspacesRouter(workspaceRouterDeps);
  const membersRouter = createMembersRouter(workspaceRouterDeps);
  const invitationsRouter = createInvitationsRouter(workspaceRouterDeps);

  const widgetsRouter = createWidgetsRouter({
    widgets: deps.widgetService,
    memberships: deps.membershipService,
    workspaces: deps.workspaceService,
    logger: deps.logger,
  });

  const sessionsRouter = createSessionsRouter({
    sessions: deps.sessionService,
    logger: deps.logger,
    cookie,
  });

  /**
   * CSRF applies to the authenticated surface only.
   *
   * The unauthenticated auth endpoints (register, login, verify, reset) cannot
   * be meaningfully CSRF-protected: there is no session yet to bind a token to,
   * and a forged request to them accomplishes nothing an attacker could not do
   * directly. They are protected by throttling and generic responses instead.
   * Everything reached with an existing session does require a token.
   */
  app.use(`${API_PREFIX}/auth`, authRouter);
  app.use(`${API_PREFIX}/sessions`, doubleCsrfProtection, sessionsRouter);
  app.use(`${API_PREFIX}/mfa`, doubleCsrfProtection, mfaRouter);
  app.use(`${API_PREFIX}/workspaces`, doubleCsrfProtection, workspacesRouter);
  app.use(`${API_PREFIX}/members`, doubleCsrfProtection, membersRouter);
  app.use(`${API_PREFIX}/invitations`, doubleCsrfProtection, invitationsRouter);
  app.use(`${API_PREFIX}/widgets`, doubleCsrfProtection, widgetsRouter);

  app.get(API_PREFIX, (_request, response) => {
    response.status(200).json({ api: API_PREFIX, status: 'ok' });
  });

  app.use((request, response) => {
    response
      .status(404)
      .json(
        createErrorPayload(
          ERROR_CODES.NOT_FOUND,
          'Resource not found',
          request.correlationId ?? 'unknown',
        ),
      );
  });

  app.use(errorHandler(deps.logger));

  return app;
}
