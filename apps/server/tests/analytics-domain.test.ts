import { describe, expect, it } from 'vitest';
import {
  EMPTY_FUNNEL,
  addCounts,
  ctaClickThrough,
  formStartRate,
  funnelMetrics,
  openRate,
  rate,
  statusConversion,
  submissionConversion,
  sumCounts,
  type FunnelCounts,
} from '../src/domain/analytics/funnel.js';
import { visitorPeriod, visitorPseudonym } from '../src/domain/analytics/visitor-pseudonym.js';
import { ipPseudonym } from '../src/domain/submission/ip-pseudonym.js';
import { localDayInZone } from '../src/application/analytics/analytics-service.js';
import { monthStartInZone } from '../src/domain/submission/quota.js';

/**
 * Pure analytics rules (blueprint 13.2, 9.4).
 *
 * The funnel formulas are transcribed from 13.2 and consumed as-is by Stage
 * 10b's dashboards, so their edge cases are tested here rather than discovered
 * on a chart. The pseudonym is tested because it is the whole of this stage's
 * privacy promise.
 */

const SECRET = 'unit-test-only-not-a-real-secret';

function counts(overrides: Partial<FunnelCounts> = {}): FunnelCounts {
  return { ...EMPTY_FUNNEL, ...overrides };
}

describe('rate (blueprint 13.2)', () => {
  it('returns null rather than zero when the denominator is zero', () => {
    /**
     * The single most consequential decision in the module. A rate of 0 asserts
     * "people saw it and nobody acted"; a day with no impressions supports no
     * such claim. Returning 0 would make an untouched widget look like a
     * failing one and drag any average that includes it downward.
     */
    expect(rate(0, 0)).toBeNull();
    expect(rate(5, 0)).toBeNull();
    expect(rate(0, 10)).toBe(0);
  });

  it('rounds to four places, so an export is not full of float noise', () => {
    expect(rate(1, 3)).toBe(0.3333);
    expect(rate(2, 3)).toBe(0.6667);
    expect(rate(1, 2)).toBe(0.5);
  });

  it('treats a negative denominator as no data rather than dividing', () => {
    expect(rate(1, -5)).toBeNull();
  });
});

describe('the five funnel metrics (blueprint 13.2)', () => {
  it('open rate is opens over ELIGIBLE impressions', () => {
    /**
     * The qualifier matters. An inline widget is always visible and cannot be
     * opened; counting its impressions would drag a mixed workspace's open rate
     * toward zero for a reason that is not about performance.
     */
    expect(openRate(counts({ opens: 5, impressions: 100, eligibleImpressions: 10 }))).toBe(0.5);
  });

  it('open rate is null when nothing eligible was shown', () => {
    expect(openRate(counts({ opens: 0, impressions: 100, eligibleImpressions: 0 }))).toBeNull();
  });

  it('form-start rate is form starts over opens', () => {
    expect(formStartRate(counts({ formStarts: 3, opens: 12 }))).toBe(0.25);
    expect(formStartRate(counts({ formStarts: 0, opens: 0 }))).toBeNull();
  });

  it('submission conversion is submissions over form starts', () => {
    expect(submissionConversion(counts({ submissions: 2, formStarts: 8 }))).toBe(0.25);
    expect(submissionConversion(counts({ submissions: 0, formStarts: 0 }))).toBeNull();
  });

  it('CTA click-through prefers opens and says which basis it used', () => {
    // Blueprint 13.2 allows either denominator but requires it be "labeled
    // consistently", so the label travels with the number.
    expect(ctaClickThrough(counts({ ctaClicks: 3, opens: 6, impressions: 100 }))).toEqual({
      value: 0.5,
      basis: 'opens',
    });
  });

  it('CTA click-through falls back to impressions when nothing opens', () => {
    expect(ctaClickThrough(counts({ ctaClicks: 4, opens: 0, impressions: 16 }))).toEqual({
      value: 0.25,
      basis: 'impressions',
    });
  });

  it('CTA click-through has no basis at all when there is no data', () => {
    expect(ctaClickThrough(EMPTY_FUNNEL)).toEqual({ value: null, basis: null });
  });

  it('status conversion counts qualified and converted over the cohort', () => {
    expect(statusConversion(3, 12)).toBe(0.25);
    expect(statusConversion(0, 0)).toBeNull();
  });

  it('reports every metric as null for a day with no traffic', () => {
    const metrics = funnelMetrics(EMPTY_FUNNEL);
    expect(metrics.openRate).toBeNull();
    expect(metrics.formStartRate).toBeNull();
    expect(metrics.submissionConversion).toBeNull();
    expect(metrics.ctaClickThrough.value).toBeNull();
  });

  it('allows a rate above 1 rather than silently clamping it', () => {
    /**
     * More form starts than opens should never happen, and if it does it is a
     * bug in the instrumentation. Clamping to 1 would hide that; reporting 1.5
     * makes it visible on the dashboard where somebody will notice.
     */
    expect(formStartRate(counts({ formStarts: 3, opens: 2 }))).toBe(1.5);
  });
});

