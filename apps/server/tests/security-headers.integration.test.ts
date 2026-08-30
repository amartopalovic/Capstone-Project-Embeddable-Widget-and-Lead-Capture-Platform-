import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WidgetConfig } from '@lcp/contracts';
import {
  STRONG_PASSWORD,
  TestClient,
  createAuthHarness,
  extractToken,
  mailpitBody,
  uniqueEmail,
  waitForEmail,
  type AuthHarness,
} from './helpers/auth-harness.js';

/**
 * Security headers, CORS, CSRF, and redirects, against the real application
 * (blueprint 17).
 *
 * This file exists to make the section 17 checklist verifiable rather than
 * asserted. Most of its items were covered by the stage that built them and are
 * cited in EVIDENCE.md rather than re-tested here; what is tested here is the
 * set that had no test of its own before Stage 13:
 *
 *  - security headers and a Content Security Policy on real responses,
 *    including responses that failed;
 *  - `Cross-Origin-Resource-Policy` relaxed on the two public cross-origin
 *    surfaces and NOWHERE else;
 *  - the authenticated API answering a foreign origin with no CORS headers;
 *  - a redirect destination refused at the API boundary rather than only in a
 *    unit test of the validator.
 *
 * The CSRF and Origin checks below are confirmations rather than duplicates.
 * Both were proven by earlier stages; Stage 13 inserted new middleware ahead of
 * every route in the application, and "the guard is still attached afterwards"
 * is a different claim from "the guard works".
 */

let harness: AuthHarness;

beforeAll(async () => {
  harness = await createAuthHarness();
}, 120_000);

afterAll(async () => {
  await harness?.teardown();
});

interface Actor {
  readonly api: TestClient;
  readonly email: string;
}

async function verifiedUser(label: string): Promise<Actor> {
  const email = uniqueEmail(label);
  const api = new TestClient(harness.baseUrl);

  await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
  const message = await waitForEmail(email, (m) => m.Subject.includes('Confirm'));
  const token = extractToken(await mailpitBody(message.ID));
  expect((await api.post('/api/v1/auth/verify', { token })).status).toBe(200);
  expect((await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD })).status).toBe(
    200,
  );

  return { api, email };
}

