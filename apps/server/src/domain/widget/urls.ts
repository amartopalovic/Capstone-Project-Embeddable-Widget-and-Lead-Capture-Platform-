/**
 * CTA destination and redirect validation (blueprint 17: "validated redirects
 * and CTA destinations").
 *
 * Both of these values end up somewhere a visitor's browser will act on: a CTA
 * destination becomes a link's href and a success redirect becomes a
 * navigation. A scheme like `javascript:` or `data:` in either one is script
 * execution in the host page's context, which is the exact thing blueprint 4.3
 * and 17 rule out when they say no arbitrary JavaScript is accepted.
 *
 * The check is an allowlist of schemes, never a denylist. A denylist has to
 * anticipate every dangerous scheme - and browsers keep adding them - whereas
 * an allowlist is wrong only in the safe direction.
 */

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
