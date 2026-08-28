import { randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import type { SessionRecord, SessionStore } from '../../ports/session-store.js';
import { REDIS_DOMAINS, type RedisKeyBuilder } from './key-policy.js';

/**
 * Redis-backed server sessions (blueprint sections 4.2 and 10.3).
 *
 * Two lifetimes apply at once, which is why this is not a plain TTL:
 *
 *  - an IDLE window of 7 days, slid forward on each request;
 *  - an ABSOLUTE maximum of 30 days, never extended.
 *
 * The Redis TTL is set to whichever is sooner, and the absolute deadline is
 * also stored inside the record and re-checked on read, so a session cannot
 * outlive its absolute cap even if a TTL were mis-set.
 *
 * A per-user set indexes sessions so revoke-all is a single lookup, and
 * revocation DELETES the key rather than flagging it, which is what makes it
 * immediate (section 10.3).
 */

export interface RedisSessionStoreOptions {
  readonly idleTtlSeconds: number;
  readonly absoluteTtlSeconds: number;
}

interface StoredSession {
  readonly userId: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly absoluteExpiresAt: string;
  /**
   * Idle deadline, recomputed on every touch.
   *
   * The Redis TTL already expires an idle session, but storing the deadline as
   * data too means `touch` can re-check it against the application clock rather
   * than trusting the TTL alone. That is the same defence-in-depth applied to
   * the absolute cap, and it is what makes idle expiry directly testable.
   */
  readonly idleExpiresAt: string;
  readonly userAgentSummary: string;
  readonly activeWorkspaceId: string | null;
}

export class RedisSessionStore implements SessionStore {
  readonly #redis: Redis;
  readonly #keys: RedisKeyBuilder;
  readonly #idleTtlSeconds: number;

  constructor(redis: Redis, keys: RedisKeyBuilder, options: RedisSessionStoreOptions) {
    this.#redis = redis;
    this.#keys = keys;
    this.#idleTtlSeconds = options.idleTtlSeconds;
  }

  #sessionKey(sessionId: string): string {
    return this.#keys.key(REDIS_DOMAINS.session, sessionId);
  }

  #userIndexKey(userId: string): string {
    return this.#keys.key(REDIS_DOMAINS.userSessions, userId);
  }

  /**
   * 256 bits of entropy, url-safe. This value is the session secret: it is set
   * in the cookie and used as the Redis key, and never appears in a log, an
   * audit record, or an API response.
   */
  static generateSessionId(): string {
    return randomBytes(32).toString('base64url');
  }

  #idleDeadline(from: Date): Date {
    return new Date(from.getTime() + this.#idleTtlSeconds * 1000);
  }

  #ttlFor(record: { absoluteExpiresAt: Date }, now: Date): number {
    const untilAbsolute = Math.floor((record.absoluteExpiresAt.getTime() - now.getTime()) / 1000);
    return Math.max(0, Math.min(this.#idleTtlSeconds, untilAbsolute));
  }

  async create(input: Omit<SessionRecord, 'id'>): Promise<SessionRecord> {
    const id = RedisSessionStore.generateSessionId();
    const record: SessionRecord = { ...input, id };

    const stored: StoredSession = {
      userId: record.userId,
      createdAt: record.createdAt.toISOString(),
      lastSeenAt: record.lastSeenAt.toISOString(),
      absoluteExpiresAt: record.absoluteExpiresAt.toISOString(),
      idleExpiresAt: this.#idleDeadline(record.lastSeenAt).toISOString(),
      userAgentSummary: record.userAgentSummary,
      activeWorkspaceId: record.activeWorkspaceId,
    };

    const ttl = this.#ttlFor(record, record.lastSeenAt);
    await this.#redis
      .multi()
      .set(this.#sessionKey(id), JSON.stringify(stored), 'EX', Math.max(1, ttl))
      .sadd(this.#userIndexKey(record.userId), id)
      // The index outlives any single session so revoke-all still works late.
      .expire(this.#userIndexKey(record.userId), Math.max(1, ttl) * 2)
      .exec();

    return record;
  }

  #parse(id: string, raw: string | null): SessionRecord | null {
    if (raw === null) return null;
    try {
      const stored = JSON.parse(raw) as StoredSession;
      return {
        id,
        userId: stored.userId,
        createdAt: new Date(stored.createdAt),
        lastSeenAt: new Date(stored.lastSeenAt),
        absoluteExpiresAt: new Date(stored.absoluteExpiresAt),
        idleExpiresAt: new Date(
          // Tolerate a record written before this field existed.
          stored.idleExpiresAt ?? this.#idleDeadline(new Date(stored.lastSeenAt)).toISOString(),
        ),
        userAgentSummary: stored.userAgentSummary,
        activeWorkspaceId: stored.activeWorkspaceId ?? null,
      };
    } catch {
      return null;
    }
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    return this.#parse(sessionId, await this.#redis.get(this.#sessionKey(sessionId)));
  }

  async touch(sessionId: string, now: Date): Promise<SessionRecord | null> {
    const record = await this.get(sessionId);
    if (record === null) return null;

    // Both deadlines are re-checked against the application clock, so neither
    // depends on the Redis TTL having fired.
    if (record.absoluteExpiresAt.getTime() <= now.getTime()) {
      await this.destroy(sessionId);
      return null;
    }
    if (record.idleExpiresAt.getTime() <= now.getTime()) {
      await this.destroy(sessionId);
      return null;
    }

    const slid: SessionRecord = {
      ...record,
      lastSeenAt: now,
      idleExpiresAt: this.#idleDeadline(now),
    };
    const ttl = this.#ttlFor(slid, now);
    if (ttl <= 0) {
      await this.destroy(sessionId);
      return null;
    }

    const stored: StoredSession = {
      userId: slid.userId,
      createdAt: slid.createdAt.toISOString(),
      lastSeenAt: slid.lastSeenAt.toISOString(),
      absoluteExpiresAt: slid.absoluteExpiresAt.toISOString(),
      idleExpiresAt: this.#idleDeadline(now).toISOString(),
      userAgentSummary: slid.userAgentSummary,
      activeWorkspaceId: slid.activeWorkspaceId,
    };
    await this.#redis.set(this.#sessionKey(sessionId), JSON.stringify(stored), 'EX', ttl);
    return slid;
  }

  async listForUser(userId: string): Promise<readonly SessionRecord[]> {
    const ids = await this.#redis.smembers(this.#userIndexKey(userId));
    if (ids.length === 0) return [];

    const raws = await this.#redis.mget(ids.map((id) => this.#sessionKey(id)));
    const alive: SessionRecord[] = [];
    const dead: string[] = [];

    ids.forEach((id, index) => {
      const record = this.#parse(id, raws[index] ?? null);
      if (record === null) dead.push(id);
      else alive.push(record);
    });

    // Opportunistically prune index entries whose session has expired.
    if (dead.length > 0) {
      await this.#redis.srem(this.#userIndexKey(userId), ...dead);
    }

    return alive.sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
  }

  /**
   * Rewrite one session with a new active workspace, preserving its TTL.
   *
   * The remaining TTL is read and reapplied rather than restarted, so switching
   * workspace cannot be used to extend a session past its idle window.
   */
  async setActiveWorkspace(sessionId: string, workspaceId: string | null): Promise<boolean> {
    const key = this.#sessionKey(sessionId);
    const raw = await this.#redis.get(key);
    if (raw === null) return false;

    let stored: StoredSession;
    try {
      stored = JSON.parse(raw) as StoredSession;
    } catch {
      return false;
    }

    const ttl = await this.#redis.ttl(key);
    if (ttl <= 0) return false;

    await this.#redis.set(
      key,
      JSON.stringify({ ...stored, activeWorkspaceId: workspaceId }),
      'EX',
      ttl,
    );
    return true;
  }

  async clearActiveWorkspaceEverywhere(userId: string, workspaceId: string): Promise<number> {
    const sessions = await this.listForUser(userId);
    let cleared = 0;
    for (const session of sessions) {
      if (session.activeWorkspaceId === workspaceId) {
        if (await this.setActiveWorkspace(session.id, null)) cleared += 1;
      }
    }
    return cleared;
  }

  async destroy(sessionId: string): Promise<boolean> {
    const record = await this.get(sessionId);
    const removed = await this.#redis.del(this.#sessionKey(sessionId));
    if (record !== null) {
      await this.#redis.srem(this.#userIndexKey(record.userId), sessionId);
    }
    return removed > 0;
  }

  async destroyAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    const ids = await this.#redis.smembers(this.#userIndexKey(userId));
    const targets = ids.filter((id) => id !== exceptSessionId);
    if (targets.length === 0) return 0;

    const pipeline = this.#redis.multi();
    for (const id of targets) pipeline.del(this.#sessionKey(id));
    pipeline.srem(this.#userIndexKey(userId), ...targets);
    await pipeline.exec();

    return targets.length;
  }
}
