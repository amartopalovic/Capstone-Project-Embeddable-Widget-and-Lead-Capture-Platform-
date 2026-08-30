import { expect, test } from '../fixtures.js';

/**
 * Accessibility of the public site (blueprint 14.1: WCAG 2.2 AA).
 *
 * These pages are the first thing anybody sees, and unlike the dashboard they
 * are read rather than operated - long prose, code samples, and a persistent
 * navigation list. That shifts what matters: heading structure, reading order,
 * and whether the navigation is usable without a mouse.
 *
 * Every page is scanned rather than a representative sample, because the pages
 * are cheap to check and a policy page nobody scanned is exactly where a
 * contrast or heading mistake survives.
 */

const PAGES: readonly { readonly path: string; readonly heading: string }[] = [
  { path: '/', heading: 'Put a form on someone else’s website and trust what comes back.' },
  { path: '/docs/install', heading: 'Install a widget' },
  { path: '/docs/domains', heading: 'Domains and targeting' },
  { path: '/docs/consent', heading: 'Consent and unsubscribe' },
  { path: '/docs/webhooks', heading: 'Webhooks' },
  { path: '/docs/api', heading: 'API reference' },
  { path: '/docs/troubleshooting', heading: 'Troubleshooting' },
  { path: '/policies/privacy', heading: 'Privacy' },
  { path: '/policies/terms', heading: 'Terms' },
  { path: '/policies/storage', heading: 'Storage and cookies' },
  { path: '/policies/acceptable-use', heading: 'Acceptable use' },
];

test.describe('accessibility of the public site', () => {
  for (const { path, heading } of PAGES) {
    test(`${path} passes an axe scan`, async ({ page, checkA11y }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await checkA11y(page);
    });
  }

  test('every page has exactly one h1, and headings do not skip levels', async ({ page }) => {
    /**
     * Not something axe reports on its own, and it is what a screen-reader user
     * navigates a long documentation page by. A jump from h1 straight to h3
     * reads as a missing section.
     */
    for (const { path } of PAGES) {
      await page.goto(path);

      const levels = await page
        .locator('h1, h2, h3, h4')
        .evaluateAll((nodes) => nodes.map((node) => Number(node.tagName.slice(1))));

      expect(
        levels.filter((level) => level === 1),
        `${path} should have exactly one h1`,
      ).toEqual([1]);

      let previous = 1;
      for (const level of levels) {
        expect(level - previous, `${path} skips a heading level`).toBeLessThanOrEqual(1);
        previous = level;
      }
    }
  });

  test('the site is navigable from the keyboard alone', async ({ page }) => {
    await page.goto('/');

    /**
     * The skip link is the first stop, and it has to be reachable AND visible
     * once focused - a skip link that stays visually hidden when focused helps
     * a screen reader and strands a sighted keyboard user.
     */
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page.locator('#content')).toBeVisible();

    // And a documentation page can be reached and read without a pointer.
    await page.goto('/docs/install');
    const link = page.getByRole('navigation', { name: 'Documentation' }).getByRole('link', {
      name: 'Webhooks',
    });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Webhooks' })).toBeVisible();
  });

  test('the mobile menu is a real, labelled control', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto('/');

    const toggle = page.getByRole('button', { name: 'Menu' });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(page.getByRole('button', { name: 'Close' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(
      page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Docs' }),
    ).toBeVisible();
  });

  test('code samples are readable as text, not images', async ({ page }) => {
    /**
     * Documentation code exists to be copied. A screen reader has to be able to
     * read it and a person has to be able to select it, which rules out the
     * rendered-to-canvas approach some highlighters take.
     */
    await page.goto('/docs/webhooks');

    const samples = page.locator('pre code');
    expect(await samples.count()).toBeGreaterThan(2);
    await expect(samples.first()).toContainText('submission.received');
  });
});
