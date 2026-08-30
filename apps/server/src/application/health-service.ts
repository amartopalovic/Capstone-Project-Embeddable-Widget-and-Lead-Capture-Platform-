import type { DependencyProbe, DependencyProbeResult } from '../ports/dependency-probe.js';

/**
 * Application service for the health endpoints (blueprint section 16.2).
 *
 * Liveness reports process state only and never touches a dependency.
 *
 * Readiness aggregates the REQUIRED infrastructure - Mongo, Redis, and
 * migration compatibility - and reports the optional providers beside them
 * without letting any of them change the answer. That separation is the whole
 * point of the endpoint: a load balancer reads `status`, and Brevo having spent
 * its daily allowance is not a reason to take the API out of rotation and
 * refuse to accept leads.
 *
 * The two lists are separate constructor arguments rather than one list with a
 * flag, so it is impossible to add an optional provider to the required set by
 * forgetting a boolean.
 */

export interface LivenessReport {
  readonly status: 'ok';
  readonly uptimeSeconds: number;
  readonly release: string;
  readonly timestamp: string;
}

export interface ReadinessReport {
  readonly status: 'ready' | 'not_ready';
  readonly release: string;
  readonly timestamp: string;
  /** Mongo, Redis, migrations. Any one of these down means `not_ready`. */
  readonly dependencies: readonly DependencyProbeResult[];
  /** Brevo, geo, error monitoring. Reported, never decisive. */
  readonly optional: readonly DependencyProbeResult[];
}

export class HealthService {
  readonly #required: readonly DependencyProbe[];
  readonly #optional: readonly DependencyProbe[];
  readonly #release: string;

  constructor(
    probes: readonly DependencyProbe[],
    release: string,
    optional: readonly DependencyProbe[] = [],
  ) {
    this.#required = probes;
    this.#optional = optional;
    this.#release = release;
  }

  liveness(): LivenessReport {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      release: this.#release,
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<ReadinessReport> {
    const [dependencies, optional] = await Promise.all([
      Promise.all(this.#required.map((probe) => probe.check())),
      /**
       * `allSettled`, unlike the required list.
       *
       * An optional probe that throws outright must not be able to fail the
       * readiness endpoint itself - that would be the same bug the endpoint
       * exists to prevent, one layer up.
       */
      Promise.allSettled(this.#optional.map((probe) => probe.check())).then((results) =>
        results.map((result, index) =>
          result.status === 'fulfilled'
            ? result.value
            : {
                name: this.#optional[index]?.name ?? 'unknown',
                status: 'degraded' as const,
                durationMs: 0,
                detail: 'probe failed',
              },
        ),
      ),
    ]);

    const allUp = dependencies.every((dependency) => dependency.status === 'up');

    return {
      status: allUp ? 'ready' : 'not_ready',
      release: this.#release,
      timestamp: new Date().toISOString(),
      dependencies,
      optional,
    };
  }
}
