import type { PublicWidgetConfig } from '@lcp/contracts';

/**
 * The widget's stylesheet, built from the creator's appearance settings.
 *
 * Two rules shape everything here.
 *
 * First, a widget is a GUEST on a page it does not own. It states every
 * property it depends on rather than inheriting: a host page's `* { box-sizing:
 * content-box }` or a global `input { font-size: 40px }` must not be able to
 * deform it. Shadow DOM stops host selectors reaching in, but inheritable
 * properties still cross the boundary, so `:host` resets them explicitly.
 *
 * Second, nothing here is free-form. Every value is either a literal in this
 * file or one of the enumerated appearance settings, and colours are re-checked
 * against a hex pattern before they are interpolated. Blueprint 4.3 and 17 both
 * say no arbitrary CSS is accepted, and a stylesheet built by string
 * concatenation is exactly where that promise would quietly break.
 */

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Refuse anything that is not a hex triple; never interpolate raw input. */
function color(value: string, fallback: string): string {
  return HEX.test(value) ? value : fallback;
}

const FONT_STACKS: Record<string, string> = {
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  sans: 'ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace',
};

const FONT_SIZES: Record<string, string> = { small: '13px', medium: '15px', large: '17px' };
const GAPS: Record<string, string> = { compact: '8px', regular: '12px', roomy: '18px' };
const PADS: Record<string, string> = { compact: '14px', regular: '20px', roomy: '28px' };
const RADII: Record<string, string> = {
  none: '0px',
  small: '4px',
  medium: '8px',
  large: '14px',
  pill: '999px',
};

function lookup(table: Record<string, string>, key: string, fallback: string): string {
  return Object.prototype.hasOwnProperty.call(table, key) ? (table[key] ?? fallback) : fallback;
}

export function buildStyles(config: PublicWidgetConfig): string {
  const a = config.appearance;
  const primary = color(a.primaryColor, '#3d2bd9');
  const surface = color(a.backgroundColor, '#ffffff');
  const ink = color(a.textColor, '#14162b');
  const radius = lookup(RADII, a.borderRadius, '4px');
  const gap = lookup(GAPS, a.spacing, '12px');
  const pad = lookup(PADS, a.spacing, '20px');

  const button =
    a.buttonStyle === 'outline'
      ? `background: transparent; color: ${primary}; border: 1px solid ${primary};`
      : a.buttonStyle === 'ghost'
        ? `background: transparent; color: ${primary}; border: 1px solid transparent;`
        : `background: ${primary}; color: #ffffff; border: 1px solid ${primary};`;

  return `
:host {
  all: initial;
  display: block;
  font-family: ${lookup(FONT_STACKS, a.fontFamily, FONT_STACKS['system'] ?? 'sans-serif')};
  font-size: ${lookup(FONT_SIZES, a.fontSize, '15px')};
  line-height: 1.45;
  color: ${ink};
  box-sizing: border-box;
  text-align: left;
}
/* Stated outright rather than inherited. A host page can force
   box-sizing onto the HOST element with an important universal rule, and an
   inherited value would carry that straight into the shadow tree. */
*, *::before, *::after { box-sizing: border-box; }

.panel {
  background: ${surface};
  color: ${ink};
  border-radius: ${radius};
  padding: ${pad};
  display: flex;
  flex-direction: column;
  gap: ${gap};
  max-width: 380px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.10), 0 8px 28px rgba(0,0,0,0.10);
}

.headline { margin: 0; font-size: 1.15em; font-weight: 600; }
.body { margin: 0; opacity: 0.9; }

.field { display: grid; gap: 4px; }
.label { font-size: 0.85em; opacity: 0.95; }
.required { color: ${primary}; }
.help { font-size: 0.75em; opacity: 0.9; }

input[type="text"], input[type="email"], input[type="tel"], textarea {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid ${ink}80;
  border-radius: ${radius === '999px' ? '999px' : radius};
  padding: 8px 10px;
  width: 100%;
}
textarea { min-height: 84px; resize: vertical; }

.consent { display: flex; align-items: flex-start; gap: 8px; }
.consent input { margin: 2px 0 0; flex: none; }

.submit {
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  padding: 9px 14px;
  border-radius: ${radius};
  ${button}
}

.submit[disabled] { opacity: 0.6; cursor: progress; }

/* The server's answer. Colours are literal rather than tokenised: a failure
   must be legible whatever accent the workspace chose, including one that is
   itself red or green. */
.notice { margin: 10px 0 0; font-size: 14px; line-height: 1.5; }
.notice.error { color: #b3261e; }
.notice.success { color: #1f6f4a; margin: 0; }

/* A visible focus ring the host page cannot remove. WCAG 2.2 Focus
   Appearance, and the reason :host resets outline rather than trusting one. */
:where(button, input, textarea, a):focus-visible {
  outline: 2px solid ${primary};
  outline-offset: 2px;
}

.close {
  position: absolute;
  top: 8px;
  right: 8px;
  font: inherit;
  line-height: 1;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: ${radius};
  color: ${ink};
  opacity: 0.75;
  padding: 6px 8px;
}
.close:hover { opacity: 1; }

/* --- modal --- */
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(10, 11, 24, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 2147483000;
}
.backdrop .panel { position: relative; width: 100%; }

/* --- floating popover --- */
.floating {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483000;
  max-width: calc(100vw - 32px);
}
.floating .panel { position: relative; }

@media (prefers-reduced-motion: no-preference) {
  .panel { animation: lcp-in 160ms ease-out both; }
}
@keyframes lcp-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}

.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
`;
}
