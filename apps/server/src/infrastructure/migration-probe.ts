import type { Db } from 'mongodb';
import { COLLECTIONS, MIGRATIONS } from '@lcp/database';
import type { DependencyProbe, DependencyProbeResult } from '../ports/dependency-probe.js';

/**
 * Migration compatibility (blueprint 16.2).
 *
 * Readiness is defined as "Mongo and Redis connectivity PLUS migration
 * compatibility", and until Stage 13 only the first half existed. The gap
 * mattered: blueprint 9.3 forbids running migrations on boot, so a deployment
 * whose migration step failed or was skipped comes up connected, healthy, and
 * missing indexes - answering requests against a schema it was not built for.
 *
 * The check is deliberately one-directional. Every migration this build knows
 * about must be recorded as applied. A ledger containing MORE than this build
 * knows about is fine and must not fail: that is what a rollback looks like
 * while the previous release is still draining, and refusing readiness then
 * would turn an ordinary rollback into an outage.
 */
export class MigrationDependencyProbe implements DependencyProbe {
  readonly name = 'migrations';
  readonly #db: Db;
  readonly #expected: readonly string[];

  constructor(db: Db, expected: readonly string[] = MIGRATIONS.map((migration) => migration.id)) {
    this.#db = db;
    this.#expected = expected;
  }

  async check(): Promise<DependencyProbeResult> {
    const startedAt = performance.now();
    try {
      const applied = new Set(
        (
          await this.#db
            .collection<{ _id: string }>(COLLECTIONS.migrations)
            .find({}, { projection: { _id: 1 } })
            .toArray()
        ).map((entry) => entry._id),
      );

      const pending = this.#expected.filter((id) => !applied.has(id));
      const durationMs = Math.round(performance.now() - startedAt);

      if (pending.length > 0) {
        return {
          name: this.name,
          status: 'down',
          durationMs,
          // The ids, not a count: an operator reading a 503 wants to know which
          // migration to run, and a migration id is not sensitive.
          detail: `pending: ${pending.join(', ')}`,
        };
      }

      return { name: this.name, status: 'up', durationMs, detail: `applied: ${applied.size}` };
    } catch (error) {
      return {
        name: this.name,
        status: 'down',
        durationMs: Math.round(performance.now() - startedAt),
        detail: error instanceof Error ? error.name : 'unknown error',
      };
    }
  }
}
