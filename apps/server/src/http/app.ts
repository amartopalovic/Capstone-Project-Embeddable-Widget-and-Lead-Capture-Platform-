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
import { createContactsRouter } from './routes/contacts.js';
import { createEventsRouter } from './routes/events.js';
import { createDeliveriesRouter } from './routes/deliveries.js';
import { PUBLIC_WIDGET_PREFIX, createPublicWidgetRouter } from './routes/public-widget.js';
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

  const publicWidgetRouter = createPublicWidgetRouter({
    widgets: deps.publicWidgetService,
    submissions: deps.submissionService,
    limiter: deps.rateLimiter,
    logger: deps.logger,
    publicBaseUrl: env.appBaseUrl,
  });

  const widgetsRouter = createWidgetsRouter({
    widgets: deps.widgetService,
    memberships: deps.membershipService,
    workspaces: deps.workspaceService,
    logger: deps.logger,
  });

  const contactsRouter = createContactsRouter({
    contacts: deps.contactService,
    memberships: deps.membershipService,
    workspaces: deps.workspaceService,
    logger: deps.logger,
  });

  const deliveriesRouter = createDeliveriesRouter({
    admin: deps.deliveryAdminService,
    deliveries: deps.deliveryService,
    workers: deps.deliveryWorkers,
    memberships: deps.membershipService,
    workspaces: deps.workspaceService,
    logger: deps.logger,
  });

  const eventsRouter = createEventsRouter({
    hub: deps.eventHub,
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
  app.use(`${API_PREFIX}/contacts`, doubleCsrfProtection, contactsRouter);
  app.use(`${API_PREFIX}/deliveries`, doubleCsrfProtection, deliveriesRouter);

  /**
   * The SSE stream is authenticated but NOT behind the CSRF guard.
   *
   * It is a GET that changes nothing, which is precisely the shape CSRF
   * protection exempts - and EventSource cannot set a custom header, so a token
   * requirement would make the stream unopenable from a browser rather than
   * safer. What protects it is the session and the workspace membership check,
   * which run on connect and again on every heartbeat.
   */
  app.use(`${API_PREFIX}/events`, eventsRouter);

  /**
   * The public widget surface, mounted outside the versioned API and outside
   * session and CSRF handling.
   *
   * A visitor on a customer's website has no session with us, so there is no
   * token to bind a CSRF check to and nothing for a session to resolve. What
   * protects these routes is the Origin allowlist and the published state,
   * both enforced server-side (blueprint 7.2 step 5).
   */
  app.use(PUBLIC_WIDGET_PREFIX, publicWidgetRouter);

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
