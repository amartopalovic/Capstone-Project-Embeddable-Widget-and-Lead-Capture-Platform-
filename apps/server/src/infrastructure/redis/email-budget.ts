import type Redis from 'ioredis';
import type { EmailPriority } from '../../ports/email-sender.js';
import { REDIS_DOMAINS, type RedisKeyBuilder } from './key-policy.js';

/**
 * Brevo daily budget guard (blueprint section 5.3).
 *
 * The provider allows 300 messages per day. Of those, 100 are RESERVED for
 * authentication and privacy-critical mail, and at most 200 may go to
 * side-effect mail. The practical effect is a ceiling on side effects, not on
 * critical mail: critical mail may use the whole 300 if nothing else has, and
 * side-effect mail is refused once it has taken its 200 even while the reserve
 * is untouched.
 *
 * Stage 3a only ever sends `critical`. The `side_effect` path is implemented
 * and tested now so Stage 9 inherits an enforced budget rather than adding the
 * guard after the traffic already exists.
 */

export const BREVO_DAILY_BUDGET = 300;
export const CRITICAL_RESERVE = 100;
export const SIDE_EFFECT_CAP = BREVO_DAILY_BUDGET - CRITICAL_RESERVE;

export interface BudgetDecision {
  readonly allowed: boolean;
  readonly usedToday: number;
  readonly sideEffectUsedToday: number;
  readonly reason?: 'budget_exhausted';
}

/** UTC day key, so the window is deterministic and testable. */
export function budgetDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export class RedisEmailBudget {
  readonly #redis: Redis;
  readonly #keys: RedisKeyBuilder;

  constructor(redis: Redis, keys: RedisKeyBuilder) {
    this.#redis = redis;
    this.#keys = keys;
  }

  #totalKey(day: string): string {
    return this.#keys.key(REDIS_DOMAINS.quota, 'email', day, 'total');
  }

  #sideEffectKey(day: string): string {
    return this.#keys.key(REDIS_DOMAINS.quota, 'email', day, 'side-effect');
  }

  async usage(now: Date): Promise<{ total: number; sideEffect: number }> {
    const day = budgetDayKey(now);
    const [total, sideEffect] = await this.#redis.mget(
      this.#totalKey(day),
      this.#sideEffectKey(day),
    );
    return { total: Number(total ?? 0), sideEffect: Number(sideEffect ?? 0) };
  }

  /**
   * Reserve one message. Returns whether it may be sent, and increments only
   * when it may, so a refusal does not consume allowance.
   */
  async tryConsume(priority: EmailPriority, now: Date): Promise<BudgetDecision> {
    const day = budgetDayKey(now);
    const { total, sideEffect } = await this.usage(now);

    const overall = total >= BREVO_DAILY_BUDGET;
    const sideEffectCapped = priority === 'side_effect' && sideEffect >= SIDE_EFFECT_CAP;

    if (overall || sideEffectCapped) {
      return {
        allowed: false,
        usedToday: total,
        sideEffectUsedToday: sideEffect,
        reason: 'budget_exhausted',
      };
    }

    // Two days of TTL so a counter cannot survive into a later window.
    const ttlSeconds = 2 * 24 * 60 * 60;
    const pipeline = this.#redis
      .multi()
      .incr(this.#totalKey(day))
      .expire(this.#totalKey(day), ttlSeconds);
    if (priority === 'side_effect') {
      pipeline.incr(this.#sideEffectKey(day)).expire(this.#sideEffectKey(day), ttlSeconds);
    }
    await pipeline.exec();

    return {
      allowed: true,
      usedToday: total + 1,
      sideEffectUsedToday: priority === 'side_effect' ? sideEffect + 1 : sideEffect,
    };
  }
}
