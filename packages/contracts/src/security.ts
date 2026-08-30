/**
 * Security headers and Content Security Policy (blueprint section 17).
 *
 * The policy lives here, as data, for the same reason the RBAC matrix does:
 * more than one thing has to apply it. Express sets these headers on everything
 * it serves; the two Vite applications set them on their own documents. Two
 * hand-written copies of a policy is how a surface quietly ends up laxer than
 * the one that was reviewed.
 *
 * Written as directives rather than a string so a test can assert a PROPERTY of
 * a policy - "script-src does not contain 'unsafe-inline'" - instead of
 * comparing it to a golden string that a future edit would simply update.
 */

export type CspDirectives = Readonly<Record<string, readonly string[]>>;

/**
 * Render directives as a header value.
 *
 * A directive with no values is emitted bare, which is how
 * `upgrade-insecure-requests` and friends are spelled.
 */
export function serializeCsp(directives: CspDirectives): string {
  return Object.entries(directives)
    .map(([name, values]) => (values.length === 0 ? name : `${name} ${values.join(' ')}`))
    .join('; ');
}

/**
 * Directives a browser IGNORES in a `<meta http-equiv>` policy.
 *
 * Found in Chrome rather than in a specification, by watching a browser test
 * report "the Content Security Policy directive 'frame-ancestors' is ignored
 * when delivered via a <meta> element" on every page load. Leaving them in the
 * meta tag is not merely untidy: it makes the tag look like it is providing
 * clickjacking protection that it is not.
 *
 * So the meta copy omits them and the header copy keeps them, which means
 * framing protection for the two static applications depends on a RESPONSE
 * HEADER their host has to send. The dev and preview servers send it, and the
 * secret-rotation runbook records it as a deployment requirement rather than
 * leaving Stage 14 to discover it.
 */
const META_IGNORED_DIRECTIVES = new Set(['frame-ancestors', 'report-uri', 'sandbox']);

/**
 * Render directives for a `<meta http-equiv>` tag.
 *
 * The same policy minus the directives a meta tag cannot carry, so a browser
 * has nothing to complain about and a reader is not misled about what the tag
 * enforces.
 */
export function serializeCspForMeta(directives: CspDirectives): string {
  const carried: Record<string, readonly string[]> = {};
  for (const name of Object.keys(directives)) {
    if (!META_IGNORED_DIRECTIVES.has(name)) carried[name] = directives[name] ?? [];
  }
  return serializeCsp(carried);
}

/**
 * The three directives that matter on EVERY surface, page or not.
 *
 * `frame-ancestors` is the clickjacking control that actually works in modern
 * browsers; `X-Frame-Options` is still sent beside it for anything ancient.
 * `base-uri` stops an injected `<base>` from re-pointing every relative URL on
 * the page, which is the quiet half of most script-injection write-ups.
 * `object-src` closes the plugin surface that a looser `default-src` misses.
 */
const LOCKED: CspDirectives = {
  'base-uri': ["'none'"],
  'frame-ancestors': ["'none'"],
  'object-src': ["'none'"],
};

/**
 * Everything the API serves that is not an HTML page: JSON, the widget loader,
 * the widget runtime, the OpenAPI document.
 *
 * `default-src 'none'` is the correct policy for a JSON response - it has no
 * subresources - and it costs nothing. It matters because a browser that is
 * somehow persuaded to render one of these responses as a document gets a
 * document that can load nothing and submit nowhere.
 */
export const API_CSP: CspDirectives = {
  'default-src': ["'none'"],
  'form-action': ["'none'"],
  ...LOCKED,
};

/**
 * Swagger UI (blueprint 10.1).
 *
 * Every script is same-origin: the bundle, the standalone preset, and our own
 * initialiser all come out of `swagger-ui-dist` served by this API, never a
 * CDN. So `script-src 'self'` holds with no exception, which is the directive
 * that matters.
 *
 * `style-src` carries `'unsafe-inline'`, and that is a real concession rather
 * than an oversight. Swagger UI is a vendored React application that writes
 * style attributes as it renders, and no hash or nonce covers what a
 * third-party bundle decides to inline at runtime. What it buys an attacker is
 * a styling injection on a page that renders no tenant data; what it would cost
 * to avoid is forking Swagger UI, which is not a security improvement. Scripts
 * stay strict, which is where injection is exploitable.
 */
export const DOCS_CSP: CspDirectives = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'"],
  'form-action': ["'none'"],
  ...LOCKED,
};

