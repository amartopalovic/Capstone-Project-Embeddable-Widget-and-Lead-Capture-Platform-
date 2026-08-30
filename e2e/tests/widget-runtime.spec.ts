import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures.js';
import {
  addAllowedDomain,
  createOwnerWithWorkspace,
  createWidget,
  publishWidget,
  saveDraft,
} from '../helpers/journeys.js';

/**
 * The public widget runtime, on a genuinely separate origin
 * (blueprint 7.2, 8.1, 18.3 journey 4).
 *
 * Everything here runs against `apps/demo` on port 5174 while the platform runs
 * on 5173. That separation is the whole point: a same-origin test would prove
 * nothing about the Origin allowlist, CORS, or the fact that the widget is a
 * guest on a page it does not control.
 *
 * The demo page is deliberately hostile - it resets `box-sizing` globally,
 * restyles every input with `!important`, and reuses the class name `.panel`
 * that the widget's own stylesheet uses internally. If Shadow DOM isolation
 * were not working, these tests would fail loudly rather than subtly.
 */

const DEMO_ORIGIN = 'http://localhost:5174';

/** Publish a widget through the dashboard and return its public id. */
async function publishFor(
  page: Page,
  label: string,
  type: 'Contact form' | 'Email signup' | 'CTA popover',
  tweak?: (page: Page) => Promise<void>,
): Promise<string> {
  await createWidget(page, type, `${label} widget`);
  // localhost is the demo's host, so the allowlist must admit it.
  await addAllowedDomain(page, 'localhost');
  if (tweak !== undefined) await tweak(page);
  await saveDraft(page);
  await publishWidget(page);

  const publicId = (await page.locator('main p.font-mono').first().innerText())
    .split('·')[0]
    ?.trim();
  expect(publicId).toMatch(/^w_[a-z2-9]{16}$/);
  return publicId ?? '';
}

/**
 * Open the hostile-CSS fixture with the given widgets installed.
 *
 * `/fixture.html`, not `/`. Stage 12b gave `/` to the public sandbox, and these
 * tests need the opposite of a well-behaved page: global `box-sizing`
 * overrides, `!important` on every input, and a `.panel` class that collides
 * with the widget's own internals. A sandbox a visitor is meant to enjoy cannot
 * be that page, so the two live at different URLs on the same origin.
 */
async function openDemo(page: Page, publicIds: readonly string[]): Promise<void> {
  const query = new URLSearchParams({ w: publicIds.join(','), api: 'http://localhost:5173' });
  await page.goto(`${DEMO_ORIGIN}/fixture.html?${query.toString()}`);
}

/**
 * Wait until the runtime has mounted this widget.
 *
 * A modal or popover renders nothing until its trigger fires, so there is no
 * element to wait on - and the loader, runtime, and config are three async
 * hops. Asking the registry is the deterministic version of the sleep this
 * would otherwise need, and it also states the real precondition: a click
 * trigger cannot work before the runtime that wires it has loaded.
 */
async function waitForWidgetReady(page: Page, publicId: string): Promise<void> {
  await page.waitForFunction((id) => {
    const registry = (
      window as unknown as { __LCP_WIDGET_REGISTRY__?: { instances: Map<string, unknown> } }
    ).__LCP_WIDGET_REGISTRY__;
    return registry !== undefined && registry.instances.has(id);
  }, publicId);
}

/** The widget's shadow root host for one public id. */
function widgetHost(page: Page, publicId: string) {
  return page.locator(`[data-lcp-widget="${publicId}"]`);
}

// ---------------------------------------------------------------------------

