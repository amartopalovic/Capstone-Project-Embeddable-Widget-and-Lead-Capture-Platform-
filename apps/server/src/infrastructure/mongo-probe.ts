import { MongoClient } from 'mongodb';
import type { DependencyProbe, DependencyProbeResult } from '../ports/dependency-probe.js';

/**
 * Mongo connectivity adapter for the readiness check.
 *
 * This is deliberately NOT a data-layer concern and does not import from
 * @lcp/database: it proves raw infrastructure connectivity only. Connection
 * management, migrations, and the migration-compatibility half of the readiness
 * contract arrive in Stage 2.
 */
export class MongoDependencyProbe implements DependencyProbe {
  readonly name = 'mongodb';
  readonly #client: MongoClient;

  constructor(uri: string) {
    this.#client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 2000,
      connectTimeoutMS: 2000,
    });
  }

  async check(): Promise<DependencyProbeResult> {
    const startedAt = performance.now();
    try {
      await this.#client.connect();
      await this.#client.db().command({ ping: 1 });
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
    await this.#client.close();
  }
}
