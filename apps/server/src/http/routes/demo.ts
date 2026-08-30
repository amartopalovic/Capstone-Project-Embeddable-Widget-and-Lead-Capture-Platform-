import { Router } from 'express';
import { ERROR_CODES, type Logger } from '@lcp/contracts';
import type { DemoService } from '../../application/demo/demo-service.js';
import type { RateLimiter } from '../../ports/rate-limiter.js';
import { DEMO_RATE_RULES } from '../../domain/demo/limits.js';
import { ApiError } from '../middleware/error-handler.js';

/**
 * The public sandbox's own endpoints (blueprint 14.3).
 *
 * Two routes, both unauthenticated, both read-only, and both belonging to one
 * workspace that nobody owns. There is deliberately no third route: the reset
 * is a scheduled job, not something a caller can ask for.
 *
 * CORS is open here, unlike everywhere else on this server, and that is a
 * decision rather than an oversight. The demo page is hosted on a different
 * origin from the API on purpose - blueprint 14.3 wants the sandbox to prove
 * cross-origin behaviour - so it has to be able to read these. What makes that
 * safe is that neither response contains anything private: one lists three
 * public widget ids, and the other counts things. Compare the widget config
 * endpoint, which is also cross-origin but echoes only an allowlisted Origin,
 * because it is answering about a customer's widget rather than about a
 * sandbox that belongs to nobody.
 */

export const DEMO_PREFIX = '/demo/v1';

export interface DemoRouterDeps {
  readonly demo: DemoService;
  readonly limiter: RateLimiter;
  readonly logger: Logger;
}

export function createDemoRouter(deps: DemoRouterDeps): Router {
  const router = Router();
  const { demo, limiter } = deps;

  router.use((request, response, next) => {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      response.status(204).end();
      return;
    }
    next();
  });

  /**
   * What the demo page needs to install the seeded widgets.
   *
   * Returns 503 rather than an empty list when the sandbox has not been seeded
   * yet, because "the sandbox is not ready" and "the sandbox has no widgets"
   * are different facts and a page that cannot tell them apart shows the wrong
   * message.
   */
  router.get('/config', async (_request, response, next) => {
    try {
      const config = await demo.config();
      if (config === null) {
        throw new ApiError(
          ERROR_CODES.SERVICE_UNAVAILABLE,
          'The sandbox is still being prepared. Try again in a moment.',
        );
      }
      response.status(200).json(config);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Recent sandbox activity.
   *
   * Rate limited even though it is a read: it is a public endpoint that runs
   * several database queries, on shared free-tier infrastructure, and it is the
   * obvious thing to poll.
   */
  router.get('/feed', async (request, response, next) => {
    try {
      const decision = await limiter.consume(
        DEMO_RATE_RULES.feedPerIpMinute,
        request.ip ?? 'unknown',
      );
      if (!decision.allowed) {
        response.set('Retry-After', String(decision.retryAfterSeconds));
        throw new ApiError(ERROR_CODES.RATE_LIMITED, 'Slow down a moment.');
      }

      const feed = await demo.feed();
      if (feed === null) {
        throw new ApiError(
          ERROR_CODES.SERVICE_UNAVAILABLE,
          'The sandbox is still being prepared. Try again in a moment.',
        );
      }
      response.status(200).json(feed);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
