import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ANALYTICS_RANGE_LABELS,
  ANALYTICS_RANGES,
  type AnalyticsOverview,
  type AnalyticsRange,
  type DeliveryHealthSummary,
  type FunnelCountsDto,
} from '@lcp/contracts';
import { analyticsApi, type ApiFailure } from '../lib/api.js';
import { useWorkspace } from '../lib/workspace-context.js';
import { useWorkspaceEvents } from '../lib/use-workspace-events.js';
import { Alert } from '../components/ui.jsx';
import {
  BarTable,
  DaySeries,
  Funnel,
  NoData,
  Panel,
  Rate,
  Stat,
  type FunnelStage,
} from '../components/charts.jsx';

/**
 * The analytics dashboards (blueprint 4.9, 13.2, 14.2 item 6).
 *
 * Eight views, one server read. They are all slices of the same range of the
 * same workspace's data, so splitting them into eight requests would mean eight
 * chances for the range to drift between them and a page that shows
 * inconsistent totals while it loads.
 *
 * **The UI never divides.** Every rate on this page arrives computed. Blueprint
 * 13.2 defines the formulas, Stage 10a implemented them once as pure functions,
 * and a browser recomputing them would be a second copy that can disagree with
 * the first - including about the rule that matters most here: a rate with a
 * zero denominator is `null`, meaning "no data", and must never render as 0%.
 *
 * The funnel is the hero rather than a row of headline cards. This product is a
 * path from "somebody saw it" to "somebody submitted", and the useful question
 * is where people fall out - so the page opens with the shape of that loss.
 */

