import type { Logger, SessionSummary } from '@lcp/contracts';
import type { ObjectId } from 'mongodb';
import type { SessionRecord, SessionStore } from '../../ports/session-store.js';
import type { Clock } from '../../ports/clock.js';
import type { AuditEventRepository } from './types.js';

/**
 * Session lifecycle (blueprint sections 4.2 and 10.3).
 *
 * Session identifier rotation is implemented as create-new-then-destroy-old
 * rather than mutating a record in place. That way the old identifier stops
 * working the instant rotation completes, which is the property section 10.3
 * actually needs after authentication or a password change.
 */

export interface SessionServiceDeps {
  readonly sessions: SessionStore;
  readonly auditEvents: AuditEventRepository;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly idleTtlSeconds: number;
  readonly absoluteTtlSeconds: number;
}

/**
 * Reduce a User-Agent to a coarse, non-identifying label.
 *
 * The device list needs to be recognisable to its owner without storing a
 * fingerprintable string, and blueprint section 9.4 keeps identifying request
 * metadata out of durable storage.
 */
export function summariseUserAgent(userAgent: string | undefined): string {
  if (userAgent === undefined || userAgent.trim() === '') return 'Unknown device';

  const ua = userAgent.toLowerCase();
  const browser = ua.includes('edg/')
    ? 'Edge'
    : ua.includes('chrome/') && !ua.includes('chromium')
      ? 'Chrome'
      : ua.includes('firefox/')
        ? 'Firefox'
        : ua.includes('safari/') && !ua.includes('chrome')
          ? 'Safari'
          : 'Browser';

  const platform = ua.includes('windows')
    ? 'Windows'
    : ua.includes('mac os') || ua.includes('macintosh')
      ? 'macOS'
      : ua.includes('android')
        ? 'Android'
        : ua.includes('iphone') || ua.includes('ipad')
          ? 'iOS'
          : ua.includes('linux')
            ? 'Linux'
            : 'Unknown platform';

  return `${browser} on ${platform}`;
}

export class SessionService {
  readonly #deps: SessionServiceDeps;

  constructor(deps: SessionServiceDeps) {
    this.#deps = deps;
  }

  async start(userId: ObjectId, userAgent: string | undefined): Promise<SessionRecord> {
    const now = this.#deps.clock.now();
    return this.#deps.sessions.create({
      userId: userId.toHexString(),
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: new Date(now.getTime() + this.#deps.absoluteTtlSeconds * 1000),
      idleExpiresAt: new Date(now.getTime() + this.#deps.idleTtlSeconds * 1000),
      userAgentSummary: summariseUserAgent(userAgent),
      // A fresh sign-in selects no workspace; the client picks one, or
      // onboarding creates the first.
      activeWorkspaceId: null,
    });
  }

  /**
   * Rotate the session identifier, preserving the original absolute deadline.
   *
   * Carrying the deadline forward matters: if rotation reset it, an attacker
   * who could trigger rotations could keep a session alive indefinitely and
   * defeat the 30-day absolute cap.
   */
  async rotate(previous: SessionRecord): Promise<SessionRecord> {
    const now = this.#deps.clock.now();
    const rotated = await this.#deps.sessions.create({
      userId: previous.userId,
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: previous.absoluteExpiresAt,
      idleExpiresAt: new Date(now.getTime() + this.#deps.idleTtlSeconds * 1000),
      userAgentSummary: previous.userAgentSummary,
      // Rotation preserves the selection: it is the same person continuing.
      activeWorkspaceId: previous.activeWorkspaceId,
    });
    await this.#deps.sessions.destroy(previous.id);
    return rotated;
  }

  /** Point a session at a workspace. Membership is checked by the caller. */
  async selectWorkspace(sessionId: string, workspaceId: string | null): Promise<boolean> {
    return this.#deps.sessions.setActiveWorkspace(sessionId, workspaceId);
  }

  /**
   * Drop a workspace from every session of one user.
   *
   * Called when a membership is revoked or a workspace is deleted, so another
   * open tab cannot keep acting inside it.
   */
  async clearWorkspaceEverywhere(userId: string, workspaceId: string): Promise<number> {
    return this.#deps.sessions.clearActiveWorkspaceEverywhere(userId, workspaceId);
  }

  async resolve(sessionId: string): Promise<SessionRecord | null> {
    return this.#deps.sessions.touch(sessionId, this.#deps.clock.now());
  }

  async list(userId: string, currentSessionId: string | null): Promise<readonly SessionSummary[]> {
    const records = await this.#deps.sessions.listForUser(userId);
    return records.map((record) => ({
      id: record.id,
      createdAt: record.createdAt.toISOString(),
      lastSeenAt: record.lastSeenAt.toISOString(),
      expiresAt: record.absoluteExpiresAt.toISOString(),
      userAgentSummary: record.userAgentSummary,
      current: record.id === currentSessionId,
    }));
  }

  /** Revoke one session, but only if it belongs to the requesting user. */
  async revoke(
    userId: string,
    sessionId: string,
    actorUserId: ObjectId,
    correlationId: string,
  ): Promise<boolean> {
    const record = await this.#deps.sessions.get(sessionId);
    if (record === null || record.userId !== userId) {
      // Same answer whether it never existed or belongs to someone else.
      return false;
    }

    const destroyed = await this.#deps.sessions.destroy(sessionId);
    if (destroyed) {
      await this.#audit('auth.session_revoked', actorUserId, correlationId);
    }
    return destroyed;
  }

  async revokeAll(
    userId: string,
    actorUserId: ObjectId,
    correlationId: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const count = await this.#deps.sessions.destroyAllForUser(userId, exceptSessionId);
    await this.#audit('auth.sessions_revoked_all', actorUserId, correlationId);
    return count;
  }

  async end(sessionId: string, actorUserId: ObjectId, correlationId: string): Promise<void> {
    await this.#deps.sessions.destroy(sessionId);
    await this.#audit('auth.logged_out', actorUserId, correlationId);
  }

  async #audit(type: string, actorUserId: ObjectId, correlationId: string): Promise<void> {
    await this.#deps.auditEvents.insertAccountEvent({
      type,
      actorUserId,
      correlationId,
      occurredAt: this.#deps.clock.now(),
      metadata: {},
    });
  }
}