test.describe('rendering on a separate origin - EXIT GATE', () => {
  test('a contact form renders inline on the demo origin', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'rt-contact');
    const publicId = await publishFor(page, 'Contact', 'Contact form');

    await openDemo(page, [publicId]);

    // Playwright pierces open shadow roots, so this is the real rendered DOM.
    const host = widgetHost(page, publicId);
    await expect(host).toBeAttached();
    await expect(host.getByRole('heading', { name: 'Get in touch' })).toBeVisible();
    await expect(host.getByLabel('Email')).toBeVisible();
    await expect(host.getByLabel('Message')).toBeVisible();
    await expect(host.getByRole('button', { name: 'Send message' })).toBeVisible();

    // It really is a shadow root, not markup spliced into the page.
    const isShadow = await host.evaluate((node) => node.shadowRoot !== null);
    expect(isShadow).toBe(true);
  });

  test('an email signup renders with only the fields it declares', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'rt-signup');
    const publicId = await publishFor(page, 'Signup', 'Email signup');

    await openDemo(page, [publicId]);

    const host = widgetHost(page, publicId);
    await expect(host.getByRole('heading', { name: 'Subscribe for updates' })).toBeVisible();
    await expect(host.getByLabel('Email')).toBeVisible();
    // A signup form has no message field, so none should be rendered.
    await expect(host.getByLabel('Message')).toHaveCount(0);
  });

  test('a CTA popover renders as a floating panel and links out safely', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'rt-cta');
    const publicId = await publishFor(page, 'CTA', 'CTA popover', async (builder) => {
      await builder.getByLabel('Button action').selectOption('external_url');
      await builder.getByLabel('Destination').fill('https://example.com/book');
      // Open promptly so the test does not wait on the default delay.
      await builder.getByLabel('Seconds').fill('0');
    });

    await openDemo(page, [publicId]);

    const host = widgetHost(page, publicId);
    const link = host.getByRole('link', { name: 'Request a call' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://example.com/book');
    // Opening a customer's destination must not hand it our window.
    await expect(link).toHaveAttribute('rel', /noopener/);

    // Floating, not inline: it is positioned against the viewport.
    const position = await host.evaluate(
      (node) =>
        node.shadowRoot?.querySelector('.floating') !== null &&
        node.shadowRoot?.querySelector('.floating') !== undefined,
    );
    expect(position).toBe(true);
  });
});

test.describe('isolation from the host page - EXIT GATE', () => {
  test('hostile host CSS does not reach into the widget', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'rt-isolation');
    const publicId = await publishFor(page, 'Isolated', 'Contact form');

    await openDemo(page, [publicId]);
    const host = widgetHost(page, publicId);
    await expect(host.getByRole('heading', { name: 'Get in touch' })).toBeVisible();

    // The host page sets `input { font-size: 40px !important; color: red }`.
    // Inside the shadow root the widget's own rules win.
    const inputStyles = await host.getByLabel('Email').evaluate((node) => {
      const computed = window.getComputedStyle(node);
      return { fontSize: computed.fontSize, color: computed.color, boxSizing: computed.boxSizing };
    });
    expect(inputStyles.fontSize).not.toBe('40px');
    expect(inputStyles.color).not.toBe('rgb(179, 38, 30)');
    // The host's global `* { box-sizing: content-box !important }` is defeated
    // by :host resetting it, which is why the widget states it explicitly.
    expect(inputStyles.boxSizing).toBe('border-box');

    // The host's `h2 { letter-spacing: 10px }` does not reach the headline.
    const headingSpacing = await host
      .getByRole('heading', { name: 'Get in touch' })
      .evaluate((node) => window.getComputedStyle(node).letterSpacing);
    expect(headingSpacing).not.toBe('10px');
  });

  test('widget CSS does not leak out onto the host page', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'rt-leak');
    const publicId = await publishFor(page, 'Contained', 'Contact form');

    await openDemo(page, [publicId]);
    await expect(widgetHost(page, publicId)).toBeAttached();

    /**
     * The host page has its own `.panel`, the same class the widget uses
     * internally. If the widget's stylesheet were global, this element would
     * take the widget's white background and lose its dashed border.
     */
    const hostPanel = await page.getByTestId('host-panel').evaluate((node) => {
      const computed = window.getComputedStyle(node);
      return { background: computed.backgroundColor, border: computed.borderStyle };
    });
    expect(hostPanel.background).toBe('rgb(255, 224, 138)');
    expect(hostPanel.border).toBe('dashed');

    // And the host's own button keeps the host's styling.
    const hostButton = await page
      .getByTestId('host-button')
      .evaluate((node) => window.getComputedStyle(node).fontSize);
    expect(hostButton).toBe('40px');
  });
});

