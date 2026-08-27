/**
 * Redis key-namespacing policy.
 *
 * Convention:  <prefix>:<domain>:<...segments>
 * for example  lcp:dev:session:9f2c...   or   lcp:dev:ratelimit:submit:<widget>:<ip>
 *
 * Keys are built EXPLICITLY here rather than relying on the ioredis
 * `keyPrefix` client option. That option is transparent for ordinary key
 * commands but is NOT applied to pattern commands such as KEYS and SCAN, nor to
 * pub/sub channel names in SUBSCRIBE and PUBLISH. Depending on it would mean
 * cleanup scans and the SSE fan-out channels of later stages silently landed
 * outside the namespace. Building keys explicitly keeps one rule everywhere.
 *
 * Every Redis domain this project will use is enumerated, so a later stage adds
 * a case here instead of inventing an ad-hoc key format.
 */

export const REDIS_DOMAINS = {
  /** Server-side sessions (Stage 3). */
  session: 'session',
  /** Per-user index of sessions, for revoke-all (Stage 3). */
  userSessions: 'user-sessions',
  /** Auth throttles and public rate limits (Stages 3 and 7). */
  rateLimit: 'ratelimit',
  /** 24-hour public submission idempotency (Stage 7). */
  idempotency: 'idempotency',
  /** Short-lived caches such as published widget config (Stage 6). */
  cache: 'cache',
  /** Workspace usage and quota counters (Stage 7). */
  quota: 'quota',
  /** SSE fan-out channels (Stage 8). Pub/sub, so never auto-prefixed. */
  events: 'events',
  /** BullMQ queue prefix (Stage 9). */
  queue: 'queue',
} as const;

export type RedisDomain = (typeof REDIS_DOMAINS)[keyof typeof REDIS_DOMAINS];

const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Reject separators and wildcards in segments.
 *
 * A colon would forge a namespace boundary and `*` or `?` would turn a lookup
 * into a pattern, so untrusted values cannot be spliced into a key.
 */
function assertSegment(segment: string): string {
  if (segment.length === 0 || !SEGMENT_PATTERN.test(segment)) {
    throw new Error(
      `Invalid Redis key segment: expected characters matching ${SEGMENT_PATTERN.source}`,
    );
  }
  return segment;
}

export class RedisKeyBuilder {
  readonly #prefix: string;

  constructor(prefix: string) {
    this.#prefix = prefix.replace(/:+$/, '');
  }

  get prefix(): string {
    return this.#prefix;
  }

  key(domain: RedisDomain, ...segments: string[]): string {
    const safe = segments.map(assertSegment);
    return [this.#prefix, domain, ...safe].join(':');
  }

  /**
   * Build a SCAN/KEYS match pattern for a domain. Explicit, because ioredis
   * would not apply a client keyPrefix to a pattern argument.
   */
  pattern(domain: RedisDomain, ...segments: string[]): string {
    const safe = segments.map((segment) => (segment === '*' ? '*' : assertSegment(segment)));
    return [this.#prefix, domain, ...safe].join(':');
  }

  /** Pub/sub channel name. Never auto-prefixed by ioredis, so built here too. */
  channel(...segments: string[]): string {
    return this.key(REDIS_DOMAINS.events, ...segments);
  }
}
