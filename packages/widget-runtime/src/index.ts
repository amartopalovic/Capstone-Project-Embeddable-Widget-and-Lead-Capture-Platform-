/**
 * Framework-free widget loader and runtime.
 *
 * Stage 1 establishes only the workspace boundary and a browser library build,
 * proving that this bundle is produced separately from the React application.
 *
 * The stable loader, content-hashed runtime, page-level instance registry,
 * Shadow DOM rendering, targeting, triggers, and cooldown behaviour from
 * blueprint section 8 all arrive in Stage 6.
 */

export const WIDGET_RUNTIME_STATUS = 'stage-1-shell' as const;
