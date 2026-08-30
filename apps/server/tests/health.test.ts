import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HealthService } from '../src/application/health-service.js';
import type { DependencyProbe, DependencyProbeResult } from '../src/ports/dependency-probe.js';
import { buildTestApp } from './helpers/test-app.js';

/**
 * Stage 1 smoke test.
 *
 * Boots the real Express application on an ephemeral port and makes real HTTP
 * requests, so it proves the app actually starts and routes. It uses stub
 * probes rather than live Mongo and Redis so it runs in CI with no
 * infrastructure; readiness against real services is verified through Docker
 * Compose and becomes an integration test in Stage 2.
 */

function stubProbe(name: string, status: 'up' | 'down' | 'degraded'): DependencyProbe {
  return {
    name,
    check: (): Promise<DependencyProbeResult> => Promise.resolve({ name, status, durationMs: 0 }),
  };
}

/** A probe that fails outright rather than reporting a failure. */
function throwingProbe(name: string): DependencyProbe {
  return {
    name,
    check: (): Promise<DependencyProbeResult> => Promise.reject(new Error('provider exploded')),
  };
}

function startServer(healthService: HealthService): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(buildTestApp(healthService));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

describe('health endpoints with every dependency up', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const healthService = new HealthService(
      [stubProbe('mongodb', 'up'), stubProbe('redis', 'up')],
      'test-release',
    );
    ({ server, baseUrl } = await startServer(healthService));
  });

  afterAll(() => {
    server.close();
  });

  it('serves liveness without consulting dependencies', async () => {
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body['status']).toBe('ok');
    expect(body['release']).toBe('test-release');
    expect(typeof body['uptimeSeconds']).toBe('number');
  });

  it('reports ready when every dependency is up', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body['status']).toBe('ready');
    expect(body['dependencies']).toHaveLength(2);
  });

  it('exposes the versioned API prefix from @lcp/contracts', async () => {
    const response = await fetch(`${baseUrl}/api/v1`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body['api']).toBe('/api/v1');
  });

  it('returns 404 as clean JSON rather than HTML', async () => {
    const response = await fetch(`${baseUrl}/does-not-exist`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');

    // Stage 3a moved every error onto the shared envelope from blueprint
    // section 10.1: a code, a safe message, and the request correlation ID.
    const body = (await response.json()) as { error?: Record<string, unknown> };
    expect(body.error?.['code']).toBe('not_found');
    expect(typeof body.error?.['requestId']).toBe('string');
  });
});

describe('readiness aggregation with a dependency down', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const healthService = new HealthService(
      [stubProbe('mongodb', 'up'), stubProbe('redis', 'down')],
      'test-release',
    );
    ({ server, baseUrl } = await startServer(healthService));
  });

  afterAll(() => {
    server.close();
  });

  it('reports not_ready with a 503', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(503);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body['status']).toBe('not_ready');

    const dependencies = body['dependencies'] as { name: string; status: string }[];
    expect(dependencies.find((d) => d.name === 'redis')?.status).toBe('down');
  });
});

/**
 * Blueprint 16.2: "Optional dependencies such as Brevo, geo providers,
 * webhooks, and Sentry do not make the API unready; their degraded state is
 * reported separately."
 *
 * This is the readiness half of the stage's exit gate - "a degraded optional
 * provider never breaks a primary request" - at the level where a load balancer
 * reads it. A readiness endpoint that went red because Brevo had spent its
 * daily allowance would take the API out of rotation and stop it accepting
 * leads, which is the opposite of what the degradation means.
 */
describe('optional providers never change readiness - EXIT GATE', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const healthService = new HealthService(
      [stubProbe('mongodb', 'up'), stubProbe('redis', 'up')],
      'test-release',
      [stubProbe('email', 'degraded'), stubProbe('geo', 'down'), throwingProbe('error-monitoring')],
    );
    ({ server, baseUrl } = await startServer(healthService));
  });

  afterAll(() => {
    server.close();
  });

  it('stays ready with a degraded provider, a down provider, and one that threw', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      dependencies: { name: string }[];
      optional: { name: string; status: string; detail?: string }[];
    };

    expect(body.status).toBe('ready');
    // Reported separately, and never mixed into the list that decides.
    expect(body.dependencies.map((d) => d.name)).toEqual(['mongodb', 'redis']);
    expect(body.optional.map((o) => o.name).sort()).toEqual(['email', 'error-monitoring', 'geo']);
    expect(body.optional.find((o) => o.name === 'email')?.status).toBe('degraded');
  });

  it('does not let an optional probe that throws take the endpoint down with it', async () => {
    // The same failure the endpoint exists to prevent, one layer up.
    const body = (await (await fetch(`${baseUrl}/health/ready`)).json()) as {
      optional: { name: string; status: string; detail?: string }[];
    };
    const monitoring = body.optional.find((o) => o.name === 'error-monitoring');
    expect(monitoring?.status).toBe('degraded');
    expect(monitoring?.detail).toBe('probe failed');
  });
});

describe('migration compatibility is part of readiness (blueprint 16.2)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    /**
     * Blueprint 9.3 forbids running migrations on boot, so a deployment whose
     * migration step failed comes up connected, healthy, and missing indexes.
     * Readiness is the thing that is supposed to notice.
     */
    const healthService = new HealthService(
      [stubProbe('mongodb', 'up'), stubProbe('redis', 'up'), stubProbe('migrations', 'down')],
      'test-release',
    );
    ({ server, baseUrl } = await startServer(healthService));
  });

  afterAll(() => {
    server.close();
  });

  it('refuses traffic when a migration has not been applied', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(503);

    const body = (await response.json()) as {
      status: string;
      dependencies: { name: string; status: string }[];
    };
    expect(body.status).toBe('not_ready');
    expect(body.dependencies.find((d) => d.name === 'migrations')?.status).toBe('down');
  });
});
