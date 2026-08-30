import { expect, test } from '../fixtures.js';

/**
 * Stage 12a's exit gate: a new visitor can understand the product, find the
 * install and API documentation, and read the required policy pages - without
 * assistance and without an account.
 *
 * Every test in this file uses a browser context that has never signed in. That
 * is the whole point: a page that only works once a session exists has failed
 * the gate, however good it looks when a developer checks it while logged in.
 */

// ===========================================================================
// GATE: a stranger can understand and navigate the product
// ===========================================================================

test.describe('GATE: the public site works with no account - EXIT GATE', () => {
  test('the landing page explains the product and shows what you install', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { level: 1, name: /Put a form on someone else’s website/ }),
    ).toBeVisible();

    /**
     * The embed snippet is the hero, and it has to be the REAL one. A landing
     * page showing a subtly different tag teaches people to paste something
     * that does not work, so this pins the parts that matter: the loader path
     * and the attribute the runtime actually looks for.
     */
    const snippet = page.getByText('/widget/v1/loader.js');
    await expect(snippet).toBeVisible();
    await expect(snippet).toContainText('data-widget=');
    await expect(snippet).toContainText('async');

    // The journey, in order, because the order is the argument.
    for (const stage of ['Install', 'Submit', 'Work', 'Measure', 'Deliver, then forget']) {
      await expect(page.getByText(stage, { exact: false }).first()).toBeVisible();
    }
  });

  test('the portfolio and free-tier disclosure is on the landing page, not buried', async ({
    page,
  }) => {
    /**
     * Blueprint 5.2 requires the free-tier posture to be disclosed honestly.
     * Asserted as being above the fold-ish content rather than only in the
     * footer, because a disclosure nobody reaches is not a disclosure.
     */
    await page.goto('/');

    const notice = page.getByRole('heading', { name: 'Read this first' });
    await expect(notice).toBeVisible();

    const body = page.locator('body');
    await expect(body).toContainText('portfolio project');
    await expect(body).toContainText('no service level agreement');
    await expect(body).toContainText('Synthetic data only');
  });

  test('a visitor can reach every documentation page from the landing page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Read the install guide' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Install a widget' })).toBeVisible();

    // And from there, the rest of the docs through the persistent nav.
    const nav = page.getByRole('navigation', { name: 'Documentation' });
    for (const [label, heading] of [
      ['Domains and targeting', 'Domains and targeting'],
      ['Consent and unsubscribe', 'Consent and unsubscribe'],
      ['Webhooks', 'Webhooks'],
      ['Troubleshooting', 'Troubleshooting'],
      ['API reference', 'API reference'],
    ] as const) {
      await nav.getByRole('link', { name: label }).click();
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
  });

  test('a visitor can read all four policy pages', async ({ page }) => {
    await page.goto('/');

    // Reached from the footer, which is where somebody actually looks for them.
    await page.getByRole('link', { name: 'Privacy', exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Policies' });
    for (const [label, heading] of [
      ['Terms', 'Terms'],
      ['Storage and cookies', 'Storage and cookies'],
      ['Acceptable use', 'Acceptable use'],
    ] as const) {
      await nav.getByRole('link', { name: label }).click();
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
  });

  test('the webhook guide gives a worked signature check, not just prose', async ({ page }) => {
    /**
     * The one place in the documentation where being vague would cause real
     * harm: a receiver that compares signatures with `===`, signs the parsed
     * body, or ignores the timestamp is insecure in a way that looks like it
     * works.
     */
    await page.goto('/docs/webhooks');

    const body = page.locator('body');
    await expect(body).toContainText('x-lcp-signature');
    await expect(body).toContainText('x-lcp-timestamp');
    await expect(body).toContainText('timingSafeEqual');
    await expect(body).toContainText('compare_digest');
    // The three failure modes are named, not left to be discovered.
    await expect(body).toContainText('raw request body');
    await expect(body).toContainText('constant time');
    await expect(body).toContainText('replays forever');
  });

  test('a code sample can be copied', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/docs/webhooks');

    await page.getByRole('button', { name: 'Copy' }).first().click();
    // The result is announced rather than only shown, so a screen reader
    // learns it too.
    await expect(page.getByText('Copied to the clipboard.')).toBeVisible();
  });
});

// ===========================================================================
// GATE: the API contract is browsable without an account
// ===========================================================================

test.describe('GATE: the API contract is public - EXIT GATE', () => {
  test('Swagger UI opens from the docs and renders this API', async ({ page }) => {
    await page.goto('/docs/api');
    await page.getByRole('link', { name: 'Open Swagger UI' }).click();

    // Swagger UI is a client-side app; wait for it to have rendered the
    // document rather than merely for the page to have loaded.
    await expect(page.locator('#swagger-ui')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Lead Capture Platform API/ })).toBeVisible({
      timeout: 20_000,
    });

    // The real groups from blueprint 10.2, which proves it loaded OUR document
    // rather than the package's default petstore example.
    for (const tag of ['Authentication', 'Widgets', 'Public widget', 'Privacy']) {
      await expect(page.getByRole('heading', { name: tag, exact: false }).first()).toBeVisible();
    }
    await expect(page.locator('body')).not.toContainText('Swagger Petstore');
  });

  test('the OpenAPI document is served as JSON to anyone', async ({ page }) => {
    const response = await page.request.get('/api/v1/openapi.json');
    expect(response.status()).toBe(200);

    const document = (await response.json()) as {
      openapi: string;
      info: { title: string };
      paths: Record<string, unknown>;
    };
    expect(document.openapi).toMatch(/^3\.1\./);
    expect(document.info.title).toBe('Lead Capture Platform API');
    // The real surface, not a stub.
    expect(Object.keys(document.paths).length).toBeGreaterThan(50);
    expect(document.paths['/widget/v1/submit/{publicId}']).toBeDefined();
    expect(document.paths['/api/v1/contacts']).toBeDefined();
  });

  test('none of the public site needs a session', async ({ page, context }) => {
    /**
     * The gate in one test. Cookies are cleared first, so nothing here can
     * pass on the strength of a session left behind by an earlier test.
     */
    await context.clearCookies();

    for (const path of [
      '/',
      '/docs/install',
      '/docs/domains',
      '/docs/consent',
      '/docs/webhooks',
      '/docs/api',
      '/docs/troubleshooting',
      '/policies/privacy',
      '/policies/terms',
      '/policies/storage',
      '/policies/acceptable-use',
    ]) {
      await page.goto(path);
      // Not bounced to sign-in, and the page rendered its own heading.
      await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/$' : path}`));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }

    expect(await context.cookies()).toEqual([]);
  });

  test('the public site exposes no tenant data', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/');
    // Nothing that would only exist if a workspace were being read.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('@example.invalid');
    expect(body).not.toMatch(/[0-9a-f]{24}/);
  });
});
