/**
 * Fixtures, provider fakes, and tenant helpers.
 *
 * Stage 2 provides the two-tenant fixture that every cross-tenant test depends
 * on (blueprint section 9.1 requires cross-tenant tests for every surface), plus
 * an isolated-database helper so integration tests never share state.
 */

export * from './mongo-fixture.js';
export * from './tenant-fixture.js';
export * from './logging.js';
