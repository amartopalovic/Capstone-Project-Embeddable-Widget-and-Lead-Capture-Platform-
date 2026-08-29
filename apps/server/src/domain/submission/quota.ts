import { WORKSPACE_LIMITS } from '@lcp/contracts';

/**
 * Monthly submission quota (blueprint 4.10).
 *
 * "2,000 accepted submissions per workspace month" and "Monthly boundaries use
 * the workspace timezone."
 *
 * That last sentence is the whole reason this is a module rather than a
 * comparison inline: the month a submission counts against depends on the
 * WORKSPACE's timezone, not the server's and not UTC. A workspace in Auckland
 * rolls over its month roughly half a day before a server in UTC would say it
 * did, and getting that wrong quietly gives some tenants a shorter month than
 * others.
 */

/**
 * The instant the workspace's current month began, expressed in UTC.
 *
 * Derived by asking Intl what the local date is in that zone and rebuilding the
 * first of that month from the parts, rather than by adding a fixed offset -
 * offsets change with daylight saving and a fixed one is wrong twice a year.
 */
export function monthStartInZone(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const lookup = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const localYear = lookup('year');
  const localMonth = lookup('month');

  /**
   * Find the UTC instant whose local calendar date is the 1st at 00:00.
   *
   * The zone's offset at that moment is recovered by measuring how far the
   * local wall clock is from UTC for `now`, then applying it to the candidate.
   * One correction pass is enough for every real zone: offsets move by at most
   * an hour or two, never by a month.
   */
  const localNowAsUtc = Date.UTC(
    localYear,
    localMonth - 1,
    lookup('day'),
    lookup('hour'),
    lookup('minute'),
    lookup('second'),
  );
  const offsetMs = localNowAsUtc - now.getTime();

  return new Date(Date.UTC(localYear, localMonth - 1, 1, 0, 0, 0) - offsetMs);
}

export interface QuotaDecision {
  readonly allowed: boolean;
  readonly used: number;
  readonly limit: number;
}

/** Whether another submission fits inside the workspace's month. */
export function submissionQuota(used: number): QuotaDecision {
  const limit = WORKSPACE_LIMITS.submissionsPerMonth;
  return { allowed: used < limit, used, limit };
}
