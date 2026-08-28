import { randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS_DOMAINS, type RedisKeyBuilder } from './key-policy.js';

/**
 * Short-lived store for the partially-authenticated state between a correct
 * password and a satisfied second factor.
 *
 * This exists so the client never holds anything it could use to skip the
 * challenge. The browser gets an opaque handle; the fact that the password was
 * accepted lives only on the server, and expires quickly on its own.
 *
 * It is deliberately NOT a session: it grants no access, only the right to
 * attempt a second factor.
 */

export interface PendingMfaChallenge {
  readonly userId: string;
  readonly createdAt: Date;
  readonly attempts: number;
}

/** Five minutes is enough to open an authenticator app, and no longer. */
export const MFA_CHALLENGE_TTL_SECONDS = 300;
/** Attempts allowed before the challenge is destroyed and login restarts. */
export const MFA_CHALLENGE_MAX_ATTEMPTS = 5;

interface StoredChallenge {
  readonly userId: string;
  readonly createdAt: string;
  readonly attempts: number;
}

export class RedisMfaChallengeStore {
  readonly #redis: Redis;
  readonly #keys: RedisKeyBuilder;

  constructor(redis: Redis, keys: RedisKeyBuilder) {
    this.#redis = redis;
    this.#keys = keys;
  }

  #key(challengeId: string): string {
    return this.#keys.key(REDIS_DOMAINS.session, 'mfa-challenge', challengeId);
  }

  async create(userId: string, now: Date): Promise<string> {
    const challengeId = randomBytes(32).toString('base64url');
    const stored: StoredChallenge = { userId, createdAt: now.toISOString(), attempts: 0 };
    await this.#redis.set(
      this.#key(challengeId),
      JSON.stringify(stored),
      'EX',
      MFA_CHALLENGE_TTL_SECONDS,
    );
    return challengeId;
  }

  async get(challengeId: string): Promise<PendingMfaChallenge | null> {
    const raw = await this.#redis.get(this.#key(challengeId));
    if (raw === null) return null;
    try {
      const stored = JSON.parse(raw) as StoredChallenge;
      return {
        userId: stored.userId,
        createdAt: new Date(stored.createdAt),
        attempts: stored.attempts,
      };
    } catch {
      return null;
    }
  }

  /**
   * Count a failed attempt.
   *
   * Returns false once the ceiling is reached, having destroyed the challenge,
   * so a stolen challenge handle cannot be used to grind through codes.
   */
  async recordFailure(challengeId: string): Promise<boolean> {
    const existing = await this.get(challengeId);
    if (existing === null) return false;

    const attempts = existing.attempts + 1;
    if (attempts >= MFA_CHALLENGE_MAX_ATTEMPTS) {
      await this.destroy(challengeId);
      return false;
    }

    const stored: StoredChallenge = {
      userId: existing.userId,
      createdAt: existing.createdAt.toISOString(),
      attempts,
    };
    // Preserve the remaining TTL rather than restarting it, so failures cannot
    // extend the window.
    const ttl = await this.#redis.ttl(this.#key(challengeId));
    await this.#redis.set(
      this.#key(challengeId),
      JSON.stringify(stored),
      'EX',
      ttl > 0 ? ttl : MFA_CHALLENGE_TTL_SECONDS,
    );
    return true;
  }

  async destroy(challengeId: string): Promise<void> {
    await this.#redis.del(this.#key(challengeId));
  }
}
