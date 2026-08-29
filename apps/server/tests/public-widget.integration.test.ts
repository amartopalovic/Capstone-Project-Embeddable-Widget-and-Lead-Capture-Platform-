import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PublicWidgetResponse, WidgetConfig, WidgetDetail } from '@lcp/contracts';
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
 * The public widget surface (blueprint 7.2, 8.2, 17).
 *
 * Step 5 of the load path is what most of this file checks: "The backend
 * confirms the widget is published, not deleted, within quota, and permitted
 * for that Origin." Each of those is a separate test, because each is a
 * separate way for a widget to leak onto a site it does not belong on.
 */

let harness: AuthHarness;

beforeAll(async () => {
  harness = await createAuthHarness();
}, 120_000);

beforeEach(async () => {
  await harness.clearRateLimits();
});

afterAll(async () => {
  await harness?.teardown();
});

const ALLOWED_ORIGIN = 'https://shop.example.com';

interface Owner {
  readonly api: TestClient;
  readonly email: string;
}

async function verifiedOwner(label: string): Promise<Owner> {
  const email = uniqueEmail(label);
  const api = new TestClient(harness.baseUrl);

  await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
  const message = await waitForEmail(email, (m) => m.Subject.includes('Confirm'));
  await api.post('/api/v1/auth/verify', { token: extractToken(await mailpitBody(message.ID)) });
  await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });

  const created = await api.post(
    '/api/v1/workspaces',
    { name: `${label} workspace`, timezone: 'Europe/Berlin' },
    await api.csrfHeaders(),
  );
  expect(created.status).toBe(201);
  return { api, email };
}

/** A published widget whose allowlist contains ALLOWED_ORIGIN's host. */
async function publishedWidget(
  label: string,
  type = 'contact_form',
  domains: string[] = ['shop.example.com'],
): Promise<{ owner: Owner; widgetId: string; publicId: string }> {
  const owner = await verifiedOwner(label);

  const created = await owner.api.post(
    '/api/v1/widgets',
    { type, name: `${label} widget` },
    await owner.api.csrfHeaders(),
  );
  expect(created.status).toBe(201);
  const detail = created.body as WidgetDetail;
  const draft = detail.draft;
  if (draft === null) throw new Error('expected a draft');

  const config: WidgetConfig = {
    ...draft.config,
    headline: 'Talk to us',
    targeting: { ...draft.config.targeting, allowedDomains: domains },
  };

  const saved = await owner.api.put(
    `/api/v1/widgets/${detail.widget.id}/draft`,
    { config, expectedVersion: draft.version },
    await owner.api.csrfHeaders(),
  );
  expect(saved.status).toBe(200);

  const published = await owner.api.post(
    `/api/v1/widgets/${detail.widget.id}/publish`,
    { expectedVersion: (saved.body as { version: number }).version },
    await owner.api.csrfHeaders(),
  );
  expect(published.status).toBe(200);

  return { owner, widgetId: detail.widget.id, publicId: detail.widget.publicId };
}

function anonymous(): TestClient {
  // A visitor has no session, so this client deliberately carries no cookies
  // from the dashboard flows above.
  return new TestClient(harness.baseUrl);
}

// ---------------------------------------------------------------------------

