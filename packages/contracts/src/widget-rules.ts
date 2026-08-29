/**
 * Pure widget rules, shared by the server and the public runtime.
 *
 * These live in the shared package rather than on the server because BOTH sides
 * need the identical answer and blueprint 7.2 splits the work between them: the
 * backend confirms the request Origin is permitted (step 5) and the runtime
 * evaluates include/exclude patterns against the real page URL (step 7). Two
 * implementations of "does this match" would eventually disagree, and the
 * disagreement would be invisible until a widget appeared on a page it should
 * not have.
 *
 * Nothing here imports anything. That is deliberate: this module is bundled
 * into the framework-free runtime that ships to customer websites, and blueprint
 * 8.3 requires no dashboard framework - and by extension no validation library -
 * enters that bundle.
 */

// ===========================================================================
// domains
// ===========================================================================

/** A hostname, lowercased with any trailing dot removed. */
function normalizeHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  // A fully-qualified name may legitimately end in a dot; `example.com.` and
  // `example.com` are the same host and must not match differently.
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
}

/**
 * The hostname of an Origin or URL, or null if it is not one we will match.
 *
 * Returns null rather than throwing so a malformed Origin header is a clean
 * "not allowed" instead of a 500.
 */
export function hostFromOrigin(origin: string): string | null {
  try {
    const url = new URL(origin.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.hostname === '') return null;
    return normalizeHost(url.hostname);
  } catch {
    return null;
  }
}

/**
 * Whether one allowlist entry admits one host.
 *
 * A `*.` entry matches any host with at least one additional label in front of
 * the base - so `*.example.com` admits `app.example.com` and
 * `eu.app.example.com`, but never the bare `example.com`. The apex is excluded
 * by requiring the label before the base to be non-empty, which is precisely
 * the blueprint's wildcard rule.
 */
export function domainEntryMatches(entry: string, host: string): boolean {
  const normalizedEntry = normalizeHost(entry);
  const normalizedHost = normalizeHost(host);
  if (normalizedEntry === '' || normalizedHost === '') return false;

  if (!normalizedEntry.startsWith('*.')) {
    return normalizedEntry === normalizedHost;
  }

  const base = normalizedEntry.slice(2);
  if (base === '') return false;

  // The apex itself is deliberately NOT covered.
  if (normalizedHost === base) return false;

  const suffix = `.${base}`;
  if (!normalizedHost.endsWith(suffix)) return false;

  // There must be something in front of the dot, or `.example.com` would pass.
  return normalizedHost.length > suffix.length;
}

/** Whether any entry in the allowlist admits this host. */
export function isHostAllowed(allowedDomains: readonly string[], host: string): boolean {
  return allowedDomains.some((entry) => domainEntryMatches(entry, host));
}

/** Whether any entry admits this Origin header value. */
export function isOriginAllowed(allowedDomains: readonly string[], origin: string): boolean {
  const host = hostFromOrigin(origin);
  if (host === null) return false;
  return isHostAllowed(allowedDomains, host);
}

// ===========================================================================
// page-patterns
// ===========================================================================

/** Cap on compiled patterns, so a long allowlist cannot grow without bound. */
const MAX_PATTERN_LENGTH = 512;

/**
 * The path plus query of a URL, which is what patterns are written against.
 *
 * Returns null for input that is not a URL we will match, so a malformed page
 * URL becomes "no match" rather than an exception.
 */
export function pathFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/**
 * Compile one safe glob to an anchored regular expression.
 *
 * Exported for its unit tests: asserting the compiled source is how the
 * "no regex syntax survives" property is checked directly, rather than only
 * inferred from matching behaviour.
 */
export function compilePagePattern(pattern: string): RegExp | null {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) return null;

  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === undefined) return null;

    if (character === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }

    // Everything that is not a wildcard is escaped, including characters that
    // are harmless today, so the set never has to be revisited.
    source += character.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
  }

  try {
    return new RegExp(`^${source}$`);
  } catch {
    return null;
  }
}

/** Whether a path matches one pattern. */
export function matchesPattern(pattern: string, path: string): boolean {
  const compiled = compilePagePattern(pattern);
  if (compiled === null) return false;
  return compiled.test(path);
}

/** Whether a path matches at least one of the patterns. */
export function matchesAnyPattern(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => matchesPattern(pattern, path));
}

/**
 * The include/exclude decision (blueprint 4.4).
 *
 * An empty include list means "every page", which is what a creator who has
 * not narrowed their targeting expects. Exclude always wins over include: the
 * safer reading of a conflict is that the creator meant to keep the widget off
 * that page.
 */
export function isPageTargeted(
  targeting: {
    readonly includePatterns: readonly string[];
    readonly excludePatterns: readonly string[];
  },
  path: string,
): boolean {
  if (matchesAnyPattern(targeting.excludePatterns, path)) return false;
  if (targeting.includePatterns.length === 0) return true;
  return matchesAnyPattern(targeting.includePatterns, path);
}

// ===========================================================================
// urls
// ===========================================================================

/** The only schemes a widget may send a visitor to. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export type UrlRejection =
  'malformed' | 'unsupported_scheme' | 'embedded_credentials' | 'missing_host';

export type UrlCheck =
  | { readonly ok: true; readonly normalized: string }
  | { readonly ok: false; readonly reason: UrlRejection };

/**
 * Validate an absolute destination URL.
 *
 * Relative URLs are refused rather than resolved: there is no base to resolve
 * them against, because the page this will run on belongs to the customer and
 * is not known when the widget is configured.
 */
export function checkDestinationUrl(raw: string): UrlCheck {
  const value = raw.trim();
  if (value === '') return { ok: false, reason: 'malformed' };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: 'unsupported_scheme' };
  }

  if (parsed.hostname === '') {
    return { ok: false, reason: 'missing_host' };
  }

  /**
   * `https://evil.example.com@bank.example.com/` reads to a human as the bank
   * and resolves to the attacker. Since a creator never needs credentials in a
   * CTA link, refusing them removes the ambiguity entirely.
   */
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'embedded_credentials' };
  }

  return { ok: true, normalized: parsed.toString() };
}

export function isSafeDestinationUrl(raw: string): boolean {
  return checkDestinationUrl(raw).ok;
}

/** A message a creator can act on, per rejection reason. */
export function describeUrlRejection(reason: UrlRejection): string {
  switch (reason) {
    case 'malformed':
      return 'Enter a full web address, including https://';
    case 'unsupported_scheme':
      return 'Only http and https addresses are allowed';
    case 'embedded_credentials':
      return 'Remove the username or password from this address';
    case 'missing_host':
      return 'Enter a web address that includes a domain';
  }
}
