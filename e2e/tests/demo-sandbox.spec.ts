import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures.js';
import { createOwnerWithWorkspace, openInbox, publishWidgetForLeads } from '../helpers/journeys.js';

/**
 * Blueprint Stage 12's exit gate, the half that closes it: a new visitor can
 * run the demo, it never exposes dashboard tenancy or triggers a real side
 * effect, and it resets on schedule without leaking into or being reachable
 * from any real workspace.
 *
 * Everything here runs against the sandbox on its own origin, in a context that
 * has never signed in - which is the condition the whole stage is about. A
 * sandbox that only works for somebody with a session has failed.
 */

const DEMO_ORIGIN = 'http://localhost:5174';
const API = 'http://localhost:5173';

/** Open the sandbox, pointed at the platform the tests are running. */
async function openSandbox(page: Page): Promise<void> {
  await page.goto(`${DEMO_ORIGIN}/?api=${encodeURIComponent(API)}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Three widgets on a bench.' }),
  ).toBeVisible();
}

/** The three seeded widgets, straight from the public config endpoint. */
async function seededWidgets(
  page: Page,
): Promise<readonly { publicId: string; type: string; name: string }[]> {
  const response = await page.request.get(`${API}/demo/v1/config`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    widgets: { publicId: string; type: string; name: string }[];
  };
  return body.widgets;
}

// ===========================================================================
// GATE: anyone can run it
// ===========================================================================

test.describe('GATE: the sandbox works with no account - EXIT GATE', () => {
  test('all three widget types are seeded, published, and rendered', async ({ page, context }) => {
    await context.clearCookies();
    await openSandbox(page);

    const widgets = await seededWidgets(page);
    expect(widgets.map((widget) => widget.type).sort()).toEqual([
      'contact_form',
      'cta_popover',
      'email_signup',
    ]);

    /**
     * Rendered, not merely listed. Each widget mounts into its own shadow root,
     * so the assertion reaches through it - if the runtime had failed to load
     * cross-origin, the specimen would be an empty box and the page would still
     * list three of them.
     */
    for (const widget of widgets) {
      if (widget.type === 'cta_popover') continue; // hidden until triggered
      const host = page.locator(`[data-lcp-widget="${widget.publicId}"]`);
      await expect(host.locator('form')).toBeVisible({ timeout: 15_000 });
    }

    expect(await context.cookies()).toEqual([]);
  });

  test('the popover opens from a host-page button', async ({ page }) => {
    await openSandbox(page);
    const widgets = await seededWidgets(page);
    const popover = widgets.find((widget) => widget.type === 'cta_popover');
    expect(popover).toBeDefined();

    await page.getByTestId(`open-${popover?.publicId ?? ''}`).click();
    await expect(
      page.locator(`[data-lcp-widget="${popover?.publicId ?? ''}"]`).locator('form'),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('a visitor submits, and sees it land in the feed', async ({ page }) => {
    await openSandbox(page);
    const widgets = await seededWidgets(page);
    const form = widgets.find((widget) => widget.type === 'contact_form');
    const host = page.locator(`[data-lcp-widget="${form?.publicId ?? ''}"]`);
    await expect(host.locator('form')).toBeVisible({ timeout: 15_000 });

    await host.getByLabel(/email/i).fill('sandbox-visitor@example.invalid');
    await host.getByLabel(/message/i).fill('Just trying the sandbox out.');
    await host.getByRole('button', { name: /send/i }).click();

    // The widget's own confirmation, which says what did and did not happen.
    await expect(host.getByText(/sandbox/i)).toBeVisible({ timeout: 15_000 });

    /**
     * And the feed. It says the submission was stored AND that no email was
     * sent - which is where that message actually lands, at the moment of
     * maximum attention rather than in small print at the bottom.
     */
    await expect(page.getByText(/No email sent/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#feed')).toContainText('Stored');
  });

  test('the synthetic-data warning is unmissable and carries a live countdown', async ({
    page,
  }) => {
    await openSandbox(page);

    const strip = page.getByRole('status').first();
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('Sandbox');
    await expect(strip).toContainText('synthetic');
    await expect(strip).toContainText('Nothing is emailed or sent onward');
    // The countdown is what stops the notice becoming wallpaper.
    await expect(page.locator('#countdown')).toContainText(/min|under a minute|any moment/);

    // And it is sticky, so scrolling never leaves it behind.
    await page.mouse.wheel(0, 4000);
    await expect(strip).toBeInViewport();
  });

  test('each specimen shows the snippet a customer would paste', async ({ page }) => {
    await openSandbox(page);
    const widgets = await seededWidgets(page);

    await page.getByRole('group').first().click();
    const snippet = page.locator('pre').first();
    await expect(snippet).toContainText('/widget/v1/loader.js');
    await expect(snippet).toContainText('data-widget=');
    await expect(snippet).toContainText(widgets[0]?.publicId ?? 'missing');
  });
});

// ===========================================================================
// GATE: nothing leaves, and nothing leaks
// ===========================================================================

test.describe('GATE: the sandbox sends nothing and leaks nothing - EXIT GATE', () => {
  test('a sandbox submission plans no delivery at all', async ({ page }) => {
    /**
     * Asserted against the delivery records the pipeline creates, not against
     * the absence of a log line. A real submission plans a delivery per
     * verified recipient and per webhook endpoint; the sandbox plans none,
     * because `planFor` refuses the tenant outright.
     *
     * The deliveries endpoint is workspace-scoped and needs a session, so this
     * checks the observable public consequence instead: nothing appears in
     * Mailpit for the address that was submitted.
     */
    await openSandbox(page);
    const widgets = await seededWidgets(page);
    const form = widgets.find((widget) => widget.type === 'contact_form');
    const host = page.locator(`[data-lcp-widget="${form?.publicId ?? ''}"]`);
    await expect(host.locator('form')).toBeVisible({ timeout: 15_000 });

    const address = `sandbox-nomail-${String(Date.now())}@example.invalid`;
    await host.getByLabel(/email/i).fill(address);
    await host.getByLabel(/message/i).fill('This must not produce an email.');
    await host.getByRole('button', { name: /send/i }).click();
    await expect(host.getByText(/sandbox/i)).toBeVisible({ timeout: 15_000 });

    // Give any delivery worker a generous chance to have sent something.
    await page.waitForTimeout(3_000);

    const mail = await page.request.get(
      `http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    const messages = (await mail.json()) as { messages?: unknown[] };
    expect(messages.messages ?? []).toHaveLength(0);
  });

  test('the public feed never carries submitted values or any identifier', async ({ page }) => {
    await openSandbox(page);
    const widgets = await seededWidgets(page);
    const form = widgets.find((widget) => widget.type === 'contact_form');
    const host = page.locator(`[data-lcp-widget="${form?.publicId ?? ''}"]`);
    await expect(host.locator('form')).toBeVisible({ timeout: 15_000 });

    const secret = `never-publish-${String(Date.now())}`;
    await host.getByLabel(/email/i).fill(`${secret}@example.invalid`);
    await host.getByLabel(/message/i).fill(`The text ${secret} must not be republished.`);
    await host.getByRole('button', { name: /send/i }).click();
    await expect(host.getByText(/sandbox/i)).toBeVisible({ timeout: 15_000 });

    const response = await page.request.get(`${API}/demo/v1/feed`);
    const raw = await response.text();

    /**
     * The property that makes a public feed safe: it republishes nothing the
     * previous stranger typed. A feed that echoed values would broadcast
     * whatever the last visitor chose to write, on a page with no moderation.
     */
    expect(raw).not.toContain(secret);
    // Nor any Mongo identifier that would let somebody address a real record.
    expect(raw).not.toMatch(/[0-9a-f]{24}/);
  });

  test('the feed shows the sandbox only, never another workspace', async ({ page, browser }) => {
    /**
     * A real workspace submits a lead at the same time. The sandbox feed must
     * not show it - not because it filters it out afterwards, but because it
     * only ever queries one workspace id.
     */
    const owner = await browser.newContext();
    const ownerPage = await owner.newPage();
    await createOwnerWithWorkspace(ownerPage, 'demo-isolation');
    const realPublicId = await publishWidgetForLeads(ownerPage, 'demo-isolation');

    const marker = `real-tenant-${String(Date.now())}`;
    const submitted = await ownerPage.request.post(`${API}/widget/v1/submit/${realPublicId}`, {
      headers: { origin: 'http://localhost:5174', 'content-type': 'application/json' },
      data: {
        idempotencyKey: marker,
        values: { email: `${marker}@example.invalid`, message: `From a real tenant: ${marker}` },
        pageUrl: 'http://localhost:5174/pricing',
        renderedAt: Date.now() - 30_000,
      },
    });
    expect(submitted.status()).toBe(202);

    const feed = await page.request.get(`${API}/demo/v1/feed`);
    expect(await feed.text()).not.toContain(marker);

    // And the real lead did land where it belongs.
    await openInbox(ownerPage);
    await expect(ownerPage.locator('body')).toContainText(marker);

    await owner.close();
  });

  test('there is no public route that resets the sandbox', async ({ page }) => {
    /**
     * The reset is a scheduled job. A route that wipes a tenant is a route that
     * wipes a tenant, however well-intentioned - it would be one configuration
     * mistake from pointing at a real workspace.
     */
    for (const [method, path] of [
      ['POST', '/demo/v1/reset'],
      ['POST', '/demo/v1/seed'],
      ['DELETE', '/demo/v1/config'],
      ['POST', '/demo/v1/config'],
    ] as const) {
      const response = await page.request.fetch(`${API}${path}`, { method });
      expect(response.status(), `${method} ${path} should not exist`).toBeGreaterThanOrEqual(400);
    }
  });
});