describe('public config: what it serves (blueprint 7.2)', () => {
  it('serves a published widget to an allowed Origin, with the cache contract', async () => {
    const { publicId } = await publishedWidget('pub-serve');

    const response = await anonymous().get(`/widget/v1/config/${publicId}`, {
      origin: ALLOWED_ORIGIN,
    });

    expect(response.status).toBe(200);
    const body = response.body as PublicWidgetResponse;
    expect(body.publicId).toBe(publicId);
    expect(body.config.headline).toBe('Talk to us');
    expect(body.revision).toBeGreaterThan(0);

    // Blueprint 8.2: 60 seconds plus an ETag.
    expect(response.headers.get('cache-control')).toContain('max-age=60');
    expect(response.headers.get('etag')).toBeTruthy();

    // The answer depends on Origin, so a shared cache must not reuse it across
    // sites - and CORS is granted only after the allowlist check passed.
    expect(response.headers.get('vary')).toContain('Origin');
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
  });

  it('answers 304 when the client revalidates an unchanged config', async () => {
    const { publicId } = await publishedWidget('pub-etag');
    const client = anonymous();

    const first = await client.get(`/widget/v1/config/${publicId}`, { origin: ALLOWED_ORIGIN });
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const second = await client.get(`/widget/v1/config/${publicId}`, {
      origin: ALLOWED_ORIGIN,
      'if-none-match': etag ?? '',
    });
    expect(second.status).toBe(304);
  });

  it('never leaks anything private (blueprint 7.2, 17)', async () => {
    const { publicId } = await publishedWidget('pub-private');

    const response = await anonymous().get(`/widget/v1/config/${publicId}`, {
      origin: ALLOWED_ORIGIN,
    });
    const raw = JSON.stringify(response.body);

    /**
     * The allowlist is the interesting omission. It is not secret, but it is
     * not renderable either, and shipping it to the client it constrains
     * invites tampering. Everything else here is a tenant identifier that a
     * visitor has no business seeing.
     */
    expect(raw).not.toContain('allowedDomains');
    expect(raw).not.toContain('shop.example.com');
    expect(raw).not.toContain('workspaceId');
    expect(raw).not.toContain('ownerUserId');
    expect(raw).not.toContain('_id');

    // What it DOES contain is only renderable settings.
    const body = response.body as PublicWidgetResponse;
    expect(Object.keys(body.config).sort()).toEqual(
      [
        'appearance',
        'body',
        'ctaAction',
        'fields',
        'formMode',
        'headline',
        'submitLabel',
        'success',
        'targeting',
        'triggers',
      ].sort(),
    );
    expect(Object.keys(body.config.targeting).sort()).toEqual(
      ['cooldown', 'excludePatterns', 'includePatterns'].sort(),
    );
  });
});

