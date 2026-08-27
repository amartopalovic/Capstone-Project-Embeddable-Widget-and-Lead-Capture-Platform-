import { Router } from 'express';
import type { HealthService } from '../../application/health-service.js';

/**
 * HTTP adapter for the health endpoints.
 *
 * Per the layering rule in blueprint section 6.2 this route contains no
 * business logic, no tenant queries, and no provider calls: it translates an
 * HTTP request into an application-service call and a status code.
 */
export function createHealthRouter(healthService: HealthService): Router {
  const router = Router();

  router.get('/live', (_request, response) => {
    response.status(200).json(healthService.liveness());
  });

  router.get('/ready', async (_request, response, next) => {
    try {
      const report = await healthService.readiness();
      response.status(report.status === 'ready' ? 200 : 503).json(report);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
