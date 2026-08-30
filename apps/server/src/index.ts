/**
 * FIRST, before anything else is imported (blueprint 16.3).
 *
 * Error monitoring patches modules, so it has to run before those modules are
 * loaded. See `instrument.ts`.
 */
import { errorMonitoringEnabled, errorReporter } from './instrument.js';
import { MongoConnection } from '@lcp/database';
import { loadEnv } from './config/env.js';
import { HealthService } from './application/health-service.js';
import { MongoDependencyProbe } from './infrastructure/mongo-probe.js';
import { RedisDependencyProbe } from './infrastructure/redis-probe.js';
import { MigrationDependencyProbe } from './infrastructure/migration-probe.js';
import { ConfiguredProviderProbe, EmailProviderProbe } from './infrastructure/optional-probes.js';
import { RedisConnection } from './infrastructure/redis/connection.js';
import { buildDependencies } from './composition.js';
import { createApp } from './http/app.js';
import { flushSentry } from './infrastructure/observability/sentry.js';

/**
 * Process bootstrap.
 *
 * Migrations are deliberately NOT run here: blueprint section 9.3 forbids
 * uncontrolled startup mutation, so `npm run migrate` remains an explicit step.
 *
 * The BullMQ worker that shares this process in production (section 12.1)
 * arrives in Stage 9.
 */
async function main(): Promise<void> {
  const env = loadEnv();

  const mongoProbe = new MongoDependencyProbe(env.mongoUri);
  const redisProbe = new RedisDependencyProbe(env.redisUrl);

  const mongo = new MongoConnection({
    uri: env.mongoUri,
    ...(env.mongoDbName === undefined ? {} : { databaseName: env.mongoDbName }),
  });
  await mongo.connect();

  const redis = new RedisConnection({ url: env.redisUrl, keyPrefix: env.redisKeyPrefix });
  await redis.connect();

  /**
   * The in-process worker (blueprint 12.1, 9.5).
   *
   * "In production, the worker starts inside the same Render process as the web
   * server." Until Stage 11 this flag was never set outside the tests, so the
   * delivery, reconciliation, and analytics schedules Stage 9 and 10a built
   * existed but never actually ran in a deployed process - and Stage 11's
   * startup catch-up sweep would have been dead code for the same reason.
   *
   * Tests still start without workers, deliberately: they drive the queue by
   * hand so an outcome is a stated fact rather than a race with a poller.
   */
  const deps = buildDependencies(env, mongo.db, redis.client, { startWorkers: true });

  /**
   * Readiness, built after the connections exist (blueprint 16.2).
   *
   * The required list gained migration compatibility in Stage 13, which needs a
   * live database handle - so the health service is now assembled here rather
   * than before `connect()`. The optional list is reported beside it and can
   * never change the answer.
   */
  const healthService = new HealthService(
    [mongoProbe, redisProbe, new MigrationDependencyProbe(mongo.db)],
    env.release,
    [
      new EmailProviderProbe({
        budget: deps.emailBudget,
        provider: env.emailProvider,
        configured: env.emailProvider !== 'brevo' || env.brevoApiKey !== '',
      }),
      new ConfiguredProviderProbe(
        'geo',
        env.geoEnabled,
        env.geoEnabled ? 'ip-api, ipapi.co' : 'disabled; submissions store no country',
      ),
      new ConfiguredProviderProbe(
        'error-monitoring',
        errorMonitoringEnabled,
        errorMonitoringEnabled ? 'sentry' : 'no DSN configured',
      ),
    ],
  );
  const app = createApp({ env, healthService, deps, errorReporter });

  /**
   * The two failures that never reach an Express error handler.
   *
   * A rejected promise nobody awaited and a throw from a timer both escape the
   * request cycle entirely, and both are exactly the kind of defect error
   * monitoring exists to surface. Logged as well as reported, so the evidence
   * survives whether or not a DSN is configured.
   *
   * Neither exits the process. Blueprint 5.2 runs this on a free tier that goes
   * to sleep and takes 30 seconds to wake; killing a service that is still
   * answering requests, because something unrelated rejected, would turn a
   * logged defect into an outage.
   */
  process.on('unhandledRejection', (reason: unknown) => {
    deps.logger.error('process.unhandled_rejection', {
      result: 'server_error',
      errorName: reason instanceof Error ? reason.name : typeof reason,
    });
    errorReporter.captureException(reason, { event: 'process.unhandled_rejection' });
  });

  process.on('uncaughtException', (error: Error) => {
    deps.logger.error('process.uncaught_exception', {
      result: 'server_error',
      errorName: error.name,
    });
    errorReporter.captureException(error, { event: 'process.uncaught_exception' });
  });

  const server = app.listen(env.port, () => {
    deps.logger.info('server.listening', {
      port: env.port,
      emailProvider: env.emailProvider,
      errorMonitoring: errorMonitoringEnabled ? 'sentry' : 'disabled',
      result: 'success',
    });
  });

  const shutdown = (signal: string): void => {
    deps.logger.info('server.shutdown', { signal, result: 'success' });
    server.close(() => {
      void Promise.allSettled([
        // Give queued reports their two seconds before the process ends, or the
        // report explaining why it is shutting down never leaves.
        flushSentry(),
        mongoProbe.close(),
        redisProbe.close(),
        mongo.close(),
        redis.close(),
      ]).finally(() => process.exit(0));
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(() => {
  console.error(
    '[server] Failed to start; sensitive driver details suppressed. Check configuration and service availability.',
  );
  process.exitCode = 1;
});
