/**
 * Fixtures, provider fakes, and tenant helpers.
 *
 * Stage 1 establishes only the workspace boundary. Deterministic provider fakes
 * (geo, Brevo, webhooks) and the two-tenant fixtures that every cross-tenant
 * test will depend on arrive with the stages that introduce those providers.
 */

export const TEST_UTILS_PACKAGE_STATUS = 'stage-1-shell' as const;
