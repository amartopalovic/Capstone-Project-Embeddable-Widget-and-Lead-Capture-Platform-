import express, { type Express } from 'express';
import { API_PREFIX } from '@lcp/contracts';
import type { HealthService } from '../application/health-service.js';
import { createHealthRouter } from './routes/health.js';

/**
 * Express application factory.
 *
 * Kept separate from the process bootstrap so tests can exercise the app
 * without binding a fixed port or starting background work.
 */
export function createApp(healthService: HealthService): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  // Health endpoints sit outside the versioned API surface so probes stay
  // stable across API versions (blueprint section 16.2).
  app.use('/health', createHealthRouter(healthService));

  app.get(API_PREFIX, (_request, response) => {
    response.status(200).json({ api: API_PREFIX, status: 'skeleton' });
  });

  app.use((_request, response) => {
    response.status(404).json({ code: 'not_found', message: 'Resource not found' });
  });

  return app;
}