export interface PageCspOptions {
  /**
   * An origin the page may load scripts from and talk to, beyond its own.
   *
   * The sandbox needs the API's origin here because it installs the widget the
   * way a customer does: one `<script src>` across an origin boundary. The
   * dashboard needs nothing, because blueprint 5.1 puts it on the same Render
   * service as the API.
   */
  readonly apiOrigin?: string | undefined;
  /**
   * Relax the policy for a Vite dev server.
   *
   * Vite's React plugin injects an inline module preamble that no hash can
   * cover, and its client opens a WebSocket. This is OFF for a production
   * build, and a unit test asserts the production policy carries neither
   * relaxation - the point of naming it is that a reader can see exactly which
   * two things development is allowed that deployment is not.
   */
  readonly devServer?: boolean;
}

/**
 * The React dashboard document.
 *
 * `style-src` allows inline styles: Tailwind v4 emits a real stylesheet, but
 * React writes style attributes for measured values, and the builder's live
 * preview renders the widget runtime on this page. Scripts remain strict.
 *
 * `form-action 'self'` rather than `'none'`, because this application does post
 * forms, to itself.
 */
export function dashboardCsp(options: PageCspOptions = {}): CspDirectives {
  const api = options.apiOrigin === undefined ? [] : [options.apiOrigin];
  const dev = options.devServer === true;
  return {
    'default-src': ["'self'"],
    'script-src': dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': dev ? ["'self'", 'ws:', ...api] : ["'self'", ...api],
    'frame-src': ["'none'"],
    'form-action': ["'self'"],
    ...LOCKED,
  };
}

/**
 * The anonymous sandbox document (blueprint 14.3).
 *
 * The strictest page policy in the product, deliberately: it is the one page
 * that embeds the widget runtime across an origin boundary, so it is the proof
 * that a customer with a real CSP can install this widget without weakening it.
 *
 * `style-src 'self'` carries NO `'unsafe-inline'`. That is only possible
 * because the runtime adopts a constructed stylesheet into its shadow root
 * rather than appending a `<style>` element - a `<style>` is an inline style
 * block whatever created it, and would be blocked here. If that regresses, the
 * sandbox's widgets render unstyled, which is what a browser test watches for.
 */
export function sandboxCsp(options: PageCspOptions = {}): CspDirectives {
  const api = options.apiOrigin === undefined ? [] : [options.apiOrigin];
  const dev = options.devServer === true;
  /**
   * The dev relaxation here is `ws:` and NOTHING ELSE.
   *
   * The sandbox has no framework and no React plugin, so Vite's dev server
   * injects only an external module script and opens a WebSocket - there is no
   * inline preamble to allow. That means the policy the browser tests run
   * against is the same strict script policy the built page ships with, rather
   * than a looser cousin of it. It is the one surface in this product where
   * that is true, and it is the surface where it matters most.
   */
  return {
    'default-src': ["'none'"],
    'script-src': ["'self'", ...api],
    'style-src': ["'self'"],
    'img-src': ["'self'", 'data:'],
    /**
     * `data:` is allowed for fonts and nothing else.
     *
     * The bundler inlines a font subset small enough to be worth not paying a
     * request for, so a build that forbade `data:` here would ship a page whose
     * own typography its own policy refuses. Found by a browser test against the
     * BUILT sandbox rather than the dev server. A data URI cannot execute, so
     * this is a different proposition from `data:` in `script-src` - which
     * remains absent, as does `'unsafe-inline'` in both script and style.
     */
    'font-src': ["'self'", 'data:'],
    'connect-src': dev ? ["'self'", 'ws:', ...api] : ["'self'", ...api],
    'form-action': ["'none'"],
    ...LOCKED,
  };
}

/**
 * The headers that are not a CSP.
 *
 * Express gets these from helmet, which owns the exact spellings and their
 * defaults; this record exists so the two Vite applications set the SAME set on
 * their own documents rather than a similar one. `Permissions-Policy` is here
 * rather than left to helmet because helmet does not implement it.
 */
export const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  /**
   * Nothing in this product uses any of these, so every one of them is denied
   * outright. A page that never asks for a camera should say so: saying so
   * costs nothing, and an injected script asking on its behalf does not.
   */
  'Permissions-Policy':
    'accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
};

/**
 * How long a browser should refuse to speak plain HTTP to us.
 *
 * Two years, subdomains included. Not preloaded: preloading is effectively
 * irreversible, and this is a portfolio deployment on a provider subdomain.
 */
export const HSTS_MAX_AGE_SECONDS = 63_072_000;
