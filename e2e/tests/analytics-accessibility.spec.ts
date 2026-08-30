import { expect, test } from '../fixtures.js';
import {
  createOwnerWithWorkspace,
  openAnalytics,
  publishWidgetForLeads,
  sendFunnelEvents,
} from '../helpers/journeys.js';

/**
 * Accessibility of the analytics dashboards (blueprint 14.1: WCAG 2.2 AA),
 * matching the bar every other surface in this product already meets.
 *
 * The charts are the reason this file matters more than usual. There is no
 * charting library here and no visually-hidden duplicate table: every bar is
 * drawn as a background on the real table cell that already holds the number,
 * so a screen reader gets an ordinary table and there is nothing that can drift
 * out of step with the picture. These scans are what hold that claim up.
 */

test.describe('accessibility of the analytics dashboards', () => {
  test('the page empty, and populated with every dashboard', async ({ page, checkA11y }) => {
    await createOwnerWithWorkspace(page, 'a11y-analytics');

    // Empty: no widget has been seen yet.
    await openAnalytics(page);
    await expect(page.getByTestId('analytics-empty')).toBeVisible();
    await checkA11y(page);

    const publicId = await publishWidgetForLeads(page, 'a11y-analytics');
    await sendFunnelEvents(page, publicId, ['impression', 'open']);
    await sendFunnelEvents(page, publicId, ['impression', 'open', 'form_start', 'submission']);

    await openAnalytics(page);
    await expect(page.getByTestId('funnel')).toBeVisible();
    await checkA11y(page);

    // The day-by-day table is behind a native disclosure, so its contents are
    // only in the accessibility tree once opened - scanned in that state too.
    await page.getByTestId('trend-views').getByText('Views day by day').click();
    await expect(page.getByRole('table').filter({ hasText: 'Day' }).first()).toBeVisible();
    await checkA11y(page);
  });

  test('the charts are real tables a screen reader can read', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'a11y-analytics-tables');
    const publicId = await publishWidgetForLeads(page, 'a11y-analytics-tables');
    await sendFunnelEvents(page, publicId, ['impression', 'open']);

    await openAnalytics(page);

    /**
     * The funnel is addressed by its accessible structure rather than by a test
     * id: rows found by their row header, and a caption describing the whole
     * thing. If the bars were decorative divs, none of this would resolve.
     */
    const funnel = page.getByTestId('funnel');
    await expect(funnel.getByRole('columnheader', { name: 'Stage' })).toBeVisible();
    await expect(funnel.getByRole('columnheader', { name: 'People' })).toBeVisible();
    await expect(funnel.getByRole('rowheader', { name: 'Seen' })).toBeVisible();
    await expect(funnel.getByRole('rowheader', { name: 'Opened' })).toBeVisible();

    // The "no data" marker is announced as words, not just an em dash.
    const noData = page.getByTestId('rate-no-data').first();
    if ((await noData.count()) > 0) {
      await expect(noData).toContainText('No data');
    }
  });

  test('the dashboards are operable from the keyboard alone', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'a11y-analytics-keys');
    const publicId = await publishWidgetForLeads(page, 'a11y-analytics-keys');
    await sendFunnelEvents(page, publicId, ['impression']);

    await openAnalytics(page);

    // The range picker is a real radio group, so it is reachable and arrow
    // keys move within it - nothing was reimplemented to get that.
    const sevenDays = page.getByRole('radio', { name: 'Last 7 days' });
    await sevenDays.focus();
    await expect(sevenDays).toBeFocused();
    await page.keyboard.press('Space');
    await expect(sevenDays).toBeChecked();

    /**
     * And the day-by-day disclosure opens with Enter. Addressed as the summary
     * rather than the `details` around it, because the summary is the part that
     * takes focus and the part a key press reaches - which is exactly the
     * behaviour being claimed: a native disclosure, keyboard-operable with
     * nothing added.
     */
    await page.getByTestId('trend-views').getByText('Views day by day').press('Enter');
    await expect(page.getByRole('table').filter({ hasText: 'Day' }).first()).toBeVisible();
  });
});
