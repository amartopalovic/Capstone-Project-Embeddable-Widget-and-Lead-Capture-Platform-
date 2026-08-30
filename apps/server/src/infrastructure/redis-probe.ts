import Redis from 'ioredis';
import type { DependencyProbe, DependencyProbeResult } from '../ports/dependency-probe.js';

/**
 * Redis connectivity adapter for the readiness check.
 *
 * ioredis is used because BullMQ requires it (blueprint section 12.1); choosing
 * it now avoids running two Redis clients side by side from Stage 9 onward.
 */
export class RedisDependencyProbe implements DependencyProbe {
  readonly name = 'redis';
  readonly #client: Redis;

  constructor(url: string) {
    this.#client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: () => null,
    });
    // Report a safe error class from check(), not ioredis's raw stderr fallback.
    this.#client.on('error', () => undefined);
  }

  async check(): Promise<DependencyProbeResult> {
    const startedAt = performance.now();
    try {
      if (this.#client.status !== 'ready') {
        await this.#client.connect();
      }
      await this.#client.ping();
      return {
        name: this.name,
        status: 'up',
        durationMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      return {
        name: this.name,
        status: 'down',
        durationMs: Math.round(performance.now() - startedAt),
        detail: error instanceof Error ? error.name : 'unknown error',
      };
    }
  }

  async close(): Promise<void> {
    this.#client.disconnect();
  }
}
