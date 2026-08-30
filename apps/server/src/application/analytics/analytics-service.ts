import type { Db, WithId } from 'mongodb';
import { ObjectId } from 'mongodb';
import {
  COLLECTIONS,
  workspaceScope,
  type DailyAnalyticsRecord,
  type DailyAnalyticsRepository,
  type InteractionEventRecord,
  type InteractionEventRepository,
  type InteractionEventType,
  type WidgetRecord,
  type WorkspaceRecord,
  type WorkspaceScope,
} from '@lcp/database';
import {
  ANALYTICS_RANGES,
  WORKSPACE_LIMITS,
  type AnalyticsOverview,
  type AnalyticsQuery,
  type DimensionRow,
  type FunnelCountsDto,
  type FunnelRatesDto,
  type InteractionEventInput,
  type Logger,
  type WidgetPerformanceRow,
} from '@lcp/contracts';
import { monthStartInZone } from '../../domain/submission/quota.js';
import { visitorPseudonym } from '../../domain/analytics/visitor-pseudonym.js';
import {
  EMPTY_FUNNEL,
  addCounts,
  funnelMetrics,
  statusConversion,
  type FunnelCounts,
} from '../../domain/analytics/funnel.js';
import type { Clock } from '../../ports/clock.js';
import type { EventPublisher } from '../../ports/event-publisher.js';

/**
 * The analytics pipeline (blueprint 13.2).
 *
 * Steps 1 and 2 - checks and raw storage - happen on the request. Step 3,
 * aggregation, runs on a schedule. Step 5, expiry, is a sweep with a
 * precondition rather than a TTL index, because 4.9 removes raw events "after
 * daily aggregates are produced" and a TTL cannot check that.
 */

/** Blueprint 4.9: raw interaction events are retained for 90 days. */
export const RAW_RETENTION_DAYS = 90;

export type IngestOutcome =
  | { readonly kind: 'accepted'; readonly stored: number }
  | { readonly kind: 'widget_unavailable' }
  | { readonly kind: 'origin_not_allowed' }
  | { readonly kind: 'quota_exceeded' };

export interface AnalyticsServiceDeps {
  readonly db: Db;
  readonly events: InteractionEventRepository;
  readonly daily: DailyAnalyticsRepository;
  readonly ipHmacSecret: string;
  /** Reads for the dashboards (blueprint 4.9), added in Stage 10b. */
  readonly contacts: {
    countsByStatus(scope: WorkspaceScope, since?: Date): Promise<Record<string, number>>;
  };
  readonly deliveries: {
    countsByStatus(scope: WorkspaceScope): Promise<Record<string, number>>;
  };
  readonly abuse: {
    countsByType(
      scope: WorkspaceScope,
      since: Date,
    ): Promise<{ readonly type: string; readonly day: string; readonly count: number }[]>;
  };
  readonly clock: Clock;
  readonly logger: Logger;
  /**
   * Live usage updates (blueprint 13.1). Never throws.
   *
   * Named `publisher` rather than `events`, because `events` is already the
   * interaction-event REPOSITORY on this same object and two very different
   * things called the same name in one dependency bag is how a wrong wiring
   * survives review.
   */
  readonly publisher: EventPublisher;
}

/**
 * How often an interaction batch announces the usage meter.
 *
 * NOT on every event. A workspace may record 20,000 interaction events in a
 * month (blueprint 4.10), and broadcasting each one to every open dashboard
 * would spend Redis commands and browser wake-ups on a number that changes by
 * one. Announcing as the count crosses each hundred keeps a live meter moving
 * visibly while costing three orders of magnitude less - and the exact figure
 * is always one page load away.
 */
const USAGE_ANNOUNCE_EVERY = 100;

export class AnalyticsService {
  readonly #deps: AnalyticsServiceDeps;

  constructor(deps: AnalyticsServiceDeps) {
    this.#deps = deps;
  }

  // --------------------------------------------------------------- ingest

