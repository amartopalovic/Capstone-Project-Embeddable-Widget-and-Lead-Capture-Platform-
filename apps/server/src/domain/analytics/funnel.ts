/**
 * The funnel metrics (blueprint 13.2).
 *
 * The blueprint defines five, and they are transcribed here one function per
 * line of the spec so the two can be diffed by eye:
 *
 *   open rate            = opens / eligible impressions
 *   form-start rate      = form starts / opens
 *   submission conversion= accepted submissions / form starts
 *   CTA click-through    = CTA clicks / CTA opens or impressions, labeled consistently
 *   status conversion    = Contacts reaching Qualified or Converted within the cohort
 *
 * Every one of them is a division, and every division here can have a zero
 * denominator on a perfectly ordinary day - a widget nobody saw, a form nobody
 * started. So the single most important decision in this file is what zero over
 * zero means, and the answer is `null` rather than 0.
 *
 * A rate of 0 asserts something: "people saw it and nobody opened it." A day
 * with no impressions supports no such claim. Returning 0 would make an
 * untouched widget look like a failing one, and averaging those zeroes into a
 * trend line would drag a real figure down with data that does not exist.
 * `null` forces Stage 10b to render "no data" rather than a lie.
 */

export interface FunnelCounts {
  readonly impressions: number;
  readonly opens: number;
  readonly ctaClicks: number;
  readonly formStarts: number;
  readonly submissions: number;
  /**
   * Impressions of widgets that CAN be opened.
   *
   * Blueprint 13.2 says "eligible impressions", and the qualifier is load
   * bearing: an inline widget is always visible and has no open action, so
   * counting it in the denominator would drag every mixed workspace's open rate
   * toward zero for a reason that has nothing to do with performance.
   */
  readonly eligibleImpressions: number;
}

export const EMPTY_FUNNEL: FunnelCounts = {
  impressions: 0,
  opens: 0,
  ctaClicks: 0,
  formStarts: 0,
  submissions: 0,
  eligibleImpressions: 0,
};

/**
 * A ratio, or null when the denominator is zero.
 *
 * Rounded to four decimal places rather than left as a raw float: these are
 * rendered as percentages to at most one decimal, and carrying full binary
 * float noise into a dashboard only produces values like 33.33333333333333 in
 * an export.
 */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

/** opens / eligible impressions. */
export function openRate(counts: FunnelCounts): number | null {
  return rate(counts.opens, counts.eligibleImpressions);
}

/** form starts / opens. */
export function formStartRate(counts: FunnelCounts): number | null {
  return rate(counts.formStarts, counts.opens);
}

/** accepted submissions / form starts. */
export function submissionConversion(counts: FunnelCounts): number | null {
  return rate(counts.submissions, counts.formStarts);
}

/**
 * CTA clicks over opens, or over impressions when nothing opens.
 *
 * Blueprint 13.2 allows either denominator but insists it is "labeled
 * consistently", so the label travels with the number rather than being left
 * for a dashboard to guess. A CTA popover that opens on a trigger is measured
 * against opens; an always-visible inline CTA has no opens, so impressions are
 * the only honest denominator.
 */
export interface ClickThrough {
  readonly value: number | null;
  readonly basis: 'opens' | 'impressions' | null;
}

export function ctaClickThrough(counts: FunnelCounts): ClickThrough {
  if (counts.opens > 0) return { value: rate(counts.ctaClicks, counts.opens), basis: 'opens' };
  if (counts.impressions > 0) {
    return { value: rate(counts.ctaClicks, counts.impressions), basis: 'impressions' };
  }
  return { value: null, basis: null };
}

/**
 * Contacts reaching Qualified or Converted, over the cohort.
 *
 * The one metric not derived from interaction events: it reads Contact status,
 * which is why it takes its counts rather than a FunnelCounts. Blueprint 4.6
 * lists the five statuses in pipeline order, and both terminal-positive ones
 * count - a lead that converted also qualified on the way.
 */
export function statusConversion(qualifiedOrConverted: number, cohortSize: number): number | null {
  return rate(qualifiedOrConverted, cohortSize);
}

export interface FunnelMetrics {
  readonly counts: FunnelCounts;
  readonly openRate: number | null;
  readonly formStartRate: number | null;
  readonly submissionConversion: number | null;
  readonly ctaClickThrough: ClickThrough;
}

/** Every interaction-derived metric for one set of counts. */
export function funnelMetrics(counts: FunnelCounts): FunnelMetrics {
  return {
    counts,
    openRate: openRate(counts),
    formStartRate: formStartRate(counts),
    submissionConversion: submissionConversion(counts),
    ctaClickThrough: ctaClickThrough(counts),
  };
}

/**
 * Add two sets of counts.
 *
 * Used to roll daily aggregates into a range. Deliberately a sum of COUNTS and
 * never of rates: averaging four days of percentages gives every day equal
 * weight regardless of traffic, so a quiet Sunday with one impression and one
 * open would count as much as a Monday with a thousand. Summing first and
 * dividing once is the only version that gives the right answer.
 */
export function addCounts(left: FunnelCounts, right: FunnelCounts): FunnelCounts {
  return {
    impressions: left.impressions + right.impressions,
    opens: left.opens + right.opens,
    ctaClicks: left.ctaClicks + right.ctaClicks,
    formStarts: left.formStarts + right.formStarts,
    submissions: left.submissions + right.submissions,
    eligibleImpressions: left.eligibleImpressions + right.eligibleImpressions,
  };
}

export function sumCounts(all: readonly FunnelCounts[]): FunnelCounts {
  return all.reduce(addCounts, EMPTY_FUNNEL);
}
