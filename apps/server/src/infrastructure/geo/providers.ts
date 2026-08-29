import type { Logger } from '@lcp/contracts';
import type { GeoSnapshot } from '@lcp/database';
import type { GeoLookup, GeoProvider } from '../../ports/geo-provider.js';

/**
 * Geo enrichment adapters (blueprint 5.1: ip-api.com primary, ipapi.co
 * fallback) and the chain that runs them.
 *
 * Every provider here obeys the same contract: never throw, never hang. Geo is
 * optional enrichment on the most important write path in the product, and a
 * provider outage that could reject a lead would be a far worse bug than a
 * submission stored without a country name.
 */

/**
 * Strict per-provider timeout (blueprint 7.3 step 8, 8.3).
 *
 * Both providers are consulted in sequence in the worst case, so this is half
 * the budget the whole enrichment step may spend. 1.5 seconds is comfortably
 * above a healthy round trip to either service and low enough that two
 * failures add three seconds rather than stalling the request behind a hung
 * socket.
 */
export const GEO_TIMEOUT_MS = 1_500;

/** Addresses no geo service can answer for; asking wastes the budget. */
export function isPrivateAddress(ip: string): boolean {
  const value = ip.trim().toLowerCase();
  if (value === '' || value === '::1' || value === 'localhost') return true;
  if (value.startsWith('127.') || value.startsWith('10.') || value.startsWith('192.168.')) {
    return true;
  }
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  // 172.16.0.0 - 172.31.255.255
  const parts = value.split('.');
  if (parts.length === 4 && parts[0] === '172') {
    const second = Number(parts[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    // Abort, DNS failure, connection reset, malformed JSON - all the same
    // answer to the caller: this provider did not enrich.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Provider A: ip-api.com.
 *
 * Its free endpoint is HTTP-only and limited to 45 requests per minute per
 * source IP, and its own terms exclude commercial use - all acceptable for a
 * portfolio demo, and all reasons this is behind a port that can be swapped
 * without touching the submission path.
 *
 * `fields` is narrowed to what blueprint 9.4 permits us to persist, so the
 * response never carries data we have no business storing.
 */
export class IpApiGeoProvider implements GeoProvider {
  readonly name = 'ip-api';
  readonly #timeoutMs: number;

  constructor(timeoutMs = GEO_TIMEOUT_MS) {
    this.#timeoutMs = timeoutMs;
  }

  async lookup(ip: string): Promise<GeoLookup | null> {
    if (isPrivateAddress(ip)) return null;

    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,timezone`;
    const body = await fetchJson(url, this.#timeoutMs);
    if (body === null || typeof body !== 'object') return null;

    const data = body as Record<string, unknown>;
    // ip-api reports failure in the BODY with a 200, so the status field is the
    // real success signal rather than the HTTP code.
    if (data['status'] !== 'success') return null;

    return {
      countryCode: text(data['countryCode']),
      countryName: text(data['country']),
      region: text(data['regionName']),
      city: text(data['city']),
      timezone: text(data['timezone']),
      provider: this.name,
    };
  }
}

/** Provider B: ipapi.co, consulted only when A did not answer. */
export class IpapiCoGeoProvider implements GeoProvider {
  readonly name = 'ipapi-co';
  readonly #timeoutMs: number;

  constructor(timeoutMs = GEO_TIMEOUT_MS) {
    this.#timeoutMs = timeoutMs;
  }

  async lookup(ip: string): Promise<GeoLookup | null> {
    if (isPrivateAddress(ip)) return null;

    const body = await fetchJson(
      `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
      this.#timeoutMs,
    );
    if (body === null || typeof body !== 'object') return null;

    const data = body as Record<string, unknown>;
    if (data['error'] === true) return null;
    if (text(data['country_code']) === null) return null;

    return {
      countryCode: text(data['country_code']),
      countryName: text(data['country_name']),
      region: text(data['region']),
      city: text(data['city']),
      timezone: text(data['timezone']),
      provider: this.name,
    };
  }
}

/**
 * A provider that never enriches.
 *
 * The default outside production. Local development and the test suite must not
 * depend on - or hammer - a free third-party service, and a submission stored
 * without geo is an outcome the blueprint explicitly supports.
 */
export class NullGeoProvider implements GeoProvider {
  readonly name = 'none';
  lookup(): Promise<GeoLookup | null> {
    return Promise.resolve(null);
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Try each provider in order and record which one answered.
 *
 * `usedFallback` is on the snapshot deliberately: blueprint 9.4 lists
 * "provider/fallback status" among the fields worth persisting, and it is the
 * only way to notice from stored data that the primary has been failing.
 */
export class GeoChain {
  readonly #providers: readonly GeoProvider[];
  readonly #logger: Logger;

  constructor(providers: readonly GeoProvider[], logger: Logger) {
    this.#providers = providers;
    this.#logger = logger;
  }

  async lookup(ip: string): Promise<GeoSnapshot | null> {
    for (const [index, provider] of this.#providers.entries()) {
      /**
       * A provider that throws is treated exactly like one that returns null.
       *
       * The port asks implementations never to throw, but "asks" is not a
       * guarantee - and geo is optional enrichment on the most important write
       * path in the product. An unexpected exception here must not be able to
       * cost a customer a lead, so the chain absorbs it and moves on.
       */
      let result: GeoLookup | null = null;
      try {
        result = await provider.lookup(ip);
      } catch (error) {
        this.#logger.warn('geo.provider_threw', {
          result: 'degraded',
          provider: provider.name,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }

      if (result !== null) {
        return { ...result, usedFallback: index > 0 };
      }
      this.#logger.debug('geo.provider_miss', { result: 'degraded', provider: provider.name });
    }

    // Blueprint 7.3 step 8: if both fail, storage still succeeds without geo.
    return null;
  }
}
