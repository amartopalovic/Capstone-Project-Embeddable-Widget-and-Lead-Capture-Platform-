/**
 * Versioned API boundary (blueprint section 10.1).
 */

export const API_VERSION = 'v1' as const;

export const API_PREFIX = `/api/${API_VERSION}` as const;
