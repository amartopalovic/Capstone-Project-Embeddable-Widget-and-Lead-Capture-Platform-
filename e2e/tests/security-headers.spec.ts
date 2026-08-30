import { test, expect, type Page } from '@playwright/test';

/**
 * Security headers and the Content Security Policy, in a real browser
 * (blueprint 17).
 *
 * The integration suite proves the headers are SENT. Only a browser can prove
 * they do not break anything, and that is the failure mode worth testing: a
 * plausible-looking policy that silently stops the widget styling itself, or
 * stops Swagger UI booting, is worse than no policy at all, because it looks
 * like hardening in a diff and behaves like a regression in production.
 *
 * Every test here therefore checks two things at once - that the policy is
 * strict, and that the thing it governs still works under it.
 */

const DEMO_ORIGIN = 'http://localhost:5174';
const API = 'http://localhost:5173';

interface Violation {
  readonly directive: string;
  readonly blockedUri: string;
  readonly source: string;
}

/**
 * Collect the browser's own policy-violation events, with their source.
 *
 * `securitypolicyviolation` rather than console scraping, because the source
 * file is the whole point: a violation caused by the application is a defect,
 * and a violation caused by the DEV SERVER's own client is not.
 *
 * Vite's client injects a `<style>` element for its error overlay, which a
 * strict `style-src` correctly refuses. It does not exist in a built
 * application at all. The sandbox is therefore served BUILT in these tests -
 * see `playwright.config.ts` - so nothing here is excluded on its behalf; the
 * dashboard still runs from its dev server, which is what this filter is for.
 *
 * Relaxing a policy in development to quiet its own tooling would mean these
 * tests exercised a weaker policy than the one that ships, which would defeat
 * the purpose of running them. So the dev server's own client is excluded by
 * source, deliberately and visibly, rather than by loosening the page.
 */
async function collectViolations(page: Page): Promise<() => Promise<Violation[]>> {
  await page.addInitScript(() => {
    const store: Violation[] = [];
    (window as unknown as { __cspViolations: Violation[] }).__cspViolations = store;
    addEventListener('securitypolicyviolation', (event) => {
      store.push({
        directive: event.effectiveDirective,
        blockedUri: event.blockedURI,
        source: event.sourceFile,
      });
    });
  });

  return async () => {
    const all = await page.evaluate(
      () => (window as unknown as { __cspViolations: Violation[] }).__cspViolations ?? [],
    );
    return all.filter((violation) => !violation.source.includes('@vite/client'));
  };
}

