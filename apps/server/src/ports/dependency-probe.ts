/**
 * Ports for the infrastructure dependencies the readiness check consults.
 *
 * Application services depend on this interface, never on the Mongo or Redis
 * client directly, so that the dependency direction in blueprint section 6.2
 * holds from the first stage: application -> ports -> infrastructure adapters.
 *
 * Adapters convert connection failures into an explicit result rather than
 * letting a driver exception escape into core logic.
 */

export type DependencyStatus = 'up' | 'down';

export interface DependencyProbeResult {
  readonly name: string;
  readonly status: DependencyStatus;
  readonly durationMs: number;
  /** Safe, non-sensitive failure summary. Never contains credentials or URIs. */
  readonly detail?: string;
}

export interface DependencyProbe {
  readonly name: string;
  check(): Promise<DependencyProbeResult>;
}
