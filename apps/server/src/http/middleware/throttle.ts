import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES, type Logger } from '@lcp/contracts';
import type { RateLimitRule, RateLimiter } from '../../ports/rate-limiter.js';
import { ApiError } from './error-handler.js';

/**
 * Per-flow auth throttling (blueprint section 10.3).
 *
 * The client IP is used only transiently, to derive a key, and is hashed before
 * it reaches Redis. It is never persisted or logged (blueprint section 9.4).
 */
export function clientIdentifier(request: Request): string {
  const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
  return createHash('sha256').update(ip, 'utf8').digest('hex').slice(0, 32);
}

export type IdentifierSource = (request: Request) => string;

export function throttle(
  limiter: RateLimiter,
  rule: RateLimitRule,
  logger: Logger,
  identify: IdentifierSource = clientIdentifier,
) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const decision = await limiter.consume(rule, identify(request));
      response.setHeader('x-ratelimit-remaining', String(decision.remaining));

      if (!decision.allowed) {
        response.setHeader('retry-after', String(decision.retryAfterSeconds));
        logger.warn('auth.throttled', {
          correlationId: request.correlationId,
          rule: rule.name,
          result: 'client_error',
        });
        next(new ApiError(ERROR_CODES.RATE_LIMITED, 'Too many attempts. Try again later.'));
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Throttle by submitted email as well as by IP.
 *
 * IP-only throttling is defeated by a botnet spreading attempts across many
 * addresses against one account. The email is hashed, so no address is stored.
 */
export function emailIdentifier(request: Request): string {
  const body = request.body as { email?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : 'unknown';
  return createHash('sha256').update(email, 'utf8').digest('hex').slice(0, 32);
}
