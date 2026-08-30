import helmet from 'helmet';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  API_CSP,
  DOCS_CSP,
  HSTS_MAX_AGE_SECONDS,
  STATIC_SECURITY_HEADERS,
  serializeCsp,
  type CspDirectives,
} from '@lcp/contracts';

/**
 * Security headers for everything Express serves (blueprint 17).
 *
 * helmet owns the exact header spellings and their sane defaults, but its
 * defaults are wrong for this application in two specific places, and both
 * would have been silent:
 *
 *  1. Its default CSP is written for a server that renders HTML. Almost
 *     everything here is JSON or a script, for which `default-src 'none'` is
 *     both stricter and more accurate.
 *  2. Its default `Cross-Origin-Resource-Policy: same-origin` would make the
 *     widget loader unfetchable from any customer's website - the entire
 *     product. That header is relaxed on the two public cross-origin surfaces
 *     and nowhere else.
 *
 * `useDefaults: false` throughout, so the policy that ships is exactly the one
 * written down in `@lcp/contracts/security` rather than that policy merged with
 * whatever helmet's defaults happen to be this major version.
 */

export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: { useDefaults: false, directives: mutable(API_CSP) },
    /**
     * Sent unconditionally, including in development.
     *
     * A browser ignores HSTS received over plain HTTP, so this cannot strand
     * anybody on `http://localhost`; sending it always means the header is
     * covered by the same test in every environment rather than only being
     * asserted in the one place it is hardest to check.
     */
    strictTransportSecurity: {
      maxAge: HSTS_MAX_AGE_SECONDS,
      includeSubDomains: true,
      preload: false,
    },
    referrerPolicy: { policy: 'no-referrer' },
    xFrameOptions: { action: 'deny' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    /**
     * Off. It requires every cross-origin subresource to opt in with CORP or
     * CORS, and this API's whole job is to be embedded in pages it does not
     * control. Enabling it would break the product rather than protect it.
     */
    crossOriginEmbedderPolicy: false,
    xPoweredBy: true,
    noSniff: true,
    xDnsPrefetchControl: { allow: false },
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
  });
}

/**
 * `Permissions-Policy`, which helmet does not implement.
 *
 * Separate middleware rather than a hand-set header at each call site, so the
 * value comes from the same shared record the Vite applications use.
 */
export function permissionsPolicy(): RequestHandler {
  const value = STATIC_SECURITY_HEADERS['Permissions-Policy'] ?? '';
  return (_request: Request, response: Response, next: NextFunction): void => {
    if (value !== '') response.setHeader('Permissions-Policy', value);
    next();
  };
}

/**
 * Replace the CSP on one router's responses.
 *
 * Used by Swagger UI, which is the only HTML page this server serves and
 * therefore the only one for which `default-src 'none'` is wrong.
 */
export function withCsp(directives: CspDirectives): RequestHandler {
  const value = serializeCsp(directives);
  return (_request: Request, response: Response, next: NextFunction): void => {
    response.setHeader('Content-Security-Policy', value);
    next();
  };
}

export const docsCsp = (): RequestHandler => withCsp(DOCS_CSP);

/**
 * Mark a surface as legitimately readable from another origin.
 *
 * Only two surfaces qualify, and both are public by design: the widget loader
 * and runtime, which exist to be fetched by a customer's website, and the
 * sandbox's read-only endpoints, which are fetched by the demo application on
 * its own subdomain. Everything else keeps `same-origin`, so a stray fetch of
 * an API response from a page that is not ours is refused by the browser before
 * the response body is exposed to it.
 */
export function crossOriginReadable(): RequestHandler {
  return (_request: Request, response: Response, next: NextFunction): void => {
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  };
}

/**
 * helmet types its directive values as mutable arrays; the shared policy is
 * deeply readonly so nothing can edit it after review. One copy here rather
 * than a cast at the call site.
 */
function mutable(directives: CspDirectives): Record<string, string[]> {
  const output: Record<string, string[]> = {};
  for (const name of Object.keys(directives)) output[name] = [...(directives[name] ?? [])];
  return output;
}
