import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Attach a request correlation ID (blueprint sections 9.3, 10.1, 16.1).
 *
 * Every log line, audit record, and error payload carries it, so one request
 * can be traced across all three.
 */
declare module 'express-serve-static-core' {
  interface Request {
    correlationId: string;
  }
}

export function correlationMiddleware() {
  return (request: Request, response: Response, next: NextFunction): void => {
    request.correlationId = randomUUID();
    response.setHeader('x-request-id', request.correlationId);
    next();
  };
}