describe('rolling days into a range', () => {
  it('sums counts rather than averaging rates', () => {
    /**
     * Averaging four days of percentages gives a quiet Sunday with one
     * impression the same weight as a Monday with a thousand. Summing the
     * counts and dividing once is the only version that is right.
     */
    const monday = counts({ opens: 100, eligibleImpressions: 1000 });
    const sunday = counts({ opens: 1, eligibleImpressions: 1 });

    const naiveAverage = ((openRate(monday) ?? 0) + (openRate(sunday) ?? 0)) / 2;
    const correct = openRate(addCounts(monday, sunday));

    expect(naiveAverage).toBeCloseTo(0.55, 2);
    expect(correct).toBeCloseTo(0.1009, 3);
  });

  it('sums an empty list to the empty funnel', () => {
    expect(sumCounts([])).toEqual(EMPTY_FUNNEL);
  });

  it('adds every field', () => {
    const total = sumCounts([
      counts({
        impressions: 1,
        opens: 2,
        ctaClicks: 3,
        formStarts: 4,
        submissions: 5,
        eligibleImpressions: 6,
      }),
      counts({
        impressions: 10,
        opens: 20,
        ctaClicks: 30,
        formStarts: 40,
        submissions: 50,
        eligibleImpressions: 60,
      }),
    ]);
    expect(total).toEqual({
      impressions: 11,
      opens: 22,
      ctaClicks: 33,
      formStarts: 44,
      submissions: 55,
      eligibleImpressions: 66,
    });
  });
});

describe('the rotating visitor pseudonym (blueprint 9.4)', () => {
  const january = new Date('2026-01-15T12:00:00.000Z');
  const february = new Date('2026-02-15T12:00:00.000Z');

  it('is stable for one visitor and one widget within a period', () => {
    const first = visitorPseudonym(SECRET, '203.0.113.5', 'w_abc', january);
    const second = visitorPseudonym(SECRET, '203.0.113.5', 'w_abc', january);
    expect(first.value).toBe(second.value);
    expect(first.period).toBe('2026-01');
  });

  it('changes when the month turns, so linkage does not outlive the window', () => {
    expect(visitorPseudonym(SECRET, '203.0.113.5', 'w_abc', february).value).not.toBe(
      visitorPseudonym(SECRET, '203.0.113.5', 'w_abc', january).value,
    );
  });

  it('DIFFERS per widget, so it is not a cross-site tracking identifier', () => {
    /**
     * The property blueprint 21 asks for by name. Without it, one visitor would
     * carry a single identifier across every customer site that embeds this
     * platform - which is the thing the whole design exists not to build.
     */
    expect(visitorPseudonym(SECRET, '203.0.113.5', 'w_abc', january).value).not.toBe(
      visitorPseudonym(SECRET, '203.0.113.5', 'w_xyz', january).value,
    );
  });

  it('is DOMAIN-SEPARATED from the submission path IP pseudonym', () => {
    /**
     * Both are derived from the same secret and the same address. Without a
     * distinct subkey label they would be identical strings, and joining the
     * analytics and abuse-evidence collections would reunite "who browsed" with
     * "who was rate limited" - exactly the linkage 9.4 forbids.
     */
    const analytics = visitorPseudonym(SECRET, '203.0.113.5', 'w_abc', january).value;
    const abuse = ipPseudonym(SECRET, '203.0.113.5', january).value;
    expect(analytics).not.toBe(abuse);
  });

  it('separates two addresses and never contains the input', () => {
    const value = visitorPseudonym(SECRET, '203.0.113.5', 'w_abc', january).value;
    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(value).not.toContain('203');
    expect(value).not.toBe(visitorPseudonym(SECRET, '203.0.113.6', 'w_abc', january).value);
  });

  it('changes completely if the key material changes', () => {
    expect(visitorPseudonym('another-secret', '203.0.113.5', 'w_abc', january).value).not.toBe(
      visitorPseudonym(SECRET, '203.0.113.5', 'w_abc', january).value,
    );
  });

  it('writes the period as a UTC year-month', () => {
    expect(visitorPeriod(new Date('2026-03-01T00:00:00.000Z'))).toBe('2026-03');
    expect(visitorPeriod(new Date('2026-02-28T23:59:59.000Z'))).toBe('2026-02');
  });
});

describe('the day an event belongs to (blueprint 4.10)', () => {
  it('uses the WORKSPACE timezone, not UTC', () => {
    /**
     * 1 March 00:30 in Auckland is still 28 February in UTC. Two workspaces
     * looking at the same instant disagree about which day it is, and the
     * aggregate has to follow the customer's calendar rather than the server's.
     */
    const instant = new Date('2026-02-28T11:30:00.000Z');
    expect(localDayInZone(instant, 'Pacific/Auckland')).toBe('2026-03-01');
    expect(localDayInZone(instant, 'UTC')).toBe('2026-02-28');
    expect(localDayInZone(instant, 'America/Los_Angeles')).toBe('2026-02-28');
  });

  it('agrees with the month boundary the quota enforces', () => {
    /**
     * The meter and the gate must never disagree about when a month turned, so
     * both derive from `monthStartInZone`. This asserts they line up: the first
     * local day of the month is the day the month start falls on.
     */
    const now = new Date('2026-02-28T11:30:00.000Z');
    const zone = 'Pacific/Auckland';
    const start = monthStartInZone(now, zone);
    expect(localDayInZone(start, zone)).toBe('2026-03-01');
    expect(localDayInZone(now, zone)).toBe('2026-03-01');
  });

  it('pads single-digit months and days', () => {
    expect(localDayInZone(new Date('2026-01-05T12:00:00.000Z'), 'UTC')).toBe('2026-01-05');
  });
});