describe('security headers on every response - EXIT GATE', () => {
  it('sets the full set on an API response', async () => {
    const { headers } = await new TestClient(harness.baseUrl).get('/api/v1');

    const policy = headers.get('content-security-policy') ?? '';
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
    expect(headers.get('strict-transport-security')).toContain('max-age=');
    expect(headers.get('permissions-policy')).toContain('camera=()');
    // Blueprint 17: never advertise the framework.
    expect(headers.get('x-powered-by')).toBeNull();
  });

  it('sets them on a FAILING response too, which is when they matter most', async () => {
    /**
     * A header set only on the happy path is missing exactly when something has
     * gone wrong. The middleware is registered before the body parser for this
     * reason, so the 413 the parser itself raises still carries the full set.
     */
    const oversized = await new TestClient(harness.baseUrl).post('/api/v1/auth/login', {
      padding: 'x'.repeat(40_000),
    });
    expect(oversized.status).toBe(413);
    expect(oversized.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(oversized.headers.get('x-frame-options')).toBe('DENY');

    const missing = await new TestClient(harness.baseUrl).get('/does-not-exist');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('gives the documentation page its own policy, and nothing else that policy', async () => {
    const client = new TestClient(harness.baseUrl);

    const docsPolicy = (await client.get('/api-reference')).headers.get(
      'content-security-policy',
    ) as string;
    /**
     * Swagger UI is a vendored React application. Verified in a browser: it
     * loads its own bundle from this origin and injects a stylesheet at
     * runtime, so it needs inline STYLE and nothing more. Scripts stay
     * same-origin only, which is the half that decides whether an injection is
     * exploitable.
     */
    expect(docsPolicy).toContain("script-src 'self'");
    expect(docsPolicy).toContain("style-src 'self' 'unsafe-inline'");
    expect(docsPolicy).not.toContain("script-src 'self' 'unsafe-inline'");

    const api = await client.get('/api/v1');
    expect(api.headers.get('content-security-policy')).not.toContain('unsafe-inline');
  });
});

describe('cross-origin resource policy - EXIT GATE', () => {
  it('opens the widget surface, because that is the product', async () => {
    const loader = await new TestClient(harness.baseUrl).get('/widget/v1/loader.js');
    expect(loader.status).toBe(200);
    // helmet's default of `same-origin` here would make the loader unfetchable
    // from every customer website in existence.
    expect(loader.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  });

  it('opens the sandbox endpoints, which the demo origin reads', async () => {
    const feed = await new TestClient(harness.baseUrl).get('/demo/v1/feed');
    expect(feed.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  });

  it('keeps everything else same-origin', async () => {
    const client = new TestClient(harness.baseUrl);
    for (const path of ['/api/v1', '/health/live', '/api-reference', '/openapi.json']) {
      const response = await client.get(path);
      expect(response.headers.get('cross-origin-resource-policy'), path).toBe('same-origin');
    }
  });
});

describe('CORS and CSRF on the authenticated API (blueprint 17)', () => {
  it('never echoes a foreign origin back, so a hostile page cannot read a response', async () => {
    /**
     * The dashboard is same-origin with the API in every environment - blueprint
     * 5.1 puts them on one Render service - so the authenticated surface needs
     * no CORS at all, and the correct behaviour is to send no
     * `Access-Control-Allow-Origin` header whatsoever. A browser then refuses to
     * expose the response body to the calling page, whatever it contains.
     */
    const response = await new TestClient(harness.baseUrl).get('/api/v1/workspaces', {
      origin: 'https://evil.example.invalid',
    });

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('still refuses a state-changing request that carries no CSRF token', async () => {
    const actor = await verifiedUser('csrf-hdrs');
    const forged = await actor.api.post('/api/v1/workspaces', {
      name: 'Forged',
      timezone: 'Europe/Berlin',
    });
    expect(forged.status).toBe(403);
    expect((forged.body as { error: { code: string } }).error.code).toBe('csrf_invalid');
  }, 90_000);
});

describe('validated redirects and CTA destinations (blueprint 17)', () => {
  it('refuses a javascript:, data:, credentialed, and relative destination at the API', async () => {
    /**
     * The validator has unit coverage from Stage 5. What had none is the claim
     * that the API actually calls it - blueprint 17 lists "validated redirects
     * and CTA destinations" as a property of the system, not of a function.
     */
    const actor = await verifiedUser('redirects');
    const headers = await actor.api.csrfHeaders();

    expect(
      (
        await actor.api.post(
          '/api/v1/workspaces',
          { name: 'Redirect probe', timezone: 'Europe/Berlin' },
          headers,
        )
      ).status,
    ).toBe(201);

    const created = await actor.api.post(
      '/api/v1/widgets',
      { type: 'cta_popover', name: 'Redirect probe' },
      await actor.api.csrfHeaders(),
    );
    expect(created.status).toBe(201);

    const detail = created.body as {
      widget: { id: string };
      draft: { config: WidgetConfig; version: number };
    };

    for (const destination of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'https://user:password@bank.example.invalid/',
      '/pricing',
    ]) {
      const attempt = await actor.api.put(
        `/api/v1/widgets/${detail.widget.id}/draft`,
        {
          config: { ...detail.draft.config, ctaAction: { kind: 'url', url: destination } },
          expectedVersion: detail.draft.version,
        },
        await actor.api.csrfHeaders(),
      );
      expect(attempt.status, destination).toBe(400);
    }
  }, 120_000);
});

describe('the public widget surface still enforces its Origin allowlist', () => {
  it('never echoes an origin it did not authorise', async () => {
    // Confirming Stage 6's allowlist survives Stage 13 inserting middleware
    // ahead of every route in the application.
    const response = await new TestClient(harness.baseUrl).get('/widget/v1/config/w_doesnotexist', {
      origin: 'https://evil.example.invalid',
    });
    expect([403, 404]).toContain(response.status);
    expect(response.headers.get('access-control-allow-origin')).not.toBe(
      'https://evil.example.invalid',
    );
  });
});
