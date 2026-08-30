import { MongoConnection } from '@lcp/database';
import { loadEnv } from './config/env.js';
import { HealthService } from './application/health-service.js';
import { MongoDependencyProbe } from './infrastructure/mongo-probe.js';
import { RedisDependencyProbe } from './infrastructure/redis-probe.js';
import { RedisConnection } from './infrastructure/redis/connection.js';
import { buildDependencies } from './composition.js';
import { createApp } from './http/app.js';

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
  const healthService = new HealthService([mongoProbe, redisProbe], env.release);

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
  const app = createApp({ env, healthService, deps });

  const server = app.listen(env.port, () => {
    deps.logger.info('server.listening', {
      port: env.port,
      emailProvider: env.emailProvider,
      result: 'success',
    });
  });

  const shutdown = (signal: string): void => {
    deps.logger.info('server.shutdown', { signal, result: 'success' });
    server.close(() => {
      void Promise.allSettled([
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

main().catch((error: unknown) => {
  console.error('[server] Failed to start:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
