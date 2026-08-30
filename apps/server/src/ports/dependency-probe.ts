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

/**
 * `degraded` is for an OPTIONAL dependency only (blueprint 16.2).
 *
 * A required dependency is up or it is not; there is no useful middle state for
 * "the database half works". An optional provider genuinely has one - Brevo's
 * daily allowance can be spent while Brevo itself is perfectly healthy - and
 * blueprint 16.2 asks for exactly that state to be "reported separately"
 * without making the API unready.
 */
export type DependencyStatus = 'up' | 'down' | 'degraded';

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
