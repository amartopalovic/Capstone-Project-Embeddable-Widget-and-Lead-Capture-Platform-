/**
 * Page include/exclude matching.
 *
 * The implementation moved to `@lcp/contracts` in Stage 6 so the public widget
 * runtime can use the SAME code rather than a copy: blueprint 7.2 splits this
 * work between the server and the browser, and a second implementation would
 * eventually disagree with this one. Re-exported here because the rest of the
 * widget domain, and its tests, already refer to it by this path.
 */

export * from '@lcp/contracts';
