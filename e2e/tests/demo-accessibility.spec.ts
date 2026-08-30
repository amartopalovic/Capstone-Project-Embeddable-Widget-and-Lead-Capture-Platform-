import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures.js';

/**
 * Accessibility of the public sandbox (blueprint 14.1: WCAG 2.2 AA).
 *
 * The sandbox is the one page on this platform that a stranger may reach with
 * no idea what the product is, and it is full of third-party content: three
 * widgets rendered inside shadow roots by a runtime loaded from another origin.
 * That is exactly the arrangement where accessibility quietly fails, because
 * the host page's audit and the widget's audit are usually done separately and
 * neither owns the seam.
 *
 * These scan the composed page, widgets included.
 */

const DEMO_ORIGIN = 'http://localhost:5174';
const API = 'http://localhost:5173';

async function openSandbox(page: Page): Promise<void> {
  await page.goto(`${DEMO_ORIGIN}/?api=${encodeURIComponent(API)}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Three widgets on a bench.' }),
  ).toBeVisible();
}

test.describe('accessibility of the public sandbox', () => {
  test('the page, with all three widgets rendered', async ({ page, checkA11y }) => {
    await openSandbox(page);
    // Wait for the widgets, so the scan covers them rather than empty mounts.
    await expect(page.locator('form').first()).toBeVisible({ timeout: 15_000 });

    /**
     * Settle the popover before scanning.
     *
     * The CTA example opens itself after three seconds, so a scan started
     * before that races a dialog appearing mid-audit and reports whatever
     * half-composed state it caught. Waiting for it and then dismissing it
     * makes this a scan of a known page; the next test scans it open.
     */
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();

    await checkA11y(page);
  });

  test('the page with the popover open, and with a snippet expanded', async ({
    page,
    checkA11y,
  }) => {
    await openSandbox(page);
    await expect(page.locator('form').first()).toBeVisible({ timeout: 15_000 });

    // The popover is a dialog over the page - a different composition, and the
    // state most likely to trap focus if anything is going to.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await page.getByText('What a customer pastes').first().click();
    await expect(page.locator('pre').first()).toBeVisible();
    await checkA11y(page);
  });

  test('the sandbox is usable from the keyboard alone', async ({ page }) => {
    await openSandbox(page);
    await expect(page.locator('form').first()).toBeVisible({ timeout: 15_000 });

    // The skip link comes first, and is visible once focused.
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    /**
     * The snippet disclosures are native `details`, so they open with the
     * keyboard without anything being reimplemented.
     *
     * Addressed as the SUMMARY rather than the `details` around it: the summary
     * is the part that takes focus and the part a key press reaches, which is
     * precisely the behaviour being claimed.
     */
    const summary = page.getByText('What a customer pastes').first();
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('pre').first()).toBeVisible();
  });

  test('every code sample is reachable and readable, not an image', async ({ page }) => {
    await openSandbox(page);
    await page.getByText('What a customer pastes').first().click();

    const sample = page.locator('pre').first();
    await expect(sample).toContainText('data-widget=');
    /**
     * Focusable because it scrolls horizontally. A region a mouse can scroll
     * and a keyboard cannot puts the end of the snippet - which is the widget
     * id, the part somebody would actually want - out of reach entirely.
     */
    await expect(sample).toHaveAttribute('tabindex', '0');
  });

  test('the synthetic-data notice is announced, not just drawn', async ({ page }) => {
    await openSandbox(page);
    /**
     * A visitor using a screen reader has to be told this page is a sandbox,
     * and told it without having to go looking. The strip is a status region,
     * so it is reachable by landmark and announced when it updates.
     */
    const strip = page.getByRole('status').first();
    await expect(strip).toContainText('Sandbox');
    await expect(strip).toContainText('Nothing is emailed or sent onward');
  });
});
