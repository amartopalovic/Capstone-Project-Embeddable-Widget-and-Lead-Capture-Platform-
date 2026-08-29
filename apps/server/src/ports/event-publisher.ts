import type { WorkspaceEventType } from '@lcp/contracts';

/**
 * Announcing something to a workspace's live dashboards (blueprint 13.1).
 *
 * A port rather than a direct Redis dependency, for two reasons that both
 * matter to the submission path:
 *
 *  - the submission service is application-layer code and must not import an
 *    infrastructure adapter (blueprint 6.2);
 *  - a test needs to assert that an accepted submission announced itself
 *    without standing up a subscriber to overhear it.
 *
 * Implementations MUST NOT throw. A live update is a convenience on top of a
 * committed write - a fan-out failure can never be allowed to fail a
 * submission that has already been accepted and stored.
 */
export interface EventPublisher {
  publish(
    workspaceId: string,
    type: WorkspaceEventType,
    data: Readonly<Record<string, unknown>>,
    occurredAt: Date,
  ): Promise<void>;
}

/** Used where live updates are irrelevant, such as a script or a seed run. */
export class NullEventPublisher implements EventPublisher {
  async publish(): Promise<void> {
    // Intentionally nothing.
  }
}