test.describe('multiple instances share one runtime - EXIT GATE', () => {
  test('two widgets coexist on one page with one runtime load', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'rt-multi');
    const first = await publishFor(page, 'First', 'Contact form');
    const second = await publishFor(page, 'Second', 'Email signup');

    const requests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/widget/v1/')) requests.push(url);
    });

    await openDemo(page, [first, second]);

    // Both rendered, each in its own shadow root.
    await expect(
      widgetHost(page, first).getByRole('heading', { name: 'Get in touch' }),
    ).toBeVisible();
    await expect(
      widgetHost(page, second).getByRole('heading', { name: 'Subscribe for updates' }),
    ).toBeVisible();

    const roots = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('[data-lcp-widget]')).filter(
          (node) => node.shadowRoot !== null,
        ).length,
    );
    expect(roots).toBe(2);

    /**
     * Blueprint 8.1: "The loader maintains a page-level registry so multiple
     * script tags share one runtime." Two snippet tags, but the runtime bundle
     * is fetched once - and each widget still fetches its own config.
     */
    const runtimeLoads = requests.filter((url) => /runtime\.[0-9a-f]{16}\.js/.test(url));
    expect(runtimeLoads).toHaveLength(1);

    const configLoads = requests.filter((url) => url.includes('/widget/v1/config/'));
    expect(configLoads).toHaveLength(2);
  });
});

test.describe('the cache contract, as delivered to a browser (blueprint 8.2)', () => {
  test('loader, runtime, and config carry the headers the contract specifies', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'rt-cache');
    const publicId = await publishFor(page, 'Cached', 'Contact form');

    const headers = new Map<string, Record<string, string>>();
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/widget/v1/')) headers.set(url, response.headers());
    });

    await openDemo(page, [publicId]);
    await expect(widgetHost(page, publicId)).toBeAttached();

    const find = (fragment: string): Record<string, string> | undefined => {
      for (const [url, value] of headers) if (url.includes(fragment)) return value;
      return undefined;
    };

    expect(find('loader.js')?.['cache-control']).toContain('max-age=300');

    const runtime = find('/runtime.');
    expect(runtime?.['cache-control']).toContain('max-age=31536000');
    expect(runtime?.['cache-control']).toContain('immutable');

    const config = find('/config/');
    expect(config?.['cache-control']).toContain('max-age=60');
    expect(config?.['etag']).toBeTruthy();
    expect(config?.['vary']).toContain('Origin');
    // CORS granted only because the Origin passed the server's allowlist.
    expect(config?.['access-control-allow-origin']).toBe(DEMO_ORIGIN);
  });

  test('a widget on a site that is not allowed simply does not appear', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'rt-origin');
    // Allowlist a different host, so the demo origin is refused.
    const publicId = await publishFor(page, 'Elsewhere', 'Contact form', async (builder) => {
      const list = builder.getByTestId('allowed-domains');
      await list.getByRole('textbox').last().fill('someone-else.example.com');
    });

    await openDemo(page, [publicId]);

    // Nothing renders, and the host page is untouched - a widget that cannot
    // load is invisible, never an error on somebody else's site.
    await expect(widgetHost(page, publicId)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Northwind Supply' })).toBeVisible();
  });

  test('unpublishing stops the server serving it to a fresh visitor', async ({ page, browser }) => {
    await createOwnerWithWorkspace(page, 'rt-unpublish');
    const publicId = await publishFor(page, 'Temporary', 'Contact form');
    const builderUrl = page.url();

    await openDemo(page, [publicId]);
    await expect(widgetHost(page, publicId)).toBeAttached();

    await page.goto(builderUrl);
    await page.getByRole('button', { name: 'Unpublish' }).click();
    await expect(page.getByText('Unpublished. Visitors stop seeing it')).toBeVisible();

    /**
     * A FRESH context, with an empty HTTP cache.
     *
     * Reusing this one would test the browser's cache rather than the server:
     * blueprint 8.2 gives the config a 60-second TTL, so a visitor who already
     * has it may legitimately keep seeing the widget for up to a minute. What
     * must be true immediately is that the server has stopped handing it out,
     * and a visitor arriving now gets nothing.
     */
    const fresh = await browser.newContext();
    const visitor = await fresh.newPage();
    const query = new URLSearchParams({ w: publicId, api: 'http://localhost:5173' });
    await visitor.goto(`${DEMO_ORIGIN}/fixture.html?${query.toString()}`);

    await expect(visitor.getByRole('heading', { name: 'Northwind Supply' })).toBeVisible();
    await expect(visitor.locator(`[data-lcp-widget="${publicId}"]`)).toHaveCount(0);

    await fresh.close();
  });
});

