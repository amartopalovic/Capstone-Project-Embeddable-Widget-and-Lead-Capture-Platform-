/**
 * Mongo models, repositories, indexes, and migrations.
 *
 * Stage 1 establishes only the workspace boundary. Connection management,
 * workspace-scoped repository interfaces, the migration and index mechanism,
 * and the tenancy invariant from blueprint section 9.1 all arrive in Stage 2.
 *
 * The health probe in apps/server deliberately does NOT import from here: it
 * checks raw infrastructure connectivity, which is not a data-layer concern.
 */

export const DATABASE_PACKAGE_STATUS = 'stage-1-shell' as const;
