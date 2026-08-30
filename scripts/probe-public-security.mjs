// Local-only production-mode HTTP audit. Creates and removes one isolated
// synthetic database/key namespace; never accepts external connection URLs.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MongoConnection, runMigrations } from '@lcp/database';
import { createLogger } from '@lcp/contracts';
import { loadEnv } from '../apps/server/dist/config/env.js';
import { RedisConnection } from '../apps/server/dist/infrastructure/redis/connection.js';
import { buildDependencies } from '../apps/server/dist/composition.js';
import { createApp } from '../apps/server/dist/http/app.js';
import { HealthService } from '../apps/server/dist/application/health-service.js';
import { MongoDependencyProbe } from '../apps/server/dist/infrastructure/mongo-probe.js';
import { RedisDependencyProbe } from '../apps/server/dist/infrastructure/redis-probe.js';
import { MigrationDependencyProbe } from '../apps/server/dist/infrastructure/migration-probe.js';

const suffix = randomBytes(6).toString('hex');
const database = `lcp_security_audit_${suffix}`;
const prefix = `lcp:audit:${suffix}`;
const mongoUri = 'mongodb://127.0.0.1:27017/?directConnection=true';
const redisUrl = 'redis://127.0.0.1:6379';
Object.assign(process.env, {
  NODE_ENV: 'production',
  SESSION_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_MASTER_KEY: randomBytes(32).toString('base64'),
  IP_HMAC_SECRET: randomBytes(32).toString('hex'),
  EMAIL_PROVIDER: 'capture',
  GEO_ENABLED: 'false',
  SENTRY_DSN: '',
  BREACH_CHECK_REMOTE: 'false',
});
const env = {
  ...loadEnv(),
  mongoUri,
  mongoDbName: database,
  redisUrl,
  redisKeyPrefix: prefix,
  release: 'security-audit',
  appBaseUrl: 'http://127.0.0.1',
  demoOrigin: 'https://demo.example.invalid',
  platformOperatorEmails: [],
};
const logs = [];
const logger = createLogger({
  bindings: { service: 'audit', environment: 'production', release: 'audit' },
  sink: (record) => logs.push(record),
});
const mongo = new MongoConnection({ uri: mongoUri, databaseName: database });
const redis = new RedisConnection({ url: redisUrl, keyPrefix: prefix });
const mongoProbe = new MongoDependencyProbe(mongoUri);
const redisProbe = new RedisDependencyProbe(redisUrl);
let deps;
let server;
try {
  await mongo.connect();
  await redis.connect();
  await runMigrations(mongo.db, logger);
  deps = buildDependencies(env, mongo.db, redis.client, { startWorkers: false, logger });
  await deps.demoService.reset();
  const health = new HealthService(
    [mongoProbe, redisProbe, new MigrationDependencyProbe(mongo.db)],
    env.release,
  );
  server = createServer(createApp({ env, healthService: health, deps }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = [
    'content-security-policy',
    'strict-transport-security',
    'x-frame-options',
    'x-content-type-options',
    'referrer-policy',
    'permissions-policy',
  ];
  for (const [path, status] of [
    ['/', 200],
    ['/api/v1', 200],
    ['/api-reference', 200],
    ['/health/ready', 200],
    ['/api/does-not-exist', 404],
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, status, path);
    for (const header of headers) assert.ok(response.headers.get(header), `${path}: ${header}`);
    assert.equal(response.headers.get('x-powered-by'), null);
    console.log(
      JSON.stringify({
        path,
        status,
        headers: Object.fromEntries(headers.map((name) => [name, response.headers.get(name)])),
      }),
    );
  }
  const auth = await fetch(base + '/api/v1/workspaces', {
    headers: { Origin: 'https://hostile.example.invalid' },
  });
  assert.equal(auth.status, 401);
  assert.equal(auth.headers.get('access-control-allow-origin'), null);
  assert.equal(auth.headers.get('access-control-allow-credentials'), null);
  const configResponse = await fetch(base + '/demo/v1/config', {
    headers: { Origin: env.demoOrigin },
  });
  const config = await configResponse.json();
  assert.equal(configResponse.headers.get('access-control-allow-origin'), '*');
  assert.equal(configResponse.headers.get('access-control-allow-credentials'), null);
  const widgetId = config.widgets[0].publicId;
  const widgetResponse = await fetch(`${base}/widget/v1/config/${widgetId}`, {
    headers: { Origin: env.demoOrigin },
  });
  assert.equal(widgetResponse.status, 200);
  assert.equal(widgetResponse.headers.get('access-control-allow-origin'), env.demoOrigin);
  assert.equal(widgetResponse.headers.get('access-control-allow-credentials'), null);
  const widget = await widgetResponse.json();
  const denied = await fetch(`${base}/widget/v1/config/${widgetId}`, {
    headers: { Origin: 'https://hostile.example.invalid' },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  const feed = await (await fetch(base + '/demo/v1/feed')).json();
  for (const payload of [config, widget, feed]) {
    assert.doesNotMatch(
      JSON.stringify(payload),
      /"(?:workspaceId|userId|recipient|webhookSecret|signingSecret|passwordHash|sessionId|submissionValues|fieldValues|values)"/,
    );
  }
  const spec = await (await fetch(base + '/api/v1/openapi.json')).json();
  assert.ok(spec.paths);
  assert.doesNotMatch(JSON.stringify(spec), /AUDIT_PRIVATE_SENTINEL|@gmail\.com|mongodb:\/\//);
  const failure = await fetch(base + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"email":"AUDIT_PRIVATE_SENTINEL@example.invalid",invalid}',
  });
  const errorText = await failure.text();
  assert.equal(failure.status, 400);
  assert.doesNotMatch(errorText, /AUDIT_PRIVATE_SENTINEL|stack|SyntaxError/);
  assert.doesNotMatch(JSON.stringify(logs), /AUDIT_PRIVATE_SENTINEL/);
  const files = (directory) =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)],
    );
  const publicMaps = ['apps/web/dist', 'apps/demo/dist', 'packages/widget-runtime/dist']
    .flatMap(files)
    .filter((path) => path.endsWith('.map'));
  assert.equal(publicMaps.length, 0);
  const vendorMap = await fetch(base + '/api-reference/swagger-ui-bundle.js.map');
  await vendorMap.arrayBuffer();
  console.log(
    JSON.stringify({
      authForeignOrigin: { status: auth.status, allowOrigin: null, allowCredentials: null },
      demoCors: '* without credentials',
      widgetAllowed: 200,
      widgetForeignOrigin: denied.status,
      publicProjection: 'pass',
      malformedBodyPrivateEcho: false,
      firstPartyPublicSourceMaps: publicMaps.length,
      swaggerVendorMapStatus: vendorMap.status,
    }),
  );
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await deps?.queues.close();
  await deps?.eventHub.close();
  await mongoProbe.close();
  await redisProbe.close();
  // Names are generated above, and checked again before any deletion.
  assert.match(database, /^lcp_security_audit_[a-f0-9]{12}$/);
  assert.match(prefix, /^lcp:audit:[a-f0-9]{12}$/);
  const keys = await redis.client.keys(`${prefix}:*`);
  if (keys.length) await redis.client.del(...keys);
  await redis.close();
  await mongo.db.dropDatabase();
  await mongo.close();
  console.log('[audit] Removed only the isolated synthetic database and Redis namespace.');
}
