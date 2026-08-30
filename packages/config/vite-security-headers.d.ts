import type { Plugin } from 'vite';

export interface SecurityHeadersOptions {
  /** Serialized Content Security Policy for a production build. */
  readonly csp: string;
  /** Serialized policy for a Vite dev server, which needs its own relaxations. */
  readonly devCsp: string;
  /** The built-document policy minus the directives a meta tag ignores. */
  readonly metaCsp: string;
  /** The dev policy minus the directives a meta tag ignores. */
  readonly devMetaCsp: string;
  /** The headers that are not a CSP, from `@lcp/contracts/security`. */
  readonly headers: Readonly<Record<string, string>>;
}

export function securityHeaders(options: SecurityHeadersOptions): Plugin;
