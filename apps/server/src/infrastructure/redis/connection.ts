import Redis from 'ioredis';
import { RedisKeyBuilder } from './key-policy.js';

/**
 * Data-layer Redis connection.
 *
 * Separate from the readiness probe, which answers only "is Redis reachable".
 * This connection is what sessions, rate limits, idempotency, caches, quota
 * counters, and SSE fan-out will use from Stage 3 onward.
 *
 * `keyPrefix` is deliberately NOT set on the client. See key-policy.ts: the
 * option does not apply to SCAN patterns or pub/sub channels, so keys are built
 * explicitly through RedisKeyBuilder instead of half-automatically.
 */
export interface RedisConnectionOptions {
  readonly url: string;
  readonly keyPrefix: string;
}

export class RedisConnection {
  readonly #client: Redis;
  readonly #keys: RedisKeyBuilder;

  constructor(options: RedisConnectionOptions) {
    this.#client = new Redis(options.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
    });
    this.#keys = new RedisKeyBuilder(options.keyPrefix);
  }

  get client(): Redis {
    return this.#client;
  }

  get keys(): RedisKeyBuilder {
    return this.#keys;
  }

  async connect(): Promise<void> {
    if (this.#client.status === 'ready' || this.#client.status === 'connecting') return;
    await this.#client.connect();
  }

  async ping(): Promise<boolean> {
    const reply = await this.#client.ping();
    return reply === 'PONG';
  }

  async close(): Promise<void> {
    this.#client.disconnect();
  }
}
