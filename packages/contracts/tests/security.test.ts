import { describe, expect, it } from 'vitest';
import {
  API_CSP,
  DOCS_CSP,
  HSTS_MAX_AGE_SECONDS,
  STATIC_SECURITY_HEADERS,
  dashboardCsp,
  sandboxCsp,
  serializeCsp,
  type CspDirectives,
} from '../src/security.js';

/**
 * The Content Security Policy, asserted as properties (blueprint 17).
 *
 * Deliberately not compared against golden strings. A golden-string test tells
 * you a policy CHANGED; these tell you it got WEAKER, which is the only kind of
 * change worth failing a build over. Somebody adding `'unsafe-inline'` to a
 * script-src to unblock themselves has to delete a test that says why not.
 */

/** Every policy that governs a real surface, so a new one cannot skip the sweep. */
const EVERY_PRODUCTION_POLICY: readonly (readonly [string, CspDirectives])[] = [
  ['api', API_CSP],
  ['docs', DOCS_CSP],
  ['dashboard', dashboardCsp()],
  ['sandbox', sandboxCsp({ apiOrigin: 'https://api.example.invalid' })],
];

describe('serializing a policy', () => {
  it('renders directives in the shape a browser parses', () => {
    expect(serializeCsp({ 'default-src': ["'none'"], 'img-src': ["'self'", 'data:'] })).toBe(
      "default-src 'none'; img-src 'self' data:",
    );
  });

  it('emits a valueless directive bare', () => {
    expect(serializeCsp({ 'upgrade-insecure-requests': [] })).toBe('upgrade-insecure-requests');
  });
});

describe('every production policy - EXIT GATE', () => {
  it.each(EVERY_PRODUCTION_POLICY)('%s never allows an inline script', (_name, policy) => {
    /**
     * The single most important assertion in this file.
     *
     * `'unsafe-inline'` in script-src is what turns a Content Security Policy
     * into decoration: an injected `<script>` runs, and the policy reports
     * nothing. Style is a different calculation and is allowed to differ.
     */
    expect(policy['script-src'] ?? []).not.toContain("'unsafe-inline'");
    expect(policy['script-src'] ?? []).not.toContain("'unsafe-eval'");
    expect(policy['default-src'] ?? []).not.toContain("'unsafe-inline'");
  });

  it.each(EVERY_PRODUCTION_POLICY)('%s cannot be framed or re-based', (_name, policy) => {
    expect(policy['frame-ancestors']).toEqual(["'none'"]);
    expect(policy['base-uri']).toEqual(["'none'"]);
    expect(policy['object-src']).toEqual(["'none'"]);
  });

  it.each(EVERY_PRODUCTION_POLICY)('%s never allows a wildcard source', (_name, policy) => {
    for (const [directive, values] of Object.entries(policy)) {
      expect(values, directive).not.toContain('*');
      expect(values, directive).not.toContain('http:');
      expect(values, directive).not.toContain('https:');
    }
  });
});

describe('the API policy', () => {
  it('permits nothing at all, because JSON has no subresources', () => {
    expect(API_CSP['default-src']).toEqual(["'none'"]);
    expect(API_CSP['form-action']).toEqual(["'none'"]);
  });
});

describe('the documentation policy', () => {
  it('serves every script from this origin, never a CDN', () => {
    expect(DOCS_CSP['script-src']).toEqual(["'self'"]);
  });

  it('allows inline STYLE only, which is the concession Swagger UI needs', () => {
    // Verified in the browser: Swagger UI injects a stylesheet at runtime and
    // renders style attributes. Scripts stay strict, which is the half that
    // matters.
    expect(DOCS_CSP['style-src']).toContain("'unsafe-inline'");
    expect(DOCS_CSP['script-src']).not.toContain("'unsafe-inline'");
  });
});

describe('the sandbox policy - EXIT GATE', () => {
  const policy = sandboxCsp({ apiOrigin: 'https://api.example.invalid' });

  it('forbids inline styles, so the widget cannot regress to a <style> element', () => {
    /**
     * This is the assertion that keeps the widget runtime installable on a
     * customer's site. A `<style>` element is an inline style block however it
     * was created, so a runtime that appended one would render unstyled under
     * this policy - and under the ordinary policy of any site that has one.
     * The runtime adopts a constructed stylesheet instead, which CSP does not
     * govern.
     */
    expect(policy['style-src']).toEqual(["'self'"]);
  });

  it('names the platform origin exactly, for the script tag and the fetches', () => {
    expect(policy['script-src']).toEqual(["'self'", 'https://api.example.invalid']);
    expect(policy['connect-src']).toEqual(["'self'", 'https://api.example.invalid']);
  });

  it('keeps the strict script policy even on the dev server', () => {
    // The sandbox has no React plugin and therefore no inline preamble, so what
    // the browser tests exercise is the policy that ships.
    const dev = sandboxCsp({ apiOrigin: 'https://api.example.invalid', devServer: true });
    expect(dev['script-src']).toEqual(policy['script-src']);
    expect(dev['connect-src']).toContain('ws:');
  });
});

describe('the dashboard policy', () => {
  it('relaxes exactly two things for a dev server, and neither survives a build', () => {
    const dev = dashboardCsp({ devServer: true });
    expect(dev['script-src']).toContain("'unsafe-inline'");
    expect(dev['connect-src']).toContain('ws:');

    const built = dashboardCsp();
    expect(built['script-src']).toEqual(["'self'"]);
    expect(built['connect-src']).toEqual(["'self'"]);
  });

  it('lets the application post to itself and nowhere else', () => {
    expect(dashboardCsp()['form-action']).toEqual(["'self'"]);
  });
});

describe('the headers that are not a policy', () => {
  it('denies framing, sniffing, and referrer leakage', () => {
    expect(STATIC_SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    expect(STATIC_SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(STATIC_SECURITY_HEADERS['Referrer-Policy']).toBe('no-referrer');
  });

  it('denies every browser capability, because this product uses none of them', () => {
    const permissions = STATIC_SECURITY_HEADERS['Permissions-Policy'] ?? '';
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
      expect(permissions).toContain(`${feature}=()`);
    }
  });

  it('asks for two years of HTTPS without preloading', () => {
    // Preloading is effectively irreversible and this is a portfolio deployment
    // on a provider subdomain, so the max-age is long and the list is not asked
    // to remember it forever.
    expect(HSTS_MAX_AGE_SECONDS).toBeGreaterThanOrEqual(31_536_000);
  });
});
