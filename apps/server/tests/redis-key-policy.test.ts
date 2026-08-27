import { describe, expect, it } from 'vitest';
import { RedisKeyBuilder, REDIS_DOMAINS } from '../src/infrastructure/redis/key-policy.js';

/**
 * Keys are built explicitly rather than through the ioredis `keyPrefix`
 * option, because that option is not applied to SCAN patterns or to pub/sub
 * channel names. These tests pin the convention down before sessions, rate
 * limits, idempotency, caches, and SSE fan-out start depending on it.
 */

describe('redis key policy', () => {
  const keys = new RedisKeyBuilder('lcp:dev');

  it('builds prefix:domain:segments', () => {
    expect(keys.key(REDIS_DOMAINS.session, 'abc123')).toBe('lcp:dev:session:abc123');
    expect(keys.key(REDIS_DOMAINS.rateLimit, 'submit', 'widget1', 'hash')).toBe(
      'lcp:dev:ratelimit:submit:widget1:hash',
    );
  });

  it('normalises a trailing colon in the configured prefix', () => {
    expect(new RedisKeyBuilder('lcp:dev:').key(REDIS_DOMAINS.cache, 'x')).toBe('lcp:dev:cache:x');
  });

  it('builds scan patterns that carry the prefix, which keyPrefix would not', () => {
    expect(keys.pattern(REDIS_DOMAINS.idempotency, '*')).toBe('lcp:dev:idempotency:*');
  });

  it('builds pub/sub channels under the namespace, which keyPrefix would not', () => {
    expect(keys.channel('workspace', 'abc')).toBe('lcp:dev:events:workspace:abc');
  });

  it('rejects a segment containing a namespace separator', () => {
    expect(() => keys.key(REDIS_DOMAINS.session, 'a:b')).toThrow(/Invalid Redis key segment/);
  });

  it('rejects wildcards in a plain key, so a lookup cannot become a pattern', () => {
    expect(() => keys.key(REDIS_DOMAINS.session, '*')).toThrow(/Invalid Redis key segment/);
    expect(() => keys.key(REDIS_DOMAINS.session, 'a?b')).toThrow(/Invalid Redis key segment/);
  });

  it('rejects an empty segment', () => {
    expect(() => keys.key(REDIS_DOMAINS.session, '')).toThrow(/Invalid Redis key segment/);
  });

  it('enumerates a domain for every planned Redis use', () => {
    const expected = [
      'cache',
      'events',
      'idempotency',
      'queue',
      'quota',
      'rateLimit',
      'session',
      'userSessions',
    ];
    expect(Object.keys(REDIS_DOMAINS).sort()).toEqual(expected.sort());
  });
});
