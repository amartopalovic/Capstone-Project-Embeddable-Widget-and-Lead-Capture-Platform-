/**
 * Rate-limit port (blueprint section 10.3: dedicated Redis throttles per flow).
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  /** Seconds until the window resets. Suitable for a Retry-After header. */
  readonly retryAfterSeconds: number;
}

export interface RateLimitRule {
  /** Flow name, for example `login`, forming part of the Redis key. */
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface RateLimiter {
  consume(rule: RateLimitRule, identifier: string): Promise<RateLimitDecision>;
  reset(rule: RateLimitRule, identifier: string): Promise<void>;
}
