import type { Express } from 'express';
import type { HealthService } from '../../src/application/health-service.js';
import { createApp } from '../../src/http/app.js';
import type { AppDependencies } from '../../src/composition.js';
import type { ServerEnv } from '../../src/config/env.js';

/**
 * Build the Express app for tests that exercise only the health endpoints.
 *
 * Auth dependencies are stubbed rather than constructed, because these tests
 * deliberately need no Mongo, Redis, or SMTP. Integration tests build the real
 * graph instead.
 */
export function buildTestApp(healthService: HealthService): Express {
  const env = {
    nodeEnv: 'test',
    port: 0,
    release: 'test-release',
    mongoUri: 'mongodb://unused',
    mongoDbName: undefined,
    redisUrl: 'redis://unused',
    redisKeyPrefix: 'lcp:test',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: 'test-only-secret-value-not-a-credential',
    sessionCookieName: 'lcp.sid',
    sessionIdleTtlSeconds: 604_800,
    sessionAbsoluteTtlSeconds: 2_592_000,
    emailProvider: 'capture',
    brevoApiKey: '',
    brevoSenderEmail: 'no-reply@example.invalid',
    brevoSenderName: 'Test',
    mailpitHost: 'localhost',
    mailpitPort: 1025,
    breachCheckRemote: false,
    encryptionMasterKey: Buffer.from('test-only-insecure-key-32-bytes!').toString('base64'),
    encryptionKeyVersion: 1,
    totpIssuer: 'Lead Capture Test',
    ipHmacSecret: 'integration-test-ip-hmac-not-a-real-credential',
    // Never call the real geo services from a test suite; blueprint 18.4 wants
    // provider outcomes deterministic, and the tests inject their own.
    geoEnabled: false,
    geoTimeoutMs: 200,
  } satisfies ServerEnv;

  // Only the health surface is exercised, so the auth graph is never called.
  const deps = {
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      child: () => deps.logger,
    },
  } as unknown as AppDependencies;

  return createApp({ env, healthService, deps });
}