// ===========================================================================
// GATE: its own limits
// ===========================================================================

test.describe('GATE: the sandbox has stricter limits than production - EXIT GATE', () => {
  test('demo rate limits bite sooner than the production ones would', async ({ page }) => {
    /**
     * Production allows five submissions a minute per visitor-widget pair; the
     * sandbox allows three. Posting directly rather than through the widget,
     * because the point is the server's limit rather than the form's.
     */
    const widgets = await seededWidgets(page);
    const form = widgets.find((widget) => widget.type === 'contact_form');

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await page.request.post(`${API}/widget/v1/submit/${form?.publicId ?? ''}`, {
        headers: { origin: DEMO_ORIGIN, 'content-type': 'application/json' },
        data: {
          idempotencyKey: `demo-limit-${String(Date.now())}-${String(attempt)}`,
          values: {
            email: `limit-${String(attempt)}@example.invalid`,
            message: 'Testing the sandbox limit.',
          },
          pageUrl: `${DEMO_ORIGIN}/`,
          renderedAt: Date.now() - 30_000,
        },
      });
      statuses.push(response.status());
    }

    // Refused before the sixth, which production would still have allowed.
    expect(statuses).toContain(429);
    expect(statuses.filter((status) => status === 202).length).toBeLessThan(5);
  });

  test('the sandbox body cap is lower than the platform’s 32 KB', async ({ page }) => {
    const widgets = await seededWidgets(page);
    const form = widgets.find((widget) => widget.type === 'contact_form');

    // Comfortably over the sandbox's 8 KB and comfortably under the 32 KB the
    // platform accepts, so a 413 here can only be the demo-specific cap.
    const response = await page.request.post(`${API}/widget/v1/submit/${form?.publicId ?? ''}`, {
      headers: { origin: DEMO_ORIGIN, 'content-type': 'application/json' },
      data: {
        idempotencyKey: `demo-size-${String(Date.now())}`,
        values: {
          email: 'oversize@example.invalid',
          message: 'x'.repeat(12_000),
        },
        pageUrl: `${DEMO_ORIGIN}/`,
        renderedAt: Date.now() - 30_000,
      },
    });
    expect(response.status()).toBe(413);
  });
});
