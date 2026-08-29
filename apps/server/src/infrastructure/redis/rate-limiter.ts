import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import type { RateLimitDecision, RateLimitRule, RateLimiter } from '../../ports/rate-limiter.js';
import { REDIS_DOMAINS, type RedisKeyBuilder } from './key-policy.js';

/**
 * Redis fixed-window rate limiter (blueprint section 10.3).
 *
 * Each flow gets its own dedicated rule and therefore its own key space, so
 * exhausting the login limit cannot lock a user out of a password reset.
 *
 * The identifier is HASHED before it becomes part of the key. Identifiers are
 * email addresses and IP addresses, and blueprint section 9.4 forbids
 * persisting a raw IP; hashing also keeps arbitrary user input out of the key
 * structure entirely.
 *
 * A fixed window is chosen over a sliding log because it needs one counter and
 * one TTL rather than a sorted set per identifier, which matters on the metered
 * Upstash plan the blueprint targets. It allows a burst across a window
 * boundary, which is acceptable for auth throttling where the goal is blunting
 * automated attempts rather than exact fairness.
 */

/** Auth throttle rules (blueprint section 10.3 names each of these flows). */
export const AUTH_RATE_RULES = {
  login: { name: 'login', limit: 10, windowSeconds: 300 },
  loginPerAccount: { name: 'login-account', limit: 5, windowSeconds: 900 },
  register: { name: 'register', limit: 5, windowSeconds: 3600 },
  verificationResend: { name: 'verification-resend', limit: 3, windowSeconds: 3600 },
  passwordResetRequest: { name: 'password-reset-request', limit: 3, windowSeconds: 3600 },
  passwordResetConfirm: { name: 'password-reset-confirm', limit: 10, windowSeconds: 3600 },
  /**
   * Generic flow reserved for Stage 4 invitation acceptance. Declared here so
   * that stage reuses the mechanism instead of inventing another one; nothing
   * consumes it yet.
   */
  invitationAcceptance: { name: 'invitation-acceptance', limit: 10, windowSeconds: 3600 },
  /**
   * MFA code submission. Tight, because a 6-digit code is only a million
   * possibilities and the otpauth documentation explicitly calls for
   * throttling alongside a drift window.
   */
  mfaChallenge: { name: 'mfa-challenge', limit: 10, windowSeconds: 900 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Public submission limits, exactly as blueprint 7.3 step 3 states them.
 *
 * Three rules rather than one, because they defend against different things:
 * the per-minute pair limit stops a burst from one visitor, the hourly pair
 * limit stops a slow grind that would slip under it, and the per-widget limit
 * caps what a distributed botnet can cost one customer even when no single
 * address looks abusive.
 *
 * All three share the Stage 3a Redis mechanism rather than introducing a
 * second one.
 */
export const SUBMISSION_RATE_RULES = {
  /** 5 submissions per minute per IP-widget pair. */
  perIpWidgetMinute: { name: 'submit-ip-widget-min', limit: 5, windowSeconds: 60 },
  /** 30 per hour per IP-widget pair. */
  perIpWidgetHour: { name: 'submit-ip-widget-hour', limit: 30, windowSeconds: 3600 },
  /** 100 per minute per widget, across every visitor. */
  perWidgetMinute: { name: 'submit-widget-min', limit: 100, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export class RedisRateLimiter implements RateLimiter {
  readonly #redis: Redis;
  readonly #keys: RedisKeyBuilder;

  constructor(redis: Redis, keys: RedisKeyBuilder) {
    this.#redis = redis;
    this.#keys = keys;
  }

  #key(rule: RateLimitRule, identifier: string): string {
    const hashed = createHash('sha256').update(identifier.toLowerCase(), 'utf8').digest('hex');
    return this.#keys.key(REDIS_DOMAINS.rateLimit, rule.name, hashed.slice(0, 32));
  }

  async consume(rule: RateLimitRule, identifier: string): Promise<RateLimitDecision> {
    const key = this.#key(rule, identifier);

    // INCR then set the TTL only on first increment, so the window starts with
    // the first attempt rather than sliding forward on every attempt.
    const results = await this.#redis.multi().incr(key).ttl(key).exec();

    const count = Number(results?.[0]?.[1] ?? 0);
    let ttl = Number(results?.[1]?.[1] ?? -1);

    if (ttl < 0) {
      await this.#redis.expire(key, rule.windowSeconds);
      ttl = rule.windowSeconds;
    }

    return {
      allowed: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSeconds: ttl,
    };
  }

  async reset(rule: RateLimitRule, identifier: string): Promise<void> {
    await this.#redis.del(this.#key(rule, identifier));
  }
}
