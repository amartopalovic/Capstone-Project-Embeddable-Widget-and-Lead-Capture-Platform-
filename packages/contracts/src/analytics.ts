/**
 * Analytics contracts (blueprint 4.9, 13.2).
 *
 * Shared by the public event endpoint, the widget runtime that posts to it, and
 * Stage 10b's dashboards - so the five event names exist in exactly one place
 * and the runtime cannot invent a sixth.
 */

import * as z from 'zod';

/** The five funnel events (blueprint 4.9). */
export const INTERACTION_EVENT_VALUES = [
  'impression',
  'open',
  'cta_click',
  'form_start',
  'submission',
] as const;
export type InteractionEventValue = (typeof INTERACTION_EVENT_VALUES)[number];

/**
 * Limits for the public event endpoint.
 *
 * Much smaller than the submission path's 32 KB: an event carries a type, a
 * page URL, and nothing else. A generous limit here would only ever be useful
 * to somebody abusing it.
 */
export const EVENT_MAX_BODY_BYTES = '8kb';
export const EVENT_MAX_BATCH = 20;
export const EVENT_MAX_PAGE_URL_LENGTH = 2048;

/**
 * One event in a batch.
 *
 * There is deliberately no visitor identifier field. The server derives the
 * rotating pseudonym from the request; accepting one from the client would let
 * a caller choose their own identity, which makes the distinct-visitor count
 * meaningless and hands anyone a way to impersonate a visitor.
 */
export const interactionEventSchema = z.object({
  type: z.enum(INTERACTION_EVENT_VALUES),
  /** The page the widget was on. Validated as a URL, stored as given. */
  pageUrl: z.string().trim().max(EVENT_MAX_PAGE_URL_LENGTH).optional(),
  /**
   * When the runtime observed it, as epoch milliseconds.
   *
   * Advisory only: the server timestamps the event itself. A client clock can
   * be wrong or hostile, and letting it decide which day a count lands in would
   * let a caller backdate events into an already-aggregated day.
   */
  observedAt: z.number().int().optional(),
});
export type InteractionEventInput = z.infer<typeof interactionEventSchema>;

export const interactionBatchSchema = z.object({
  events: z.array(interactionEventSchema).min(1).max(EVENT_MAX_BATCH),
});
export type InteractionBatchInput = z.infer<typeof interactionBatchSchema>;

/**
 * The endpoint's answer.
 *
 * Uniform whether events were stored, dropped for quota, or throttled - the
 * same discipline as the submission path's acknowledgement. A widget has
 * nothing useful to do with the difference, and telling a caller which of their
 * events were counted is a free measurement of our own limits.
 */
export interface InteractionAck {
  readonly status: 'received';
  readonly accepted: number;
}

// ---------------------------------------------------------------------------
// Aggregates, for Stage 10b
// ---------------------------------------------------------------------------

export const ANALYTICS_DIMENSION_VALUES = ['total', 'domain', 'page', 'country', 'city'] as const;
export type AnalyticsDimensionValue = (typeof ANALYTICS_DIMENSION_VALUES)[number];

export interface FunnelCountsDto {
  readonly impressions: number;
  readonly opens: number;
  readonly ctaClicks: number;
  readonly formStarts: number;
  readonly submissions: number;
  readonly eligibleImpressions: number;
  /**
   * Distinct visitors, counted PER DAY and per slice.
   *
   * The aggregate keeps a count rather than the pseudonyms behind it, so
   * adding this across a range double-counts anyone who came back - a range
   * total is NOT a unique-visitor figure and must never be presented as one.
   * The counts above are events and add up cleanly; this one does not.
   */
  readonly visitors: number;
}

export interface FunnelRatesDto {
  /** Null means "no data", never "zero per cent" - see domain/analytics/funnel. */
  readonly openRate: number | null;
  readonly formStartRate: number | null;
  readonly submissionConversion: number | null;
  readonly ctaClickThrough: number | null;
  /** Which denominator the click-through used (blueprint 13.2). */
  readonly ctaBasis: 'opens' | 'impressions' | null;
}

export interface DailyPoint {
  readonly day: string;
  readonly counts: FunnelCountsDto;
}

export interface DimensionRow {
  readonly value: string;
  readonly counts: FunnelCountsDto;
}

/** One widget's slice, with its own derived rates (blueprint 4.9). */
export interface WidgetPerformanceRow {
  readonly widgetId: string;
  readonly name: string;
  readonly counts: FunnelCountsDto;
  readonly rates: FunnelRatesDto;
}

/** Contacts by status, and the conversion derived from them (13.2). */
export interface StatusBreakdown {
  readonly counts: Readonly<Record<string, number>>;
  readonly cohortSize: number;
  readonly qualifiedOrConverted: number;
  readonly conversion: number | null;
}

/** Delivery health headline, for dashboard 7 (blueprint 4.9). */
export interface DeliveryHealthSummary {
  readonly delivered: number;
  readonly failed: number;
  readonly deadLetter: number;
  readonly pending: number;
}

/** Spam and throttling activity, for dashboard 8 (blueprint 4.9, 7.4). */
export interface AbuseSummary {
  readonly byType: Readonly<Record<string, number>>;
  readonly daily: readonly { readonly day: string; readonly count: number }[];
  readonly total: number;
}

export interface AnalyticsOverview {
  readonly from: string;
  readonly to: string;
  /** The workspace timezone the day boundaries were computed in (4.10). */
  readonly timezone: string;
  readonly totals: FunnelCountsDto;
  readonly rates: FunnelRatesDto;
  readonly daily: readonly DailyPoint[];
  readonly byWidget: readonly WidgetPerformanceRow[];
  readonly byCountry: readonly DimensionRow[];
  readonly byCity: readonly DimensionRow[];
  readonly byDomain: readonly DimensionRow[];
  readonly byPage: readonly DimensionRow[];
  readonly status: StatusBreakdown;
  readonly delivery: DeliveryHealthSummary;
  readonly abuse: AbuseSummary;
}

/**
 * The ranges the picker offers.
 *
 * A closed list rather than an arbitrary span: every option maps to a day count
 * the server resolves against the WORKSPACE's timezone, so "last 7 days" means
 * the same seven days to the picker, the query, and the aggregate.
 */
export const ANALYTICS_RANGES = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
} as const;
export type AnalyticsRange = keyof typeof ANALYTICS_RANGES;

export const ANALYTICS_RANGE_LABELS: Readonly<Record<AnalyticsRange, string>> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

export const analyticsQuerySchema = z.object({
  range: z.enum(['7d', '30d', '90d']).default('30d'),
  /** Inclusive `YYYY-MM-DD` bounds in the workspace's own timezone. */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  widgetId: z
    .string()
    .regex(/^[0-9a-f]{24}$/)
    .optional(),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

// ---------------------------------------------------------------------------
// Live updates (blueprint 13.1)
// ---------------------------------------------------------------------------

/** Payload of a `usage.changed` SSE event. */
export interface UsageChangedEvent {
  readonly submissionsThisMonth: number;
  readonly interactionEventsThisMonth: number;
  readonly activeWidgets: number;
  readonly users: number;
}

/** Payload of a `delivery.status_changed` SSE event. */
export interface DeliveryStatusChangedEvent {
  readonly deliveryId: string;
  readonly type: string;
  readonly status: string;
  readonly attempts: number;
}