test.describe('the sandbox under its own policy - EXIT GATE', () => {
  test('carries the strictest page policy in the product', async ({ page }) => {
    const response = await page.goto(`${DEMO_ORIGIN}/?api=${encodeURIComponent(API)}`);
    const policy = response?.headers()['content-security-policy'] ?? '';

    expect(policy).toContain("default-src 'none'");
    // The assertion that keeps the widget installable on a real customer site.
    expect(policy).toContain("style-src 'self'");
    expect(policy).not.toContain("style-src 'self' 'unsafe-inline'");
    // And no inline script, even on the dev server: this page has no framework
    // preamble to make an exception for.
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");

    expect(response?.headers()['x-frame-options']).toBe('DENY');
    expect(response?.headers()['permissions-policy']).toContain('camera=()');
  });

  test('renders three widgets, styled, with no policy refusal', async ({ page }) => {
    const violations = await collectViolations(page);
    await page.goto(`${DEMO_ORIGIN}/?api=${encodeURIComponent(API)}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Three widgets on a bench.' }),
    ).toBeVisible();

    // Two render inline; the popover's specimen is its trigger.
    await expect(page.locator('[data-lcp-widget]')).toHaveCount(2, { timeout: 15_000 });

    const styling = await page.evaluate(() => {
      const hosts = Array.from(document.querySelectorAll('[data-lcp-widget]'));
      return hosts.map((host) => {
        const root = (host as HTMLElement).shadowRoot;
        const panel = root?.querySelector('.panel');
        return {
          adopted: root?.adoptedStyleSheets.length ?? 0,
          styleElements: root?.querySelectorAll('style').length ?? -1,
          panelBackground:
            panel === null || panel === undefined ? null : getComputedStyle(panel).backgroundColor,
          hostFont: getComputedStyle(host as HTMLElement).fontFamily,
        };
      });
    });

    for (const widget of styling) {
      /**
       * A constructed stylesheet, and NOT a `<style>` element.
       *
       * A `<style>` is an inline style block whatever created it, so under this
       * page's `style-src 'self'` it would be blocked and the panel below would
       * be transparent. This is the assertion that would fail if the runtime
       * ever went back to appending one.
       */
      expect(widget.adopted).toBe(1);
      expect(widget.styleElements).toBe(0);
      expect(widget.panelBackground).toBe('rgb(255, 255, 255)');
    }

    const refused = await violations();
    expect(refused, JSON.stringify(refused)).toHaveLength(0);
  });

  test('renders each widget in its CONFIGURED font, not the browser default', async ({ page }) => {
    /**
     * The Stage 12b defect, closed.
     *
     * Every widget in the product rendered in the browser's initial serif
     * whatever font its creator had chosen, because the runtime set
     * `all: initial` as an inline style on the host - which outranks the
     * `:host { font-family }` rule in its own stylesheet. Stage 12b found it by
     * looking at the page and left it; this asserts it stays fixed.
     */
    await page.goto(`${DEMO_ORIGIN}/?api=${encodeURIComponent(API)}`);
    await expect(page.locator('[data-lcp-widget]').first()).toBeAttached({ timeout: 15_000 });

    const fonts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-lcp-widget]')).map((host) => {
        const headline = (host as HTMLElement).shadowRoot?.querySelector('.headline');
        return {
          host: getComputedStyle(host as HTMLElement).fontFamily,
          headline:
            headline === null || headline === undefined
              ? ''
              : getComputedStyle(headline).fontFamily,
        };
      }),
    );

    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) {
      expect(font.host).toContain('ui-sans-serif');
      expect(font.host).not.toContain('Times');
      expect(font.headline).toContain('ui-sans-serif');
    }
  });
});

test.describe('the dashboard under its policy', () => {
  test('carries the policy and still renders', async ({ page }) => {
    const violations = await collectViolations(page);
    const response = await page.goto('/');

    const policy = response?.headers()['content-security-policy'] ?? '';
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(response?.headers()['x-frame-options']).toBe('DENY');
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const refused = await violations();
    expect(refused, JSON.stringify(refused)).toHaveLength(0);
  });
});

test.describe('Swagger UI under its policy', () => {
  test('boots and renders operations with same-origin scripts only', async ({ page }) => {
    /**
     * The other half of "a CSP that breaks either is not hardening". Swagger UI
     * is a vendored third-party bundle; if `script-src 'self'` were wrong for
     * it, this page would be an empty div and nothing else would notice.
     */
    const violations = await collectViolations(page);
    const response = await page.goto(`${API}/api-reference`);

    const policy = response?.headers()['content-security-policy'] ?? '';
    expect(policy).toContain("script-src 'self'");

    await expect(page.locator('.opblock-tag').first()).toBeVisible({ timeout: 30_000 });
    expect(await page.locator('.opblock-tag').count()).toBeGreaterThan(5);

    const refused = await violations();
    expect(refused, JSON.stringify(refused)).toHaveLength(0);
  });
});

test.describe('the widget surface stays fetchable across origins', () => {
  test('serves the loader with a cross-origin resource policy', async ({ request }) => {
    /**
     * helmet's default for this header is `same-origin`, which would make the
     * loader unfetchable from every customer website in existence - the whole
     * product, disabled by a security header. Asserted here as well as in the
     * integration suite because this is the one that goes through a browser's
     * own enforcement.
     */
    const response = await request.get(`${API}/widget/v1/loader.js`);
    expect(response.status()).toBe(200);
    expect(response.headers()['cross-origin-resource-policy']).toBe('cross-origin');
  });
});
