/**
 * Allowed-domain matching (blueprint 4.4).
 *
 * Two rules, both stated in the blueprint and both easy to get subtly wrong:
 *
 *  - matching is "exact hosts plus explicit wildcard subdomains";
 *  - "`*.example.com` does not include `example.com`; both must be listed when
 *    both are allowed".
 *
 * This is a pure function on purpose. Stage 6 will call it with a request
 * Origin and Stage 7 with a submission Origin, and blueprint 18.1 names "host
 * and wildcard matching" as required unit coverage - so it must be testable
 * without a request, a database, or a server.
 */

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
