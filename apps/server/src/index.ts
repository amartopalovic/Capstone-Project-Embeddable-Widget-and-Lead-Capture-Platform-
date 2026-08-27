import { loadEnv } from './config/env.js';
import { HealthService } from './application/health-service.js';
import { MongoDependencyProbe } from './infrastructure/mongo-probe.js';
import { RedisDependencyProbe } from './infrastructure/redis-probe.js';
import { createApp } from './http/app.js';

/**
 * Process bootstrap: build the infrastructure adapters, inject them into the
 * application service, and serve the HTTP adapter.
 *
 * The BullMQ worker bootstrap that shares this process in production
 * (blueprint section 12.1) arrives in Stage 9.
 */
function main(): void {
  const env = loadEnv();

  const mongoProbe = new MongoDependencyProbe(env.mongoUri);
  const redisProbe = new RedisDependencyProbe(env.redisUrl);
  const healthService = new HealthService([mongoProbe, redisProbe], env.release);

  const app = createApp(healthService);
  const server = app.listen(env.port, () => {
    console.log(
      JSON.stringify({
        level: 'info',
        service: 'server',
        event: 'server.listening',
        port: env.port,
        env: env.nodeEnv,
        release: env.release,
      }),
    );
  });

  const shutdown = (signal: string): void => {
    console.log(
      JSON.stringify({ level: 'info', service: 'server', event: 'server.shutdown', signal }),
    );
    server.close(() => {
      void Promise.all([mongoProbe.close(), redisProbe.close()]).finally(() => process.exit(0));
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
