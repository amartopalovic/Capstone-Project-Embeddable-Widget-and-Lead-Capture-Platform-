/** Where a signed-in user goes when nothing more specific was requested. */
export const DEFAULT_LANDING = '/workspace';

/** A backslash, which some browsers normalise into a forward slash in URLs. */
const BACKSLASH = 92;

/**
 * Sanitise a `?next=` destination.
 *
 * Only a path on this origin is ever returned. Anything else - an absolute URL,
 * a protocol-relative `//evil.example`, or the backslash form some browsers
 * normalise into one - falls back to the default landing, so a crafted sign-in
 * link cannot bounce someone off-site with their session freshly established.
 */
export function safeNext(value: string | null): string {
  if (value === null || value === '') return DEFAULT_LANDING;
  if (!value.startsWith('/')) return DEFAULT_LANDING;
  if (value.startsWith('//') || value.charCodeAt(1) === BACKSLASH) return DEFAULT_LANDING;
  return value;
}
