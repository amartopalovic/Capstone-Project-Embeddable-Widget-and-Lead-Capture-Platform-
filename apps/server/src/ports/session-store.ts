/**
 * Server-side session port (blueprint sections 4.2 and 10.3).
 *
 * Sessions live in Redis, carry both an idle and an absolute lifetime, are
 * indexed per user so revoke-all is possible, and are deleted rather than
 * merely marked, so revocation is immediate.
 */

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  /** Absolute deadline; never extended, unlike the idle window. */
  readonly absoluteExpiresAt: Date;
  /** Idle deadline, pushed forward on each touch. */
  readonly idleExpiresAt: Date;
  /** Coarse client hint. Never a raw IP (blueprint section 9.4). */
  readonly userAgentSummary: string;
}

export interface SessionStore {
  create(input: Omit<SessionRecord, 'id'>): Promise<SessionRecord>;
  /**
   * Fetch a session and slide its idle window.
   *
   * Returns null when the session is unknown, idle-expired, or past its
   * absolute deadline, so an expired session is indistinguishable from a
   * revoked one to the caller.
   */
  touch(sessionId: string, now: Date): Promise<SessionRecord | null>;
  get(sessionId: string): Promise<SessionRecord | null>;
  listForUser(userId: string): Promise<readonly SessionRecord[]>;
  destroy(sessionId: string): Promise<boolean>;
  /** Revoke every session for a user, optionally sparing one. */
  destroyAllForUser(userId: string, exceptSessionId?: string): Promise<number>;
}
