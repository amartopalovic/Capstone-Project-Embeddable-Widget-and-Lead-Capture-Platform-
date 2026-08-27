/**
 * Shared accessible React components and design tokens.
 *
 * Stage 1 establishes only the workspace boundary and its build wiring.
 *
 * No design tokens, palette, or components are defined here yet, and that is
 * deliberate: there are no pages to apply them to until Stage 5, and inventing
 * a visual system now would lock in choices with nothing to validate them
 * against. Accessible primitives and the WCAG 2.2 AA foundations from blueprint
 * section 14.1 arrive with the first real UI.
 */

export const UI_PACKAGE_STATUS = 'stage-1-shell' as const;
