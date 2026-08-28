/**
 * IANA time-zone validation for onboarding (blueprint 4.1).
 *
 * Validation constructs an `Intl.DateTimeFormat` for the zone and catches the
 * RangeError, rather than checking membership of
 * `Intl.supportedValuesOf('timeZone')`.
 *
 * That choice is not stylistic. On this runtime `supportedValuesOf` returns 418
 * zones and omits several that are both valid and common:
 *
 *   UTC              accepted by DateTimeFormat, NOT in supportedValuesOf
 *   Etc/UTC          accepted by DateTimeFormat, NOT in supportedValuesOf
 *   Asia/Kolkata     accepted by DateTimeFormat, NOT in supportedValuesOf
 *                    (the list carries the legacy alias Asia/Calcutta instead)
 *
 * A membership check would therefore reject `UTC` and the canonical spelling of
 * a zone used by a sixth of the world. Construction accepts every zone the
 * runtime can actually compute with, which is the property that matters, since
 * the zone is used for month boundaries on usage meters (blueprint 4.10).
 */

export function isValidTimezone(zone: string): boolean {
  if (zone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * A conservative default when the client offers nothing usable.
 *
 * UTC is chosen over guessing from the server clock: a wrong guess silently
 * shifts every monthly usage boundary, and the user confirms the zone during
 * onboarding anyway.
 */
export const FALLBACK_TIMEZONE = 'UTC';

export function normaliseTimezone(zone: string | undefined): string {
  if (zone === undefined) return FALLBACK_TIMEZONE;
  const trimmed = zone.trim();
  return isValidTimezone(trimmed) ? trimmed : FALLBACK_TIMEZONE;
}