  /**
   * Store a batch of funnel events (blueprint 13.2 steps 1-2).
   *
   * The widget is resolved and its published state checked before anything is
   * written, exactly as the submission path does - a public identifier is not
   * an authorization, and an unpublished or deleted widget must stop producing
   * analytics the moment it is taken down.
   */
  async ingest(input: {
    readonly widget: WithId<WidgetRecord>;
    readonly workspace: WithId<WorkspaceRecord>;
    readonly origin: string;
    readonly ip: string;
    readonly events: readonly InteractionEventInput[];
    readonly geo: InteractionEventRecord['geo'];
  }): Promise<IngestOutcome> {
    const scope = workspaceScope(input.widget.workspaceId);
    const now = this.#deps.clock.now();

    /**
     * The monthly quota, on the WORKSPACE's month (blueprint 4.10).
     *
     * Same boundary function the submission quota uses, so the two meters can
     * never disagree about when a month turned.
     */
    const monthStart = monthStartInZone(now, input.workspace.timezone);
    const used = await this.#deps.events.countSince(scope, monthStart);
    if (used >= WORKSPACE_LIMITS.interactionEventsPerMonth) {
      return { kind: 'quota_exceeded' };
    }

    /**
     * Trim the batch to what remains of the allowance rather than refusing it
     * whole. A visitor mid-funnel should not lose their impression because
     * their form-start would have been the 20,001st event of the month.
     */
    const remaining = WORKSPACE_LIMITS.interactionEventsPerMonth - used;
    const admitted = input.events.slice(0, remaining);
    if (admitted.length === 0) return { kind: 'quota_exceeded' };

    const pseudonym = visitorPseudonym(
      this.#deps.ipHmacSecret,
      input.ip,
      input.widget.publicId,
      now,
    );
    const localDay = localDayInZone(now, input.workspace.timezone);
    const domain = hostOf(input.origin);

    const documents = admitted.map((event): Omit<InteractionEventRecord, '_id'> => ({
      workspaceId: input.widget.workspaceId,
      widgetId: input.widget._id,
      type: event.type,
      visitorPseudonym: pseudonym.value,
      visitorPseudonymPeriod: pseudonym.period,
      source: {
        origin: input.origin,
        domain,
        pageUrl: event.pageUrl ?? null,
        referrer: null,
      },
      geo: input.geo,
      /**
       * The SERVER's clock, not the client's `observedAt`. A client timestamp
       * would let a caller backdate events into a day that has already been
       * aggregated and expired, which is both a correctness hole and a way to
       * write rows the retention sweep has already passed.
       */
      occurredAt: now,
      localDay,
    }));

    await this.#deps.db
      .collection<InteractionEventRecord>(COLLECTIONS.interactionEvents)
      .insertMany(documents as never[]);

    /**
     * Announce the meter as it crosses a hundred (blueprint 13.1).
     *
     * `used` and `documents.length` are both already known here, so deciding
     * whether a boundary was crossed costs no extra query.
     */
    const before = Math.floor(used / USAGE_ANNOUNCE_EVERY);
    const after = Math.floor((used + documents.length) / USAGE_ANNOUNCE_EVERY);
    if (after > before) {
      await this.#deps.publisher.publish(
        input.widget.workspaceId.toHexString(),
        'usage.changed',
        {
          interactionEventsThisMonth: used + documents.length,
          limit: WORKSPACE_LIMITS.interactionEventsPerMonth,
          meter: 'interactionEvents',
        },
        now,
      );
    }

