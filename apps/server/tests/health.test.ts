import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HealthService } from '../src/application/health-service.js';
import type { DependencyProbe, DependencyProbeResult } from '../src/ports/dependency-probe.js';
import { createApp } from '../src/http/app.js';

/**
 * Stage 1 smoke test.
 *
 * Boots the real Express application on an ephemeral port and makes real HTTP
 * requests, so it proves the app actually starts and routes. It uses stub
 * probes rather than live Mongo and Redis so it runs in CI with no
 * infrastructure; readiness against real services is verified through Docker
 * Compose and becomes an integration test in Stage 2.
 */

function stubProbe(name: string, status: 'up' | 'down'): DependencyProbe {
  return {
    name,
    check: (): Promise<DependencyProbeResult> => Promise.resolve({ name, status, durationMs: 0 }),
  };
}

function startServer(healthService: HealthService): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(createApp(healthService));
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

    const body = (await response.json()) as Record<string, unknown>;
    expect(body['code']).toBe('not_found');
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
