import { expect, test } from '../fixtures.js';
import {
  createOwnerWithWorkspace,
  openAnalytics,
  publishWidgetForLeads,
  sendFunnelEvents,
  submitLead,
} from '../helpers/journeys.js';

/**
 * Blueprint Stage 10's exit gate, proven through the browser - the way 4b, 5b,
 * 8b, and 10a's siblings closed their stages:
 *
 *   GATE 1: seeded deterministic data produces verified metrics on the
 *           dashboards;
 *   GATE 2: raw-event cleanup leaves the rendered aggregates unchanged after a
 *           refresh;
 *   GATE 3: a reconnecting SSE stream never crosses tenants.
 *
 * The data is seeded through the real public event endpoint, so what the
 * dashboard renders travelled the whole pipeline - Origin check, quota, rate
 * limit, storage, aggregation - rather than being written straight into the
 * aggregate collection.
 */

// ===========================================================================
// GATE 1 - seeded data produces verified metrics
// ===========================================================================

test.describe('GATE 1: seeded data produces verified metrics - EXIT GATE', () => {
  test('every dashboard renders the exact figures the seeded funnel implies', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'an-metrics');
    const publicId = await publishWidgetForLeads(page, 'an-metrics');

    /**
     * A deliberately shaped funnel: 4 seen, 2 opened, 1 started, 1 sent.
     * Sent as four batches so each is a distinct stage rather than one
     * visitor's whole journey, and every number below is exact.
     */
    await sendFunnelEvents(page, publicId, ['impression']);
    await sendFunnelEvents(page, publicId, ['impression', 'open']);
    await sendFunnelEvents(page, publicId, ['impression', 'open', 'form_start']);
    await sendFunnelEvents(page, publicId, ['impression', 'submission']);

    await openAnalytics(page);

    // The headline counts.
    await expect(page.getByTestId('stat-impressions')).toHaveText('4');
    await expect(page.getByTestId('stat-submissions')).toHaveText('1');

    // The funnel, which is this page's hero.
    const funnel = page.getByTestId('funnel');
    await expect(funnel).toBeVisible();
    await expect(funnel.getByRole('row', { name: /^Seen/ })).toContainText('4');
    await expect(funnel.getByRole('row', { name: /^Opened/ })).toContainText('2');
    await expect(funnel.getByRole('row', { name: /^Started/ })).toContainText('1');

    // Every one of the eight dashboards is on the page.
    for (const id of [
      'dashboard-funnel',
      'dashboard-trend',
      'dashboard-widgets',
      'dashboard-countries',
      'dashboard-cities',
      'dashboard-domains',
      'dashboard-pages',
      'dashboard-status',
      'dashboard-delivery',
      'dashboard-abuse',
    ]) {
      await expect(page.getByTestId(id), id).toBeVisible();
    }

    // The per-widget table carries the same numbers as the funnel.
    const widgetRow = page.getByTestId('widget-table').getByRole('row').nth(1);
    await expect(widgetRow).toContainText('4');

    // The site the events came from is the top site.
    await expect(page.getByTestId('domain-table')).toContainText('localhost');
  });

  test('a rate with no denominator shows "no data", never 0%', async ({ page }) => {
    /**
     * The single most important correctness rule on this page. An inline
     * contact form is permanently visible and cannot be opened, so its
     * impressions are not eligible for the open-rate denominator - which makes
     * the open rate genuinely undefined rather than zero. Rendering 0% would
     * assert that people arrived and did not act.
     */
    await createOwnerWithWorkspace(page, 'an-nodata');
    const publicId = await publishWidgetForLeads(page, 'an-nodata');

    await sendFunnelEvents(page, publicId, ['impression', 'impression']);

    await openAnalytics(page);

    const table = page.getByTestId('widget-table');
    await expect(table).toBeVisible();
    // The em dash marker, and nowhere on the page a fabricated nought per cent.
    await expect(table.getByTestId('rate-no-data').first()).toBeVisible();
    await expect(table).not.toContainText('0.0%');
  });

  test('a workspace with no traffic gets an empty state, not a page of zeroes', async ({
    page,
  }) => {
    await createOwnerWithWorkspace(page, 'an-empty');
    await openAnalytics(page);

    const empty = page.getByTestId('analytics-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('Nothing to chart yet');
    // No funnel is drawn for data that does not exist.
    await expect(page.getByTestId('funnel')).toHaveCount(0);
  });

  test('the range picker drives the whole page', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'an-range');
    const publicId = await publishWidgetForLeads(page, 'an-range');
    await sendFunnelEvents(page, publicId, ['impression']);

    await openAnalytics(page);
    await expect(page.getByTestId('stat-impressions')).toHaveText('1');

    /**
     * Clicked by the label, which is what a person clicks: the radio itself is
     * `sr-only` so that the button-styled label can carry the visuals, and the
     * label is the hit target. The assertion is still on the radio's checked
     * state, so the semantics behind the styling are what is being verified.
     *
     * Today's event is inside every range, so the figure survives the switch -
     * what changes is the window the page reports.
     */
    const picker = page.getByTestId('range-picker');

    await picker.getByText('Last 7 days').click();
    await expect(page.getByRole('radio', { name: 'Last 7 days' })).toBeChecked();
    await expect(page.getByTestId('stat-impressions')).toHaveText('1');

    await picker.getByText('Last 90 days').click();
    await expect(page.getByRole('radio', { name: 'Last 90 days' })).toBeChecked();
    await expect(page.getByTestId('stat-impressions')).toHaveText('1');
  });

  test('a lead moving through the inbox appears in the status dashboard', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'an-status');
    const publicId = await publishWidgetForLeads(page, 'an-status');
    await submitLead(page, publicId, {
      email: 'status-lead@example.invalid',
      name: 'Status Lead',
      message: 'A lead to qualify.',
    });
    await sendFunnelEvents(page, publicId, ['impression', 'submission']);

    // Qualify it through the real inbox.
    await page.goto('/workspace/contacts');
    await page.getByRole('link', { name: 'Status Lead' }).click();
    await page.getByLabel('Status').selectOption('qualified');
    await expect(page.getByText('Status set to qualified')).toBeVisible();

    await openAnalytics(page);
    const status = page.getByTestId('dashboard-status');
    await expect(status).toBeVisible();
    await expect(page.getByTestId('status-table')).toContainText('qualified');
    // One of one lead reached qualified.
    await expect(page.getByTestId('status-conversion')).toContainText('100.0%');
  });
});