    return { kind: 'accepted', stored: documents.length };
  }

  // ------------------------------------------------------------ aggregate

  /**
   * Roll one workspace-day into daily counters (blueprint 13.2 step 3).
   *
   * Idempotent by construction: the counters are RECOMPUTED from the raw events
   * and upserted onto the unique key, so running this twice for the same day
   * produces the same numbers rather than doubling them. That matters more than
   * it sounds - a retried BullMQ job and an operator re-running a day are both
   * ordinary, and an increment-based aggregator would corrupt a workspace's
   * history on either.
   */
  async aggregateDay(scope: WorkspaceScope, localDay: string): Promise<number> {
    const rows = await this.#deps.events.aggregateDay(scope, localDay);
    if (rows.length === 0) return 0;

    /**
     * Which widgets can be OPENED at all, for the eligible-impressions
     * denominator (blueprint 13.2).
     *
     * Read from the published revision's config rather than inferred from the
     * widget's type: a contact form in modal mode has a genuine open action,
     * and treating only CTA popovers as openable would report every modal
     * form's open rate as "no data" instead of a real figure.
     */
    const widgetIds = [...new Set(rows.map((row) => row.widgetId.toHexString()))];
    const openable = await this.#openabilityOf(scope, widgetIds);

    const now = this.#deps.clock.now();
    for (const row of rows) {
      await this.#deps.daily.upsertSlice(scope, {
        day: localDay,
        widgetId: row.widgetId,
        dimension: row.dimension as DailyAnalyticsRecord['dimension'],
        dimensionValue: row.dimensionValue,
        impressions: row.counts.impression ?? 0,
        opens: row.counts.open ?? 0,
        ctaClicks: row.counts.cta_click ?? 0,
        formStarts: row.counts.form_start ?? 0,
        submissions: row.counts.submission ?? 0,
        visitors: row.visitors,
        openEligible: openable.get(row.widgetId.toHexString()) ?? false,
        computedAt: now,
      });
    }
    return rows.length;
  }

  /**
   * Aggregate every workspace-day that has raw events and no aggregate yet,
   * plus yesterday and today for freshness.
   *
   * Returns how many days were written, so the scheduled job can log something
   * an operator can act on.
   */
  async aggregatePending(limit = 100): Promise<{ days: number; slices: number }> {
    const pending = await this.#deps.db
      .collection<InteractionEventRecord>(COLLECTIONS.interactionEvents)
      .aggregate<{ workspaceId: ObjectId; localDay: string }>([
        { $group: { _id: { workspaceId: '$workspaceId', localDay: '$localDay' } } },
        { $limit: limit },
        { $project: { _id: 0, workspaceId: '$_id.workspaceId', localDay: '$_id.localDay' } },
      ])
      .toArray();

    let slices = 0;
    for (const entry of pending) {
      slices += await this.aggregateDay(workspaceScope(entry.workspaceId), entry.localDay);
    }
    return { days: pending.length, slices };
  }

  // --------------------------------------------------------------- expiry

  /**
   * Remove raw events older than 90 days - but only where the aggregate exists
   * (blueprint 4.9, 13.2 step 5).
   *
   * The precondition is the whole point, and it is why this is a sweep rather
   * than the TTL index blueprint 9.2 might suggest. A TTL deletes on a clock
   * alone; if aggregation had been failing for a week, a TTL would quietly
   * destroy the only copy of that week's data. This aggregates the day first if
   * it has to, and refuses to delete a day it could not aggregate.
   */
  async expireRawEvents(
    limit = 50,
  ): Promise<{ daysDeleted: number; eventsDeleted: number; skipped: number }> {
    const cutoff = new Date(
      this.#deps.clock.now().getTime() - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const stale = await this.#deps.events.staleDays(cutoff, limit);

    let daysDeleted = 0;
    let eventsDeleted = 0;
    let skipped = 0;

    for (const entry of stale) {
      const scope = workspaceScope(entry.workspaceId);

      // Aggregate first if nobody has. A day that reached the cutoff without an
      // aggregate is a bug somewhere upstream, and losing it silently would
      // hide that bug behind missing data.
      if (!(await this.#deps.daily.hasAggregateFor(scope, entry.localDay))) {
        await this.aggregateDay(scope, entry.localDay);
      }

      if (!(await this.#deps.daily.hasAggregateFor(scope, entry.localDay))) {
        skipped += 1;
        this.#deps.logger.warn('analytics.expiry_skipped', {
          result: 'degraded',
          localDay: entry.localDay,
          reason: 'no aggregate exists for this day, so the raw events were kept',
        });
        continue;
      }

      eventsDeleted += await this.#deps.events.deleteDay(scope, entry.localDay);
      daysDeleted += 1;
    }

    return { daysDeleted, eventsDeleted, skipped };
  }

  /**
   * Whether each widget has an open action.
   *
   * A CTA popover always does. A form does when its published config sets
   * `formMode: 'modal'`; an inline form is permanently visible and can never be
   * opened, so its impressions must stay out of the open-rate denominator or
   * they drag every mixed workspace's rate toward zero for a reason that is not
   * about performance.
   */
  async #openabilityOf(
    scope: WorkspaceScope,
    widgetIds: readonly string[],
  ): Promise<Map<string, boolean>> {
    const widgets = await this.#deps.db
      .collection<WidgetRecord>(COLLECTIONS.widgets)
      .find({
        workspaceId: scope.workspaceId,
        _id: { $in: widgetIds.map((id) => new ObjectId(id)) },
      })
      .toArray();

    const revisionIds = widgets
      .map((widget) => widget.publishedRevisionId)
      .filter((id): id is ObjectId => id !== null);

    const revisions =
      revisionIds.length === 0
        ? []
        : await this.#deps.db
            .collection<{ _id: ObjectId; config?: { formMode?: string } }>(
              COLLECTIONS.widgetRevisions,
            )
            .find({ workspaceId: scope.workspaceId, _id: { $in: revisionIds } } as never)
            .toArray();
    const formModeById = new Map(
      revisions.map((revision) => [revision._id.toHexString(), revision.config?.formMode]),
    );

    return new Map(
      widgets.map((widget) => {
        if (widget.type === 'cta_popover') return [widget._id.toHexString(), true];
        const mode =
          widget.publishedRevisionId === null
            ? undefined
            : formModeById.get(widget.publishedRevisionId.toHexString());
        return [widget._id.toHexString(), mode === 'modal'];
      }),
    );
  }

  // ----------------------------------------------------------------- read

  /** Counts for a day range, rolled up. Stage 10b renders these. */
  async countsForRange(
    scope: WorkspaceScope,
    fromDay: string,
    toDay: string,
  ): Promise<readonly { day: string; counts: FunnelCounts; visitors: number }[]> {
    const rows = await this.#deps.daily.listRange(scope, fromDay, toDay, 'total');
    const byDay = new Map<string, { counts: FunnelCounts; visitors: number }>();

    for (const row of rows) {
      const existing = byDay.get(row.day) ?? { counts: EMPTY_FUNNEL, visitors: 0 };
      byDay.set(row.day, {
        counts: {
          impressions: existing.counts.impressions + row.impressions,
          opens: existing.counts.opens + row.opens,
          ctaClicks: existing.counts.ctaClicks + row.ctaClicks,
          formStarts: existing.counts.formStarts + row.formStarts,
          submissions: existing.counts.submissions + row.submissions,
          eligibleImpressions:
            existing.counts.eligibleImpressions + (row.openEligible ? row.impressions : 0),
        },
        visitors: existing.visitors + row.visitors,
      });
    }

    return [...byDay.entries()]
      .map(([day, value]) => ({ day, ...value }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }

  /**
   * Everything the eight dashboards need, in one read (blueprint 4.9, 13.2).
   *
   * Assembled on the SERVER, rates included. The UI renders what it is given
   * and never divides: blueprint 13.2 defines the formulas, 10a implemented
   * them once as pure functions, and a browser recomputing them would be a
   * second copy that can disagree with the first. It also means the "null means
   * no data, not zero per cent" rule is enforced in one place rather than
   * trusted to every chart.
   */
  async overview(
    scope: WorkspaceScope,
    timezone: string,
    query: AnalyticsQuery,
    widgetNames: ReadonlyMap<string, string>,
  ): Promise<AnalyticsOverview> {
    const now = this.#deps.clock.now();
    const days = ANALYTICS_RANGES[query.range];

    /**
     * The range is resolved in the WORKSPACE's timezone, because that is the
     * calendar the aggregates were keyed by. Using UTC here would shift the
     * window by up to a day for anybody east or west of it and quietly drop or
     * double an edge day.
     */
    const toDay = query.to ?? localDayInZone(now, timezone);
    const fromDay =
      query.from ?? localDayInZone(new Date(now.getTime() - (days - 1) * 86_400_000), timezone);

    /**
     * Roll up the days that can still be receiving events, before reading.
     *
     * Blueprint 13.2 step 4: the dashboard "reads aggregates for historical
     * ranges and may combine recent raw data for freshness". This is that
     * clause, implemented as "make sure the recent days are rolled up" rather
     * than by merging raw rows into the response - which keeps ONE code path
     * producing counters and means the dashboard cannot disagree with the
     * scheduled sweep about what a day contained.
     *
     * Bounded to today and yesterday. Older days cannot receive new events, so
     * re-aggregating ninety of them on every page load would spend a scan to
     * arrive at the numbers already stored. Aggregation is idempotent, so doing
     * this alongside the hourly job is safe.
     */
    for (const day of recentDays(now, timezone)) {
      if (day >= fromDay && day <= toDay) await this.aggregateDay(scope, day);
    }

    const slices = await this.#deps.daily.listAllDimensions(scope, fromDay, toDay);
    const scoped =
      query.widgetId === undefined
        ? slices
        : slices.filter((row) => row.widgetId.toHexString() === query.widgetId);

    // --- totals and the daily series --------------------------------------

    const totalSlices = scoped.filter((row) => row.dimension === 'total');

    const byDay = new Map<string, FunnelCounts & { visitors: number }>();
    for (const row of totalSlices) {
      const existing = byDay.get(row.day) ?? { ...EMPTY_FUNNEL, visitors: 0 };
      byDay.set(row.day, {
        ...addCounts(existing, countsOf(row)),
        visitors: existing.visitors + row.visitors,
      });
    }

    /**
     * Every day in the range, including the empty ones.
     *
     * A trend line that silently skips quiet days is a lie about shape: two
     * points a fortnight apart drawn adjacent look like continuous traffic.
     */
    const daily = eachDay(fromDay, toDay).map((day) => {
      const found = byDay.get(day);
      return {
        day,
        counts: toCountsDto(found ?? { ...EMPTY_FUNNEL, visitors: 0 }, found?.visitors ?? 0),
      };
    });

    const totals = totalSlices.reduce<FunnelCounts>(
      (acc, row) => addCounts(acc, countsOf(row)),
      EMPTY_FUNNEL,
    );
    const totalVisitors = totalSlices.reduce((acc, row) => acc + row.visitors, 0);

    // --- per widget --------------------------------------------------------

    const perWidget = new Map<string, { counts: FunnelCounts; visitors: number }>();
    for (const row of totalSlices) {
      const key = row.widgetId.toHexString();
      const existing = perWidget.get(key) ?? { counts: EMPTY_FUNNEL, visitors: 0 };
      perWidget.set(key, {
        counts: addCounts(existing.counts, countsOf(row)),
        visitors: existing.visitors + row.visitors,
      });
    }

    const byWidget: WidgetPerformanceRow[] = [...perWidget.entries()]
      .map(([widgetId, value]) => ({
        widgetId,
        name: widgetNames.get(widgetId) ?? 'Removed widget',
        counts: toCountsDto(value.counts, value.visitors),
        rates: toRatesDto(value.counts),
      }))
      .sort((a, b) => b.counts.impressions - a.counts.impressions);

    // --- dimension breakdowns ---------------------------------------------

    const dimension = (name: string): DimensionRow[] => {
      const grouped = new Map<string, { counts: FunnelCounts; visitors: number }>();
      for (const row of scoped) {
        if (row.dimension !== name || row.dimensionValue === null) continue;
        const existing = grouped.get(row.dimensionValue) ?? { counts: EMPTY_FUNNEL, visitors: 0 };
        grouped.set(row.dimensionValue, {
          counts: addCounts(existing.counts, countsOf(row)),
          visitors: existing.visitors + row.visitors,
        });
      }
      return (
        [...grouped.entries()]
          .map(([value, entry]) => ({ value, counts: toCountsDto(entry.counts, entry.visitors) }))
          .sort((a, b) => b.counts.impressions - a.counts.impressions)
          // "Top" domains and pages, per blueprint 4.9 - a workspace with a
          // thousand distinct URLs does not want a thousand rows.
          .slice(0, 10)
      );
    };

    // --- the three non-funnel dashboards ----------------------------------

    const rangeStart = dayStartInZone(fromDay, timezone);
    const [statusCounts, deliveryCounts, abuseRows] = await Promise.all([
      this.#deps.contacts.countsByStatus(scope, rangeStart),
      this.#deps.deliveries.countsByStatus(scope),
      this.#deps.abuse.countsByType(scope, rangeStart),
    ]);

    const cohortSize = Object.values(statusCounts).reduce((acc, n) => acc + n, 0);
    const qualifiedOrConverted =
      (statusCounts['qualified'] ?? 0) + (statusCounts['converted'] ?? 0);

    const abuseByType: Record<string, number> = {};
    const abuseByDay = new Map<string, number>();
    for (const row of abuseRows) {
      abuseByType[row.type] = (abuseByType[row.type] ?? 0) + row.count;
      abuseByDay.set(row.day, (abuseByDay.get(row.day) ?? 0) + row.count);
    }

    return {
      from: fromDay,
      to: toDay,
      timezone,
      totals: toCountsDto(totals, totalVisitors),
      rates: toRatesDto(totals),
      daily,
      byWidget,
      byCountry: dimension('country'),
      byCity: dimension('city'),
      byDomain: dimension('domain'),
      byPage: dimension('page'),
      status: {
        counts: statusCounts,
        cohortSize,
        qualifiedOrConverted,
        conversion: statusConversion(qualifiedOrConverted, cohortSize),
      },
      delivery: {
        delivered: deliveryCounts['delivered'] ?? 0,
        failed: deliveryCounts['failed'] ?? 0,
        deadLetter: deliveryCounts['dead_letter'] ?? 0,
        pending:
          (deliveryCounts['queued'] ?? 0) +
          (deliveryCounts['delayed'] ?? 0) +
          (deliveryCounts['retrying'] ?? 0),
      },
      abuse: {
        byType: abuseByType,
        daily: [...abuseByDay.entries()]
          .map(([day, count]) => ({ day, count }))
          .sort((a, b) => a.day.localeCompare(b.day)),
        total: Object.values(abuseByType).reduce((acc, n) => acc + n, 0),
      },
    };
  }

  /** Events this workspace has recorded in its own current month (4.10). */
  async eventsThisMonth(scope: WorkspaceScope, timezone: string): Promise<number> {
    return this.#deps.events.countSince(scope, monthStartInZone(this.#deps.clock.now(), timezone));
  }
}

// ---------------------------------------------------------------------------

/** Today and yesterday, in the workspace's zone - the days still in motion. */
function recentDays(now: Date, timeZone: string): readonly string[] {
  return [
    localDayInZone(new Date(now.getTime() - 86_400_000), timeZone),
    localDayInZone(now, timeZone),
  ];
}

function countsOf(row: {
  impressions: number;
  opens: number;
  ctaClicks: number;
  formStarts: number;
  submissions: number;
  openEligible: boolean;
}): FunnelCounts {
  return {
    impressions: row.impressions,
    opens: row.opens,
    ctaClicks: row.ctaClicks,
    formStarts: row.formStarts,
    submissions: row.submissions,
    // Only an openable widget's impressions count toward the open-rate
    // denominator (blueprint 13.2).
    eligibleImpressions: row.openEligible ? row.impressions : 0,
  };
}

function toCountsDto(counts: FunnelCounts, visitors: number): FunnelCountsDto {
  return { ...counts, visitors };
}

function toRatesDto(counts: FunnelCounts): FunnelRatesDto {
  const metrics = funnelMetrics(counts);
  return {
    openRate: metrics.openRate,
    formStartRate: metrics.formStartRate,
    submissionConversion: metrics.submissionConversion,
    ctaClickThrough: metrics.ctaClickThrough.value,
    ctaBasis: metrics.ctaClickThrough.basis,
  };
}

/** Every `YYYY-MM-DD` from `from` to `to` inclusive. */
function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  // Bounded, so a malformed range cannot spin: 400 days is far past the 90 the
  // longest preset asks for.
  for (let guard = 0; cursor <= end && guard < 400; guard += 1) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * The instant a local calendar day begins, in UTC.
 *
 * Used to bound the collections that store real timestamps rather than a
 * `localDay` string - contacts and abuse events - so their cohort matches the
 * aggregate's window instead of being a day out for anybody not on UTC.
 */
function dayStartInZone(day: string, timeZone: string): Date {
  const midday = new Date(`${day}T12:00:00.000Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(midday);
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const localAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  const offsetMs = localAsUtc - midday.getTime();
  const [year = 1970, month = 1, dayOfMonth = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, dayOfMonth, 0, 0, 0) - offsetMs);
}

/**
 * The calendar day an instant falls in, for a given zone, as `YYYY-MM-DD`.
 *
 * Uses `Intl` rather than an offset arithmetic, for the same reason
 * `monthStartInZone` does: a fixed offset is wrong twice a year.
 */
export function localDayInZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '00';
  // en-CA already formats as YYYY-MM-DD, but the parts are assembled explicitly
  // so a locale-data change cannot quietly reorder them.
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

export type { InteractionEventType };
