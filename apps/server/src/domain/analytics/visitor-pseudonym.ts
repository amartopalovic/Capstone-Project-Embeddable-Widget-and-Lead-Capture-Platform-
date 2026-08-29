import { createHmac } from 'node:crypto';

/**
 * The rotating pseudonymous visitor ID (blueprint 9.4, 13.2 step 2).
 *
 * Built on exactly the same construction as the submission path's IP
 * pseudonym, and for the same reasons - keyed HMAC because the IPv4 space is
 * enumerable, a per-period subkey so a leaked key exposes one month, and the
 * period stored alongside the value so an old event stays interpretable.
 *
 * What differs is the DOMAIN SEPARATOR. The two pseudonyms are derived from
 * the same master secret and the same input, so without a separator a visitor's
 * analytics id and their abuse-evidence id would be the same string - and
 * joining the two collections would reunite "who browsed" with "who was rate
 * limited", which is precisely the linkage 9.4 exists to prevent. Different
 * label, different subkey, unrelated values.
 *
 * The pseudonym is additionally scoped to ONE WIDGET. Blueprint 21 names the
 * mitigation as a "per-widget pseudonym": without it, the same visitor would
 * carry one identifier across every customer's site that embeds this platform,
 * which is a cross-site tracking identifier by any other name - the thing the
 * whole design is trying not to build.
 */

/** `YYYY-MM`, in UTC, matching the submission path's rotation period. */
export function visitorPeriod(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export interface VisitorPseudonym {
  readonly value: string;
  readonly period: string;
}

function periodKey(masterSecret: string, period: string): Buffer {
  // The label is what separates this key from `ip-pseudonym:<period>`.
  return createHmac('sha256', masterSecret).update(`visitor-pseudonym:${period}`).digest();
}

/**
 * Derive a visitor pseudonym for one widget and one rotation period.
 *
 * The raw address goes in and never comes back out; callers keep the returned
 * value and never the input.
 */
export function visitorPseudonym(
  masterSecret: string,
  ip: string,
  publicWidgetId: string,
  now: Date,
): VisitorPseudonym {
  const period = visitorPeriod(now);
  const value = createHmac('sha256', periodKey(masterSecret, period))
    // The widget id is inside the HMAC rather than concatenated onto the
    // result, so a visitor's pseudonyms for two widgets cannot be related by
    // inspection.
    .update(`${publicWidgetId}|${ip.trim().toLowerCase()}`)
    .digest('hex');
  return { value, period };
}
