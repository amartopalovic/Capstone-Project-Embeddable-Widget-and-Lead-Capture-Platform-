import { randomBytes } from 'node:crypto';

/**
 * Public widget identifiers and the one-line embed snippet (blueprint 7.2).
 *
 * Blueprint 10.1 requires public widget APIs to use "opaque public widget IDs".
 * A Mongo `_id` is not opaque: it encodes its creation time and its counter
 * runs in sequence, so one identifier tells you roughly when a workspace's
 * other widgets were made and narrows the search for them. A random identifier
 * says nothing.
 */

/** 16 bytes of randomness, base32-ish and case-insensitive to transcribe. */
const PUBLIC_ID_BYTES = 16;
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/**
 * A new opaque public identifier.
 *
 * The alphabet drops `l`, `o`, `0`, and `1`, because these identifiers get read
 * aloud, copied out of documentation, and retyped by whoever is installing the
 * snippet on a customer site.
 */
export function generatePublicId(): string {
  const bytes = randomBytes(PUBLIC_ID_BYTES);
  let id = 'w_';
  for (const byte of bytes) {
    id += ALPHABET[byte % ALPHABET.length] ?? 'a';
  }
  return id;
}

/** Shape check for an identifier arriving from outside. */
export function isPublicIdShape(value: string): boolean {
  return new RegExp(`^w_[${ALPHABET}]{${String(PUBLIC_ID_BYTES)}}$`).test(value);
}

/** Where the shared loader lives. Stage 6 builds the route; the path is fixed now. */
export const LOADER_PATH = '/widget/v1/loader.js';

/**
 * The one-line snippet a customer pastes into their page (blueprint 7.2).
 *
 * `async` so it never blocks the host page's rendering, and `data-widget`
 * rather than a query string so one cached loader file serves every widget -
 * which is what blueprint 8.2's 5-minute loader cache and 7.2's "loaded only
 * once" both depend on.
 *
 * The shape is fixed from this stage forward: it is printed into customer
 * pages, and changing it later would break every existing installation.
 */
export function embedSnippet(publicBaseUrl: string, publicId: string): string {
  const base = publicBaseUrl.replace(/\/+$/, '');
  return `<script async src="${base}${LOADER_PATH}" data-widget="${publicId}"></script>`;
}
