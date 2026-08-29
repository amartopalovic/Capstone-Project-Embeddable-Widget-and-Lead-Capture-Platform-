import type { CSSProperties } from 'react';
import type { WidgetConfig, WidgetType } from '@lcp/contracts';

/**
 * Live preview of a widget draft.
 *
 * The one deliberate flourish on this surface. Everywhere else in the product a
 * panel is a panel; here the preview is framed as a fragment of somebody
 * else's page, because that is the whole point of the product - a widget is a
 * guest on a website the customer does not control. The corner ticks are the
 * same mount bracket the auth panels use, finally doing the job the metaphor
 * was named for.
 *
 * It is a RENDERING, not a form. There are no `input` elements: a preview full
 * of disabled, duplicate-labelled controls would clutter the accessibility tree
 * with a second copy of every field the settings form already offers, and it
 * could never be submitted anyway. Field boxes are plain elements with their
 * label as text, so a screen-reader user can still read back what they built.
 */

/** `#rgb` or `#rrggbb` only. */
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Refuse to emit a colour that is not a hex triple.
 *
 * The server already validates this and the schema rejects anything else, so
 * this is defence in depth rather than the only guard - but a colour is the one
 * configured value that reaches CSS, and blueprint 4.3 is explicit that no
 * arbitrary style is accepted.
 */
function safeColor(value: string, fallback: string): string {
  return HEX.test(value) ? value : fallback;
}

/**
 * The same colour at a given alpha, as `#rrggbbaa`.
 *
 * So a field box can have a faint BORDER without dragging its text down with
 * it. Muting the whole element was the first approach and axe caught it: at 55%
 * opacity the placeholder rendered as #7e7f8a on white, which is 3.96:1 and
 * below the 4.5:1 WCAG 2.2 AA requires for text. A border is non-text and needs
 * only 3:1, so the two now scale separately.
 */
function withAlpha(hex: string, alpha: number): string {
  const expanded =
    hex.length === 4
      ? `#${hex[1] ?? ''}${hex[1] ?? ''}${hex[2] ?? ''}${hex[2] ?? ''}${hex[3] ?? ''}${hex[3] ?? ''}`
      : hex;
  const suffix = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${expanded}${suffix}`;
}

const FONT_STACKS: Record<WidgetConfig['appearance']['fontFamily'], string> = {
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  sans: '"Space Grotesk Variable", ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: '"JetBrains Mono Variable", ui-monospace, "Cascadia Code", monospace',
};

const FONT_SIZES: Record<WidgetConfig['appearance']['fontSize'], string> = {
  small: '13px',
  medium: '15px',
  large: '17px',
};

const SPACING: Record<WidgetConfig['appearance']['spacing'], { gap: string; pad: string }> = {
  compact: { gap: '8px', pad: '14px' },
  regular: { gap: '12px', pad: '20px' },
  roomy: { gap: '18px', pad: '28px' },
};

const RADII: Record<WidgetConfig['appearance']['borderRadius'], string> = {
  none: '0px',
  small: '4px',
  medium: '8px',
  large: '14px',
  pill: '999px',
};

export interface WidgetPreviewProps {
  readonly type: WidgetType;
  readonly config: WidgetConfig;
}

export function WidgetPreview({ type, config }: WidgetPreviewProps): React.JSX.Element {
  const { appearance } = config;
  const primary = safeColor(appearance.primaryColor, '#3d2bd9');
  const background = safeColor(appearance.backgroundColor, '#ffffff');
  const text = safeColor(appearance.textColor, '#14162b');
  const spacing = SPACING[appearance.spacing];
  const radius = RADII[appearance.borderRadius];

  const surface: CSSProperties = {
    backgroundColor: background,
    color: text,
    fontFamily: FONT_STACKS[appearance.fontFamily],
    fontSize: FONT_SIZES[appearance.fontSize],
    padding: spacing.pad,
    borderRadius: radius,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.gap,
  };

  const buttonStyles: Record<WidgetConfig['appearance']['buttonStyle'], CSSProperties> = {
    solid: { backgroundColor: primary, color: '#ffffff', border: `1px solid ${primary}` },
    outline: { backgroundColor: 'transparent', color: primary, border: `1px solid ${primary}` },
    ghost: { backgroundColor: 'transparent', color: primary, border: '1px solid transparent' },
  };

  // A CTA popover that links out is a button, not a form.
  const showsFields = type !== 'cta_popover' || config.ctaAction.kind === 'lead_form';
  const ordered = [...config.fields].sort((a, b) => a.order - b.order);

  return (
    <figure className="m-0">
      {/*
       * The host page. A tinted, dashed area standing in for a website we do
       * not control - deliberately NOT fake browser chrome with traffic lights,
       * which would be decoration rather than information.
       */}
      <div className="relative border border-dashed border-edge bg-paper p-6 sm:p-8">
        <p className="absolute left-3 top-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
          Their page
        </p>

        <div className="relative mx-auto mt-3 max-w-sm">
          {/* The mount bracket, at last framing something actually mounted. */}
          <div aria-hidden="true" className="pointer-events-none absolute -inset-3">
            {[
              'left-0 top-0 border-l border-t',
              'right-0 top-0 border-r border-t',
              'bottom-0 left-0 border-b border-l',
              'bottom-0 right-0 border-b border-r',
            ].map((corner) => (
              <span key={corner} className={`absolute h-3 w-3 border-signal/45 ${corner}`} />
            ))}
          </div>

          <div data-testid="widget-preview" style={surface} className="shadow-sm">
            <p style={{ fontWeight: 600, fontSize: '1.15em', margin: 0 }}>{config.headline}</p>
            {config.body !== '' && (
              <p style={{ margin: 0, opacity: 0.9, lineHeight: 1.5 }}>{config.body}</p>
            )}

            {showsFields &&
              ordered.map((field) => (
                <div key={field.type} style={{ display: 'grid', gap: '4px' }}>
                  <span style={{ fontSize: '0.85em', opacity: 0.95 }}>
                    {field.label}
                    {field.required && <span style={{ color: primary }}> *</span>}
                  </span>

                  {field.type === 'consent' ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          width: '14px',
                          height: '14px',
                          border: `1px solid ${withAlpha(text, 0.5)}`,
                          borderRadius: '3px',
                          flex: 'none',
                        }}
                      />
                      <span style={{ fontSize: '0.85em', opacity: 0.9 }}>{field.placeholder}</span>
                    </span>
                  ) : (
                    <span
                      style={{
                        display: 'block',
                        border: `1px solid ${withAlpha(text, 0.5)}`,
                        borderRadius: radius === '999px' ? '999px' : radius,
                        opacity: 0.9,
                        padding: '8px 10px',
                        fontSize: '0.9em',
                        minHeight: field.type === 'message' ? '54px' : undefined,
                      }}
                    >
                      {field.placeholder === '' ? ' ' : field.placeholder}
                    </span>
                  )}

                  {field.helpText !== '' && (
                    <span style={{ fontSize: '0.75em', opacity: 0.9 }}>{field.helpText}</span>
                  )}
                </div>
              ))}

            <span
              style={{
                ...buttonStyles[appearance.buttonStyle],
                borderRadius: radius,
                padding: '9px 14px',
                textAlign: 'center',
                fontWeight: 500,
                fontSize: '0.95em',
              }}
            >
              {config.submitLabel}
            </span>
          </div>
        </div>
      </div>

      <figcaption className="mt-3 text-xs text-muted">
        A preview of the draft. Nothing here is interactive, and nothing is saved until you save.
      </figcaption>
    </figure>
  );
}