export function AnalyticsPage(): React.JSX.Element {
  const { active } = useWorkspace();
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [liveNote, setLiveNote] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const result = await analyticsApi.overview(range);
    setLoading(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setFailure(null);
    setOverview(result.data);
  }, [range]);

  useEffect(() => {
    void load();
  }, [load, active.id]);

  /**
   * Live updates on the EXISTING stream (blueprint 13.1).
   *
   * `useWorkspaceEvents` shares the one authenticated, workspace-scoped
   * connection the inbox already opens, with its reconnect backoff and
   * last-event cursor. Opening a second EventSource for this page would spend
   * one of the browser's per-origin connections and give the server two
   * subscriptions to authorize for the same person.
   *
   * A delivery or usage change refetches rather than patching numbers in place:
   * the counters here are derived from an aggregate, and re-deriving them in
   * the browser from an event payload is exactly the client-side arithmetic
   * this page exists not to do.
   */
  useWorkspaceEvents({
    types: ['usage.changed', 'delivery.status_changed'],
    enabled: !loading,
    onEvent: (event) => {
      setLiveNote(
        event.type === 'usage.changed' ? 'Usage just changed.' : 'A delivery just changed.',
      );
      void load();
    },
  });

  return (
    <main className="mx-auto max-w-5xl px-5 py-12">
      <header className="mb-8 border-b border-edge pb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">Analytics</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              How your widgets are doing
            </h1>
            <p className="mt-2 text-sm text-muted">
              Where visitors drop out between seeing a widget and sending you a lead.
            </p>
          </div>

          {/*
           * A radio group rather than a select: three options, all worth
           * seeing at once, and arrow keys move between them for free.
           */}
          <fieldset data-testid="range-picker">
            <legend className="sr-only">Date range</legend>
            <div className="flex border border-edge">
              {(Object.keys(ANALYTICS_RANGES) as AnalyticsRange[]).map((option) => (
                <label
                  key={option}
                  className={`cursor-pointer border-r border-edge px-3 py-2 text-sm last:border-r-0 ${
                    range === option ? 'bg-signal text-white' : 'bg-panel text-ink hover:bg-paper'
                  }`}
                >
                  <input
                    type="radio"
                    name="range"
                    value={option}
                    checked={range === option}
                    onChange={() => setRange(option)}
                    className="sr-only"
                  />
                  {ANALYTICS_RANGE_LABELS[option]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </header>

      {failure !== null && <Alert tone="error">{failure.message}</Alert>}

      {/* A polite region: a live refresh is announced, never focus-stealing. */}
      <div role="status" aria-live="polite" className="sr-only">
        {liveNote}
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading your numbers.</p>
      ) : overview === null ? null : overview.totals.impressions === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            {overview.from} to {overview.to} · {overview.timezone}
          </p>

          {/* 1 - the funnel, and the headline counts it is built from */}
          <Panel
            title="From seen to sent"
            hint="Each step shows how many people reached it, and how many of the previous step that is."
            testId="dashboard-funnel"
          >
            <Funnel stages={funnelStages(overview)} />
          </Panel>

          <div className="grid grid-cols-2 border border-edge bg-panel sm:grid-cols-4">
            {/*
             * The busiest day, not a range total.
             *
             * `visitors` is distinct people PER DAY, so adding thirty days of
             * it counts a returning visitor thirty times. The peak day is the
             * largest true statement this aggregate supports, and it is the
             * one worth knowing anyway.
             */}
            <Stat label="Busiest day" value={busiestDay(overview)} testId="stat-visitors" />
            <Stat
              label="Widgets seen"
              value={overview.totals.impressions}
              testId="stat-impressions"
            />
            <Stat label="Forms started" value={overview.totals.formStarts} />
            <Stat
              label="Leads sent"
              value={overview.totals.submissions}
              tone="secure"
              testId="stat-submissions"
            />
          </div>

          {/* 2 - counts and trends over time */}
          <Panel title="Over time" testId="dashboard-trend">
            <DaySeries
              points={overview.daily.map((point) => ({
                day: point.day,
                value: point.counts.impressions,
              }))}
              label="Views"
              testId="trend-views"
            />
          </Panel>

          {/* 3 - per-widget performance */}
          <Panel
            title="Each widget"
            hint="A widget nobody has seen shows no data rather than nought per cent."
            testId="dashboard-widgets"
          >
            {overview.byWidget.length === 0 ? (
              <NoData>No widget has recorded anything in this range.</NoData>
            ) : (
              <table data-testid="widget-table" className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {[
                      'Widget',
                      'Seen',
                      'Opened',
                      'Started',
                      'Sent',
                      'Open rate',
                      'Sent per start',
                    ].map((heading, index) => (
                      <th
                        key={heading}
                        scope="col"
                        className={`pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted ${
                          index === 0 ? 'text-left' : 'text-right'
                        }`}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {overview.byWidget.map((row) => (
                    <tr key={row.widgetId} className="border-t border-edge">
                      <th scope="row" className="py-2 pr-4 text-left font-medium text-ink">
                        {row.name}
                      </th>
                      <td className="py-2 text-right font-mono text-ink">
                        {row.counts.impressions}
                      </td>
                      <td className="py-2 text-right font-mono text-ink">{row.counts.opens}</td>
                      <td className="py-2 text-right font-mono text-ink">
                        {row.counts.formStarts}
                      </td>
                      <td className="py-2 text-right font-mono text-ink">
                        {row.counts.submissions}
                      </td>
                      <td className="py-2 pl-4 text-right">
                        <Rate value={row.rates.openRate} {...openRateReason(row.counts)} />
                      </td>
                      <td className="py-2 pl-4 text-right">
                        <Rate value={row.rates.submissionConversion} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          {/* 4 - country and city */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Countries" testId="dashboard-countries">
              <BarTable
                rows={overview.byCountry.map((row) => ({
                  label: row.value,
                  value: row.counts.impressions,
                }))}
                valueLabel="Views"
                emptyMessage="No location data in this range. Locations come from submissions."
                testId="country-table"
              />
            </Panel>
            <Panel title="Cities" testId="dashboard-cities">
              <BarTable
                rows={overview.byCity.map((row) => ({
                  label: row.value,
                  value: row.counts.impressions,
                }))}
                valueLabel="Views"
                emptyMessage="No location data in this range."
                testId="city-table"
              />
            </Panel>
          </div>

          {/* 5 - top domains and pages */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Top sites" testId="dashboard-domains">
              <BarTable
                rows={overview.byDomain.map((row) => ({
                  label: row.value,
                  value: row.counts.impressions,
                }))}
                valueLabel="Views"
                emptyMessage="No sites have shown a widget in this range."
                testId="domain-table"
              />
            </Panel>
            <Panel title="Top pages" testId="dashboard-pages">
              <BarTable
                rows={overview.byPage.map((row) => ({
                  label: row.value,
                  value: row.counts.impressions,
                }))}
                valueLabel="Views"
                emptyMessage="No pages have shown a widget in this range."
                testId="page-table"
              />
            </Panel>
          </div>

          {/* 6 - conversion by contact status */}
          <Panel
            title="What happened to the leads"
            hint="Leads first seen in this range, by where your team has moved them."
            testId="dashboard-status"
          >
            {overview.status.cohortSize === 0 ? (
              <NoData>No leads arrived in this range.</NoData>
            ) : (
              <>
                <BarTable
                  rows={['new', 'contacted', 'qualified', 'converted', 'archived'].map(
                    (status) => ({
                      label: status,
                      value: overview.status.counts[status] ?? 0,
                    }),
                  )}
                  valueLabel="Leads"
                  nameLabel="Status"
                  emptyMessage="No leads arrived in this range."
                  testId="status-table"
                />
                <p className="mt-4 flex items-baseline justify-between border-t border-edge pt-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                    Reached qualified or converted
                  </span>
                  <span data-testid="status-conversion">
                    <Rate value={overview.status.conversion} />
                  </span>
                </p>
              </>
            )}
          </Panel>

          {/* 7 and 8 - delivery health, and spam */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel
              title="Getting the word out"
              hint="Emails and webhooks triggered by your leads."
              testId="dashboard-delivery"
            >
              {/*
               * Four noughts are not a reading. Every other panel here says so
               * in words when it has nothing, and a delivery grid that shows
               * all-zero looks like a broken counter rather than a quiet week -
               * particularly beside "Blocked and throttled", which does.
               */}
              {nothingSent(overview.delivery) ? (
                <NoData>Nothing has been sent yet. Emails appear here once a lead arrives.</NoData>
              ) : (
                <div className="grid w-full grid-cols-2 border border-edge">
                  <Stat
                    label="Delivered"
                    value={overview.delivery.delivered}
                    tone="secure"
                    testId="delivery-delivered"
                  />
                  <Stat label="In flight" value={overview.delivery.pending} />
                  <Stat
                    label="Rejected"
                    value={overview.delivery.failed}
                    tone={overview.delivery.failed > 0 ? 'danger' : 'muted'}
                  />
                  <Stat
                    label="Gave up"
                    value={overview.delivery.deadLetter}
                    tone={overview.delivery.deadLetter > 0 ? 'danger' : 'muted'}
                    testId="delivery-dead"
                  />
                </div>
              )}
              <p className="mt-3 text-sm">
                <Link
                  to="/workspace/delivery"
                  className="text-signal underline decoration-signal/40 underline-offset-4 hover:decoration-signal"
                >
                  Open delivery health
                </Link>
              </p>
            </Panel>

            <Panel
              title="Blocked and throttled"
              hint="Spam and rate limits your widgets turned away."
              testId="dashboard-abuse"
            >
              {overview.abuse.total === 0 ? (
                <NoData>Nothing has been blocked in this range.</NoData>
              ) : (
                <BarTable
                  rows={Object.entries(overview.abuse.byType).map(([type, count]) => ({
                    label: type.replace(/_/g, ' '),
                    value: count,
                  }))}
                  valueLabel="Blocked"
                  nameLabel="Reason"
                  emptyMessage="Nothing has been blocked in this range."
                  testId="abuse-table"
                />
              )}
            </Panel>
          </div>
        </div>
      )}
    </main>
  );
}

/**
 * The four stages, with the step-down between them.
 *
 * The rates come from the SERVER - `openRate`, `formStartRate`, and
 * `submissionConversion` are exactly blueprint 13.2's three consecutive
 * conversions, already computed. The first stage has no previous step, so its
 * rate is null by definition rather than by a zero denominator.
 */
/**
 * Why an open rate can be undefined while opens are not zero.
 *
 * A contact form is permanently on the page, so it has no "opened" step and no
 * eligible impressions to divide by - the rate is undefined, not nought. That
 * is correct and it is also the one place on this page where a dash next to a
 * healthy count looks like a bug, so it says why.
 *
 * No arithmetic: two counts the server already sent decide which sentence to
 * show, and the rate itself is still whatever the server computed.
 */
/**
 * Whether the delivery counters have anything in them at all.
 *
 * Each counter is checked rather than summed, so a future counter added to the
 * summary has to be considered here rather than being silently folded into a
 * total that keeps reading zero.
 */
/** The most people seen in any single day of the range. */
function busiestDay(overview: AnalyticsOverview): number {
  return overview.daily.reduce((peak, point) => Math.max(peak, point.counts.visitors), 0);
}

function nothingSent(delivery: DeliveryHealthSummary): boolean {
  return (
    delivery.delivered === 0 &&
    delivery.failed === 0 &&
    delivery.deadLetter === 0 &&
    delivery.pending === 0
  );
}

function openRateReason(counts: FunnelCountsDto): { reason?: string } {
  if (counts.impressions > 0 && counts.eligibleImpressions === 0) {
    return { reason: 'always visible, so there is no open step' };
  }
  return {};
}

function funnelStages(overview: AnalyticsOverview): readonly FunnelStage[] {
  return [
    { label: 'Seen', count: overview.totals.impressions, rate: null },
    {
      label: 'Opened',
      count: overview.totals.opens,
      rate: overview.rates.openRate,
      ...openRateReason(overview.totals),
    },
    { label: 'Started', count: overview.totals.formStarts, rate: overview.rates.formStartRate },
    {
      label: 'Sent',
      count: overview.totals.submissions,
      rate: overview.rates.submissionConversion,
    },
  ];
}

function EmptyState(): React.JSX.Element {
  return (
    <div
      data-testid="analytics-empty"
      className="border border-edge bg-panel px-5 py-12 text-center"
    >
      <p className="text-sm font-medium text-ink">Nothing to chart yet.</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        Numbers appear once a published widget has been seen on your site. Today counts as it
        happens.
      </p>
      <p className="mt-4">
        <Link
          to="/workspace/widgets"
          className="text-sm text-signal underline decoration-signal/40 underline-offset-4 hover:decoration-signal"
        >
          Go to widgets
        </Link>
      </p>
    </div>
  );
}
