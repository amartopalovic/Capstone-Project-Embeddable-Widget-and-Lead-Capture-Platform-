/**
 * Optimistic-concurrency contract (blueprint sections 9.3 and 10.1).
 *
 * Records whose canonical values can be edited by more than one teammate carry
 * a monotonically increasing `revision`. An update that can conflict must send
 * the revision it read; a mismatch is a stale write and returns 409.
 *
 * Stage 2 establishes the shape only. The first records that enforce it are the
 * Contact canonical values in Stage 8 and widget drafts in Stage 5.
 */

export interface Versioned {
  /** Increments on every accepted write. Starts at 1. */
  readonly revision: number;
}

export interface RevisionPrecondition {
  /** The revision the client last read. */
  readonly expectedRevision: number;
}

export const INITIAL_REVISION = 1;

export function nextRevision(current: number): number {
  return current + 1;
}

export function isRevisionStale(current: number, precondition: RevisionPrecondition): boolean {
  return current !== precondition.expectedRevision;
}