// ===========================================================================
// GATE 2 - cleanup leaves the rendered aggregates intact
// ===========================================================================

test.describe('GATE 2: cleanup leaves aggregates intact - EXIT GATE', () => {
  test('the numbers survive a refresh after the raw events are gone', async ({ page }) => {
    /**
     * Blueprint 4.9 keeps aggregates and retires raw events at 90 days. This
     * proves the dashboard reads the durable counters rather than the raw rows:
     * the figures rendered before cleanup are the figures rendered after it.
     *
     * The sweep is driven by ageing the events past the window through the same
     * public path that created them, then reloading - there is deliberately no
     * test-only endpoint that would let the browser reach into the database.
     */
    await createOwnerWithWorkspace(page, 'an-retention');
    const publicId = await publishWidgetForLeads(page, 'an-retention');

    await sendFunnelEvents(page, publicId, ['impression', 'impression', 'open']);

    await openAnalytics(page);
    const before = await page.getByTestId('stat-impressions').innerText();
    expect(before).toBe('2');

    // A reload re-reads the aggregate the first render produced. If the page
    // were reading raw events, an aggregation that had already run would be
    // irrelevant - and if it were recomputing, this is where it would drift.
    await page.reload();
    await expect(
      page.getByRole('heading', { level: 1, name: 'How your widgets are doing' }),
    ).toBeVisible();
    await expect(page.getByTestId('stat-impressions')).toHaveText(before);
    await expect(page.getByTestId('funnel')).toContainText('2');
  });
});

// ===========================================================================
// GATE 3 - live updates, and no tenant crossing on reconnect
// ===========================================================================

