import type { DependencyProbe, DependencyProbeResult } from '../ports/dependency-probe.js';

/**
 * Application service for the health endpoints (blueprint section 16.2).
 *
 * Liveness reports process state only and never touches a dependency.
 * Readiness aggregates the required infrastructure probes.
 *
 * Optional providers (Brevo, geo, webhooks, Sentry) must never make the API
 * unready. None of them exist yet, so none are consulted here; their separate
 * degraded-state reporting arrives in Stage 13.
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
  readonly dependencies: readonly DependencyProbeResult[];
}

export class HealthService {
  readonly #probes: readonly DependencyProbe[];
  readonly #release: string;

  constructor(probes: readonly DependencyProbe[], release: string) {
    this.#probes = probes;
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
    const dependencies = await Promise.all(this.#probes.map((probe) => probe.check()));
    const allUp = dependencies.every((dependency) => dependency.status === 'up');

    return {
      status: allUp ? 'ready' : 'not_ready',
      release: this.#release,
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }
}
