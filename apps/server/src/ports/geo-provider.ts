import type { GeoSnapshot } from '@lcp/database';

/**
 * IP-to-geo enrichment port (blueprint 5.1, 7.3 step 8, 9.4).
 *
 * "Geo provider A is attempted with a strict timeout, then provider B. If both
 * fail, storage still succeeds without geo."
 *
 * A port rather than a direct call, for one reason that matters more than
 * tidiness: blueprint 18.4 requires DETERMINISTIC provider tests. Proving "A
 * down, B enriches" and "both down, submission still stored" cannot depend on
 * an external service actually being down when the suite runs.
 */

export type GeoLookup = Omit<GeoSnapshot, 'usedFallback'>;

export interface GeoProvider {
  /** Stable name recorded on the snapshot, e.g. `ip-api`. */
  readonly name: string;
  /**
   * Resolve an address, or return null when this provider cannot.
   *
   * Implementations must never throw: geo is optional enrichment and a provider
   * outage must not be able to reject a lead. A timeout, a bad status, a
   * malformed body, and a private address are all simply null.
   */
  lookup(ip: string): Promise<GeoLookup | null>;
}