describe('public config: who it refuses (blueprint 7.2 step 5)', () => {
  it('refuses an Origin that is not on the widget allowlist', async () => {
    const { publicId } = await publishedWidget('pub-origin');

    const response = await anonymous().get(`/widget/v1/config/${publicId}`, {
      origin: 'https://not-allowed.example.org',
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses a request with no Origin at all', async () => {
    // Browsers send Origin on cross-origin requests, so its absence means this
    // is not the browser fetch the endpoint exists to serve.
    const { publicId } = await publishedWidget('pub-noorigin');
    expect((await anonymous().get(`/widget/v1/config/${publicId}`)).status).toBe(403);
  });

  it('honours the wildcard rule, where *.example.com excludes the apex', async () => {
    const { publicId } = await publishedWidget('pub-wildcard', 'contact_form', ['*.example.com']);
    const client = anonymous();

    expect(
      (await client.get(`/widget/v1/config/${publicId}`, { origin: 'https://shop.example.com' }))
        .status,
    ).toBe(200);
    // Blueprint 4.4: the wildcard does not cover the bare domain.
    expect(
      (await client.get(`/widget/v1/config/${publicId}`, { origin: 'https://example.com' })).status,
    ).toBe(403);
  });

  it('gives an unknown identifier the same answer as an unpublished one', async () => {
    const client = anonymous();
    const unknown = await client.get('/widget/v1/config/w_notarealwidgetid', {
      origin: ALLOWED_ORIGIN,
    });
    expect(unknown.status).toBe(404);

    // A real but never-published widget answers identically, so the endpoint
    // cannot be used to discover which identifiers exist.
    const owner = await verifiedOwner('pub-unpublished');
    const created = await owner.api.post(
      '/api/v1/widgets',
      { type: 'email_signup', name: 'Never published' },
      await owner.api.csrfHeaders(),
    );
    const detail = created.body as WidgetDetail;

    const draft = await client.get(`/widget/v1/config/${detail.widget.publicId}`, {
      origin: ALLOWED_ORIGIN,
    });
    expect(draft.status).toBe(404);

    // Same code and same wording. Only the correlation id differs, which is
    // per-request and carries nothing about the widget.
    const shape = (body: unknown): { code: string; message: string } => {
      const error = (body as { error: { code: string; message: string } }).error;
      return { code: error.code, message: error.message };
    };
    expect(shape(draft.body)).toEqual(shape(unknown.body));
  });

  it('stops serving the moment a widget is unpublished (blueprint 8.2)', async () => {
    const { owner, widgetId, publicId } = await publishedWidget('pub-unpub');
    const client = anonymous();

    expect(
      (await client.get(`/widget/v1/config/${publicId}`, { origin: ALLOWED_ORIGIN })).status,
    ).toBe(200);

    expect(
      (
        await owner.api.post(
          `/api/v1/widgets/${widgetId}/unpublish`,
          undefined,
          await owner.api.csrfHeaders(),
        )
      ).status,
    ).toBe(200);

    // "A briefly cached config cannot bypass unpublishing" - the server itself
    // stops answering immediately; only an already-delivered copy can be stale.
    expect(
      (await client.get(`/widget/v1/config/${publicId}`, { origin: ALLOWED_ORIGIN })).status,
    ).toBe(404);
  });

  it('stops serving a soft-deleted widget', async () => {
    const { owner, widgetId, publicId } = await publishedWidget('pub-deleted');

    expect(
      (await owner.api.delete(`/api/v1/widgets/${widgetId}`, await owner.api.csrfHeaders())).status,
    ).toBe(200);

    expect(
      (await anonymous().get(`/widget/v1/config/${publicId}`, { origin: ALLOWED_ORIGIN })).status,
    ).toBe(404);
  });

  it('stops serving every widget in a deleted workspace', async () => {
    const { owner, publicId } = await publishedWidget('pub-deadtenant');

    expect(
      (await owner.api.delete('/api/v1/workspaces/current', await owner.api.csrfHeaders())).status,
    ).toBe(200);

    expect(
      (await anonymous().get(`/widget/v1/config/${publicId}`, { origin: ALLOWED_ORIGIN })).status,
    ).toBe(404);
  });

  it('reflects an updated allowed-domain rule immediately', async () => {
    const { owner, widgetId, publicId } = await publishedWidget('pub-domainchange');
    const client = anonymous();

    expect(
      (await client.get(`/widget/v1/config/${publicId}`, { origin: ALLOWED_ORIGIN })).status,
    ).toBe(200);

    // Republish with a different allowlist.
    const detail = (await owner.api.get(`/api/v1/widgets/${widgetId}`)).body as WidgetDetail;
    const source = detail.published;
    if (source === null) throw new Error('expected a published revision');

    const saved = await owner.api.put(
      `/api/v1/widgets/${widgetId}/draft`,
      {
        config: {
          ...source.config,
          targeting: { ...source.config.targeting, allowedDomains: ['elsewhere.example.net'] },
        },
        expectedVersion: 0,
      },
      await owner.api.csrfHeaders(),
    );
    expect(saved.status).toBe(200);
    expect(
      (
        await owner.api.post(
          `/api/v1/widgets/${widgetId}/publish`,
          { expectedVersion: (saved.body as { version: number }).version },
          await owner.api.csrfHeaders(),
        )
      ).status,
    ).toBe(200);

    expect(
      (await client.get(`/widget/v1/config/${publicId}`, { origin: ALLOWED_ORIGIN })).status,
    ).toBe(403);
  });
});

describe('loader and runtime assets (blueprint 8.2)', () => {
  it('serves the loader with a 5-minute cache and points it at the hashed runtime', async () => {
    const response = await anonymous().get('/widget/v1/loader.js');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
    expect(response.headers.get('cache-control')).toContain('max-age=300');

    const source = String(response.body);
    expect(source).toContain('data-widget');
    expect(source).toMatch(/runtime\.[0-9a-f]{16}\.js/);
    // Blueprint 8.1: one runtime per page however many tags there are.
    expect(source).toContain('__LCP_WIDGET_LOADER__');
  });

  it('serves the runtime as immutable for a year, under its content hash', async () => {
    const client = anonymous();
    const loader = String((await client.get('/widget/v1/loader.js')).body);
    const hash = /runtime\.([0-9a-f]{16})\.js/.exec(loader)?.[1];
    expect(hash).toBeTruthy();

    const response = await client.get(`/widget/v1/runtime.${hash ?? ''}.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('max-age=31536000');
    expect(response.headers.get('cache-control')).toContain('immutable');
  });

  it('refuses a hash that is not the current build, rather than serving it anyway', async () => {
    // Serving current bytes under an old URL would break the immutability
    // promise a one-year cache depends on.
    const response = await anonymous().get('/widget/v1/runtime.0000000000000000.js');
    expect(response.status).toBe(404);
  });

  it('needs no session or CSRF token, because a visitor has neither', async () => {
    const { publicId } = await publishedWidget('pub-anon');
    const client = anonymous();

    expect((await client.get('/widget/v1/loader.js')).status).toBe(200);
    expect(
      (await client.get(`/widget/v1/config/${publicId}`, { origin: ALLOWED_ORIGIN })).status,
    ).toBe(200);
    expect(client.cookieHeader).toBe('');
  });
});
