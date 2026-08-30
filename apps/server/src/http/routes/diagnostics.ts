import { Router, type NextFunction, type Request, type Response } from 'express';
import { ERROR_CODES, type Logger } from '@lcp/contracts';
import type { DiagnosticsService } from '../../application/diagnostics-service.js';
import { ApiError } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/session.js';

/**
 * The protected operator diagnostics surface (blueprint 16.4).
 *
 * One read-only endpoint, and the whole question is who may read it.
 *
 * It is gated on an allowlist of email addresses matched against the SIGNED-IN
 * user, not on a shared token. A token would have been fewer lines and is the
 * obvious thing to reach for, but it is new secret material to store, rotate,
 * and eventually leak, and it authenticates a caller rather than a person -
 * whereas this reuses the session, the server-side session store, the
 * verified-email requirement, and the revocation path that every other
 * privileged action in this product already goes through. It also means a
 * stolen laptop is handled by revoking a session rather than by a redeploy.
 *
 * The allowlist is empty by default and the surface is then closed to
 * everybody, including the person who deployed it. An operator view that
 * defaults to open is a data breach with a changelog entry.
 *
 * The refusal is a 404, not a 403. A 403 would confirm the endpoint exists to
 * an authenticated user who is not an operator, which is the same enumeration
 * problem blueprint 10.3 already solves with generic auth responses.
 */

export interface DiagnosticsRouterDeps {
  readonly diagnostics: DiagnosticsService;
  readonly operatorEmails: readonly string[];
  readonly logger: Logger;
}

export function createDiagnosticsRouter(deps: DiagnosticsRouterDeps): Router {
  const router = Router();
  const allowed = new Set(deps.operatorEmails.map((email) => email.trim().toLowerCase()));

  router.use(requireAuth());

  const requireOperator = (request: Request, _response: Response, next: NextFunction): void => {
    const email = request.currentUser?.email.toLowerCase();
    if (email === undefined || allowed.size === 0 || !allowed.has(email)) {
      /**
       * Logged as a refusal, without the address.
       *
       * Somebody probing this endpoint is worth knowing about; whose account
       * they were signed in as is a detail the log line does not need, and
       * blueprint 16.1 keeps addresses out of logs anyway.
       */
      deps.logger.warn('diagnostics.refused', {
        correlationId: request.correlationId,
        userId: request.session?.userId ?? 'anonymous',
        result: 'client_error',
      });
      next(new ApiError(ERROR_CODES.NOT_FOUND, 'Resource not found'));
      return;
    }
    next();
  };

  router.get('/', requireOperator, async (request, response, next) => {
    try {
      const snapshot = await deps.diagnostics.snapshot();
      deps.logger.info('diagnostics.read', {
        correlationId: request.correlationId,
        userId: request.session?.userId ?? 'anonymous',
        result: 'success',
      });
      response.status(200).json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