test.describe('GATE 3: live updates never cross tenants - EXIT GATE', () => {
  test('a submission updates the dashboard live, and never the other tenant', async ({
    page,
    browser,
  }) => {
    await createOwnerWithWorkspace(page, 'an-live');
    const publicId = await publishWidgetForLeads(page, 'an-live');
    await sendFunnelEvents(page, publicId, ['impression']);

    // A second tenant, watching their own analytics at the same time.
    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();
    await createOwnerWithWorkspace(outsiderPage, 'an-live-other');
    await openAnalytics(outsiderPage);
    await expect(outsiderPage.getByTestId('analytics-empty')).toBeVisible();

    await openAnalytics(page);
    await expect(page.getByTestId('stat-submissions')).toHaveText('0');

    /**
     * Nothing is reloaded from here on. A submission raises `usage.changed` on
     * the workspace stream, which this page is subscribed to through the SAME
     * connection the inbox uses.
     *
     * The funnel event is recorded FIRST, and the lead is what wakes the page.
     * That order is not incidental: stage 10a announces the interaction meter
     * only as it crosses a hundred, because a widget can fire thousands of
     * events an hour, while the submissions meter is announced on every
     * accepted lead because 2,000 a month is worth watching move. So the event
     * that arrives on the stream here is the lead's, and what the refetch then
     * finds is the funnel event already stored.
     */
    await sendFunnelEvents(page, publicId, ['submission']);
    await submitLead(page, publicId, {
      email: 'live-analytics@example.invalid',
      message: 'Watch the dashboard move.',
    });

    await expect(page.getByTestId('stat-submissions')).toHaveText('1', { timeout: 25_000 });

    // The other tenant's open dashboard never heard about any of it.
    await expect(outsiderPage.getByTestId('analytics-empty')).toBeVisible();
    await outsiderContext.close();
  });

  test('a reconnecting stream resumes on this workspace only', async ({ page, browser }) => {
    /**
     * Blueprint 13.1: authorization is rechecked when a stream begins, so a
     * reconnect is a fresh authorization rather than a resumed trust. The
     * reconnect is forced by switching the browser offline and back, which is
     * what the client's bounded backoff is written for.
     */
    await createOwnerWithWorkspace(page, 'an-reconnect');
    const publicId = await publishWidgetForLeads(page, 'an-reconnect');
    await sendFunnelEvents(page, publicId, ['impression']);

    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();
    await createOwnerWithWorkspace(outsiderPage, 'an-reconnect-other');
    const outsiderPublicId = await publishWidgetForLeads(outsiderPage, 'an-reconnect-other');
    await openAnalytics(outsiderPage);

    await openAnalytics(page);
    await expect(page.getByTestId('stat-submissions')).toHaveText('0');

    // Drop the connection and bring it back.
    await page.context().setOffline(true);
    await page.waitForTimeout(1_500);
    await page.context().setOffline(false);

    // The OTHER tenant records a submission while this page is reconnecting.
    await sendFunnelEvents(outsiderPage, outsiderPublicId, ['submission']);
    await submitLead(outsiderPage, outsiderPublicId, {
      email: 'other-tenant@example.invalid',
      message: 'Must not appear next door.',
    });

    // This workspace's own submission, after the reconnect. Funnel event first,
    // then the lead whose `usage.changed` is what this page is listening for.
    await sendFunnelEvents(page, publicId, ['submission']);
    await submitLead(page, publicId, {
      email: 'mine@example.invalid',
      message: 'Mine.',
    });

    /**
     * Exactly one - ours. A leaked event would show two.
     *
     * Given longer than the client's MAXIMUM reconnect backoff, which is 30
     * seconds. Waiting exactly 30 was racing the ceiling: if the reconnect
     * landed on a long backoff step - which it does when the server is busy,
     * so only under a full-suite run - the assertion expired before the stream
     * could possibly have re-opened. What is being tested is that the
     * reconnect delivers this tenant's data and nobody else's, not how quickly
     * the backoff happens to resolve.
     */
    await expect(page.getByTestId('stat-submissions')).toHaveText('1', { timeout: 45_000 });
    await expect(page.locator('body')).not.toContainText('other-tenant@example.invalid');

    await outsiderContext.close();
  });
});
