/**
 * Shared contracts and validation schemas.
 *
 * Stage 1 establishes only the workspace boundary. The single export below is
 * the versioned API prefix from blueprint section 10.1, which apps/server
 * consumes so the cross-workspace build graph is genuinely exercised rather
 * than merely configured. Real request/response contracts, error shapes, and
 * pagination types arrive in Stage 2.
 */

export const API_VERSION = 'v1' as const;

export const API_PREFIX = `/api/${API_VERSION}` as const;
