import { doubleCsrf } from 'csrf-csrf';
import type { Request, RequestHandler, Response } from 'express';

/**
 * CSRF protection for authenticated state-changing requests
 * (blueprint section 10.3).
 *
 * Uses the signed double-submit cookie pattern from `csrf-csrf`. The older
 * `csurf` middleware is deprecated and unmaintained, so it is deliberately not
 * used.
 *
 * The token is bound to the session identifier through `getSessionIdentifier`,
 * so a token minted for one session cannot be replayed against another.
 *
 * The CSRF cookie is intentionally NOT httpOnly: the browser application must
 * read it to echo the token in a header, which is how the double-submit pattern
 * works. It is not a credential on its own - an attacker who could read it
 * could already read the page.
 */
/** Marker on the error `csrf-csrf` throws, matched by the error handler. */
export const CSRF_ERROR_CODE = 'EBADCSRFTOKEN';

export interface CsrfOptions {
  readonly secret: string;
  readonly cookieName: string;
  readonly secure: boolean;
  readonly sameSite: 'strict' | 'lax' | 'none';
}

export interface CsrfUtilities {
  /** Mint a token bound to the current session and set its cookie. */
  readonly generateCsrfToken: (
    request: Request,
    response: Response,
    options?: { overwrite?: boolean },
  ) => string;
  /** Middleware rejecting unsafe methods without a valid token. */
  readonly doubleCsrfProtection: RequestHandler;
}

/**
 * An explicit return type is declared rather than inferred, because the
 * library's inferred shape includes an error type from a transitive package
 * that TypeScript cannot name from here.
 */
export function createCsrf(options: CsrfOptions): CsrfUtilities {
  const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
    getSecret: () => options.secret,
    getSessionIdentifier: (request: Request) => request.session?.id ?? 'anonymous',
    cookieName: options.cookieName,
    cookieOptions: {
      sameSite: options.sameSite,
      secure: options.secure,
      httpOnly: false,
      path: '/',
    },
    // Safe methods never mutate state, so they are exempt.
    ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
    // A known code, so the error handler can map the failure onto the shared
    // error envelope instead of letting it fall through as a 500.
    errorConfig: {
      statusCode: 403,
      message: 'CSRF token missing or invalid',
      code: CSRF_ERROR_CODE,
    },
    getCsrfTokenFromRequest: (request: Request) => request.headers['x-csrf-token'],
  });

  return { generateCsrfToken, doubleCsrfProtection };
}
