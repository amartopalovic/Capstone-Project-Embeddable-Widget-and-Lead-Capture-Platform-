import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES } from '@lcp/contracts';
import type { ObjectId } from 'mongodb';
import type { SessionRecord } from '../../ports/session-store.js';
import type { SessionService } from '../../application/auth/session-service.js';
import type { UserRepository, WithIdUser } from '../../application/auth/types.js';
import { ApiError } from './error-handler.js';

/**
 * Session resolution and the authentication gate (blueprint section 10.3).
 */
declare module 'express-serve-static-core' {
  interface Request {
    session?: SessionRecord;
    currentUser?: WithIdUser;
  }
}

export interface SessionCookieOptions {
  readonly name: string;
  readonly secure: boolean;
  readonly sameSite: 'strict' | 'lax' | 'none';
}

/**
 * Cookie flags per blueprint section 10.3.
 *
 * `httpOnly` blocks script access, `secure` keeps it off plaintext transports,
 * `path: /` scopes it to this origin only, and SameSite=Lax is the deliberate
 * choice over Strict: the dashboard is same-origin so Lax is sufficient, and
 * Strict would break the top-level navigation that arrives from a verification
 * or password-reset link in an email.
 *
 * No `maxAge` is set, making it a session cookie in the browser. Expiry is
 * enforced server-side in Redis, which is authoritative and cannot be edited by
 * the client.
 */
export function sessionCookieOptions(options: SessionCookieOptions): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  path: string;
} {
  return {
    httpOnly: true,
    secure: options.secure,
    sameSite: options.sameSite,
    path: '/',
  };
}

/** Resolve a session if one is present. Never rejects; that is `requireAuth`. */
export function sessionMiddleware(
  sessions: SessionService,
  users: UserRepository,
  cookieName: string,
) {
  return async (request: Request, _response: Response, next: NextFunction): Promise<void> => {
    try {
      const cookies = request.cookies as Record<string, string | undefined> | undefined;
      const sessionId = cookies?.[cookieName];
      if (sessionId === undefined || sessionId === '') {
        next();
        return;
      }

      const session = await sessions.resolve(sessionId);
      if (session === null) {
        next();
        return;
      }

      const { ObjectId: Oid } = await import('mongodb');
      const user = await users.findById(new Oid(session.userId) as ObjectId);
      // A session whose user is gone or deactivated is not a valid session.
      if (user === null || user.status !== 'active') {
        next();
        return;
      }

      request.session = session;
      request.currentUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAuth() {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (request.session === undefined || request.currentUser === undefined) {
      next(new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required'));
      return;
    }
    next();
  };
}

/**
 * Verified-email gate (blueprint section 4.1).
 *
 * Unverified users may use the dashboard but may not publish or invite. Neither
 * of those surfaces exists until Stages 4 and 5, so nothing is gated by this
 * yet. It is built and tested now, as a small essential interface stub, so
 * those stages attach a guard that already works rather than inventing one.
 */
export function requireVerifiedEmail() {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (request.currentUser === undefined) {
      next(new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required'));
      return;
    }
    if (request.currentUser.emailVerifiedAt === null) {
      next(
        new ApiError(
          ERROR_CODES.EMAIL_NOT_VERIFIED,
          'Verify your email address before performing this action',
        ),
      );
      return;
    }
    next();
  };
}