test.describe('triggers and targeting execute for real (blueprint 4.4)', () => {
  test('a modal opens on a host-page click and traps focus until Escape', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'rt-modal');
    const publicId = await publishFor(page, 'Modal', 'Contact form', async (builder) => {
      await builder.getByLabel('Display').selectOption('modal');
      await builder.getByLabel('When someone clicks').check();
    });

    await openDemo(page, [publicId]);
    await waitForWidgetReady(page, publicId);

    // A modal is not present until something opens it.
    await expect(widgetHost(page, publicId)).toHaveCount(0);

    await page.getByTestId(`open-${publicId}`).click();
    const host = widgetHost(page, publicId);
    await expect(host.getByRole('heading', { name: 'Get in touch' })).toBeVisible();

    // Opened because the visitor asked, so focus moves into it.
    const focusedInside = await host.evaluate(
      (node) =>
        node.shadowRoot?.activeElement !== null && node.shadowRoot?.activeElement !== undefined,
    );
    expect(focusedInside).toBe(true);

    await page.keyboard.press('Escape');
    await expect(widgetHost(page, publicId)).toHaveCount(0);
    // Focus returns to the control that opened it.
    await expect(page.getByTestId(`open-${publicId}`)).toBeFocused();
  });

  test('a scroll-depth trigger fires only after scrolling far enough', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'rt-scroll');
    const publicId = await publishFor(page, 'Scroller', 'Contact form', async (builder) => {
      await builder.getByLabel('Display').selectOption('modal');
      await builder.getByLabel('After scrolling').check();
      await builder.getByLabel('Percent').fill('60');
    });

    await openDemo(page, [publicId]);
    await waitForWidgetReady(page, publicId);
    await expect(widgetHost(page, publicId)).toHaveCount(0);

    // A small scroll is not enough.
    await page.mouse.wheel(0, 200);
    await expect(widgetHost(page, publicId)).toHaveCount(0);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(widgetHost(page, publicId).getByRole('heading')).toBeVisible();
  });

  test('a page excluded by targeting never shows the widget', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'rt-targeting');
    const publicId = await publishFor(page, 'Targeted', 'Contact form', async (builder) => {
      await builder.getByRole('button', { name: 'Add only on these pages' }).click();
      const list = builder.getByTestId('include-patterns');
      await list.getByRole('textbox').last().fill('/never-this-path');
    });

    await openDemo(page, [publicId]);

    // The config was served - the Origin is allowed - but the runtime decides
    // this page is not targeted (blueprint 7.2 step 7).
    await expect(widgetHost(page, publicId)).toHaveCount(0);
  });

  test('a session cooldown stops a modal reappearing on the next page load', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'rt-cooldown');
    const publicId = await publishFor(page, 'Once', 'Contact form', async (builder) => {
      await builder.getByLabel('Display').selectOption('modal');
      await builder.getByLabel('After a delay').check();
      await builder.getByLabel('Seconds').fill('0');
    });

    await openDemo(page, [publicId]);
    await expect(widgetHost(page, publicId).getByRole('heading')).toBeVisible();

    // Same session, same widget: the cooldown suppresses it.
    await openDemo(page, [publicId]);
    await page.waitForFunction(() => {
      const registry = (window as unknown as { __LCP_WIDGET_REGISTRY__?: unknown })
        .__LCP_WIDGET_REGISTRY__;
      return registry !== undefined;
    });
    await expect(widgetHost(page, publicId)).toHaveCount(0);
  });
});

test.describe('accessibility of the rendered widget', () => {
  test('the widget itself passes axe on the host page', async ({ page, checkA11y }) => {
    await createOwnerWithWorkspace(page, 'rt-a11y');
    const publicId = await publishFor(page, 'Accessible', 'Contact form');

    await openDemo(page, [publicId]);
    await expect(widgetHost(page, publicId).getByRole('heading')).toBeVisible();

    /**
     * Scanned on the demo page, so this covers the widget as a visitor meets
     * it - inside a shadow root, on a page with its own styles. axe traverses
     * open shadow roots, which is one more reason the root is open.
     */
    await checkA11y(page);
  });

  test('the form is operable with the keyboard alone', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'rt-keys');
    const publicId = await publishFor(page, 'Keyboard', 'Contact form');

    await openDemo(page, [publicId]);
    const host = widgetHost(page, publicId);
    await expect(host.getByLabel('Email')).toBeVisible();

    await host.getByLabel('Email').focus();
    await page.keyboard.type('visitor@example.com');
    await expect(host.getByLabel('Email')).toHaveValue('visitor@example.com');

    // Tab order runs through the form to its submit button.
    await page.keyboard.press('Tab');
    const movedOn = await host.evaluate(
      (node) => node.shadowRoot?.activeElement?.tagName.toLowerCase() ?? '',
    );
    expect(['input', 'textarea', 'button']).toContain(movedOn);
  });
});
