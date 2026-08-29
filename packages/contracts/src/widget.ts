import * as z from 'zod';

/**
 * Widget catalog, field schema, and configuration contracts
 * (blueprint 4.3, 4.4, 4.5).
 *
 * Everything a creator can configure is enumerated here. There is deliberately
 * no free-form style, script, HTML, or class field anywhere in this file:
 * blueprint 4.3 says "Arbitrary CSS and JavaScript are not accepted" and
 * section 17 repeats it as "no arbitrary HTML/CSS/JS". Visual customization is
 * a closed set of colors, typography, spacing, radius, and button style, so a
 * malicious or careless setting cannot become executable in a visitor's page.
 */

// ---------------------------------------------------------------------------
// Widget types and lifecycle
// ---------------------------------------------------------------------------

/** The three types in blueprint 4.3. Locked, not an open string. */
export const WIDGET_TYPES = ['contact_form', 'email_signup', 'cta_popover'] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const WIDGET_FIELD_TYPES = [
  'name',
  'email',
  'subject',
  'message',
  'phone',
  'company',
  'consent',
] as const;
export type WidgetFieldType = (typeof WIDGET_FIELD_TYPES)[number];

/**
 * Upper bound on a field's configurable maximum length.
 *
 * Derived, not invented: blueprint 7.3 makes the submission endpoint reject
 * "long-text values above 5,000 characters". A creator who could configure a
 * larger maximum would be building a form whose own submissions the server
 * would then refuse, so the builder's ceiling is pinned to the same number.
 */
export const WIDGET_FIELD_MAX_LENGTH = 5000;
export const WIDGET_FIELD_MIN_LENGTH = 1;

/** Labels and help text are chrome, not content; they stay short. */
export const WIDGET_LABEL_MAX = 80;
export const WIDGET_HELP_TEXT_MAX = 200;
export const WIDGET_NAME_MAX = 80;

/**
 * Fields a widget type must always keep (blueprint 4.3).
 *
 * The CTA popover's requirement is conditional - email is mandatory only when
 * its built-in lead form is enabled - so it is not expressible here and is
 * enforced by the domain rule that reads the CTA action.
 */
export const MANDATORY_FIELDS: Readonly<Record<WidgetType, readonly WidgetFieldType[]>> = {
  contact_form: ['email', 'message'],
  email_signup: ['email'],
  cta_popover: [],
};

/** Fields a widget type starts with (blueprint 4.3). */
export const DEFAULT_FIELDS: Readonly<Record<WidgetType, readonly WidgetFieldType[]>> = {
  contact_form: ['name', 'email', 'subject', 'message'],
  email_signup: ['email'],
  cta_popover: ['email'],
};

/**
 * Fields this widget type may never lose, for THIS configuration.
 *
 * Lives in the shared package rather than on the server because both sides need
 * the identical answer: the API refuses a configuration that drops one, and the
 * builder must not offer a remove control that would always be refused. Two
 * implementations of the same rule would eventually disagree, and the UI would
 * be the one that looked broken.
 *
 * The CTA popover is the conditional case in blueprint 4.3: email is mandatory
 * only "when lead capture is enabled", which depends on the CTA action rather
 * than on the type, so it cannot live in the static table above.
 */
export function mandatoryFieldsFor(
  type: WidgetType,
  config: { readonly ctaAction: { readonly kind: string } },
): readonly WidgetFieldType[] {
  if (type === 'cta_popover') {
    return config.ctaAction.kind === 'lead_form' ? ['email'] : [];
  }
  return MANDATORY_FIELDS[type];
}

/**
 * Whether this widget collects anything at all.
 *
 * A CTA popover pointing at an external URL is a button, not a form, so field
 * rules do not apply to it and the preview shows no fields.
 */
export function collectsSubmissions(
  type: WidgetType,
  config: { readonly ctaAction: { readonly kind: string } },
): boolean {
  if (type !== 'cta_popover') return true;
  return config.ctaAction.kind === 'lead_form';
}

// ---------------------------------------------------------------------------
// Field schema
// ---------------------------------------------------------------------------

export const widgetFieldSchema = z.object({
  type: z.enum(WIDGET_FIELD_TYPES),
  label: z.string().trim().min(1, 'Give this field a label').max(WIDGET_LABEL_MAX),
  placeholder: z.string().trim().max(WIDGET_LABEL_MAX),
  helpText: z.string().trim().max(WIDGET_HELP_TEXT_MAX),
  required: z.boolean(),
  maxLength: z.number().int().min(WIDGET_FIELD_MIN_LENGTH).max(WIDGET_FIELD_MAX_LENGTH),
  /** Display order, ascending. Duplicates are rejected by the domain rule. */
  order: z.number().int().min(0).max(50),
});
export type WidgetField = z.infer<typeof widgetFieldSchema>;

// ---------------------------------------------------------------------------
// Appearance - a closed set, never free-form style
// ---------------------------------------------------------------------------

/** `#rgb` or `#rrggbb`. Anything else is not a colour we will emit. */
export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a hex colour such as #3d2bd9');

export const FONT_FAMILIES = ['system', 'sans', 'serif', 'mono'] as const;
export const FONT_SIZES = ['small', 'medium', 'large'] as const;
export const SPACING_SCALES = ['compact', 'regular', 'roomy'] as const;
export const BORDER_RADII = ['none', 'small', 'medium', 'large', 'pill'] as const;
export const BUTTON_STYLES = ['solid', 'outline', 'ghost'] as const;

export const widgetAppearanceSchema = z.object({
  primaryColor: hexColorSchema,
  backgroundColor: hexColorSchema,
  textColor: hexColorSchema,
  fontFamily: z.enum(FONT_FAMILIES),
  fontSize: z.enum(FONT_SIZES),
  spacing: z.enum(SPACING_SCALES),
  borderRadius: z.enum(BORDER_RADII),
  buttonStyle: z.enum(BUTTON_STYLES),
});
export type WidgetAppearance = z.infer<typeof widgetAppearanceSchema>;

// ---------------------------------------------------------------------------
// Display, triggers, targeting (blueprint 4.4)
// ---------------------------------------------------------------------------

export const FORM_MODES = ['inline', 'modal'] as const;
export type FormMode = (typeof FORM_MODES)[number];

export const TRIGGER_TYPES = ['click', 'delay', 'scroll_depth', 'exit_intent'] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const MAX_TRIGGER_DELAY_SECONDS = 600;

/**
 * An opening trigger.
 *
 * A discriminated union rather than one object with optional fields, so a
 * delay trigger cannot carry a scroll percentage and there is no "which field
 * applies to which type" rule for a reader to remember.
 */
export const widgetTriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click') }),
  z.object({
    type: z.literal('delay'),
    delaySeconds: z.number().int().min(0).max(MAX_TRIGGER_DELAY_SECONDS),
  }),
  z.object({
    type: z.literal('scroll_depth'),
    percent: z.number().int().min(1).max(100),
  }),
  // Blueprint 4.4: desktop-capable behaviour. Where it cannot be detected the
  // runtime does not fake it; that is Stage 6's problem, not this schema's.
  z.object({ type: z.literal('exit_intent') }),
]);
export type WidgetTrigger = z.infer<typeof widgetTriggerSchema>;

export const ctaActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('external_url'), url: z.string().trim().min(1).max(2048) }),
  z.object({ kind: z.literal('lead_form') }),
]);
export type CtaAction = z.infer<typeof ctaActionSchema>;

export const SUCCESS_MESSAGE_MAX = 300;

export const successOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    message: z.string().trim().min(1).max(SUCCESS_MESSAGE_MAX),
  }),
  z.object({ kind: z.literal('redirect'), url: z.string().trim().min(1).max(2048) }),
]);
export type SuccessOutcome = z.infer<typeof successOutcomeSchema>;

export const MAX_COOLDOWN_DAYS = 365;

export const cooldownSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session') }),
  z.object({ kind: z.literal('days'), days: z.number().int().min(1).max(MAX_COOLDOWN_DAYS) }),
]);
export type Cooldown = z.infer<typeof cooldownSchema>;

export const MAX_ALLOWED_DOMAINS = 20;
export const MAX_PAGE_PATTERNS = 20;
export const MAX_WIDGET_FIELDS = 20;

/**
 * A host entry: an exact host, or an explicit `*.` wildcard.
 *
 * Only a single leading `*.` is accepted. `*.example.com` deliberately does not
 * cover `example.com` (blueprint 4.4), and matching is implemented as a pure
 * function on the server rather than as a pattern the client can influence.
 */
export const allowedDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(
    /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$|^localhost$/,
    'Enter a host such as example.com or *.example.com',
  );

/**
 * A page pattern, as a SAFE glob (blueprint 4.4).
 *
 * The character set is restricted at the schema edge so a pattern can never
 * carry regular-expression syntax. The matcher escapes everything anyway, but
 * refusing the input outright means a creator gets a clear error instead of a
 * pattern that silently matches nothing.
 */
export const pagePatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9\-._~:/?#[\]@!$&'()+,;=%*]+$/, 'Use a path such as /pricing or /blog/**');

export const widgetTargetingSchema = z.object({
  allowedDomains: z.array(allowedDomainSchema).max(MAX_ALLOWED_DOMAINS),
  includePatterns: z.array(pagePatternSchema).max(MAX_PAGE_PATTERNS),
  excludePatterns: z.array(pagePatternSchema).max(MAX_PAGE_PATTERNS),
  cooldown: cooldownSchema,
});
export type WidgetTargeting = z.infer<typeof widgetTargetingSchema>;

// ---------------------------------------------------------------------------
// The full configuration snapshot stored on a revision
// ---------------------------------------------------------------------------

export const widgetConfigSchema = z.object({
  headline: z.string().trim().min(1).max(WIDGET_LABEL_MAX),
  body: z.string().trim().max(SUCCESS_MESSAGE_MAX),
  submitLabel: z.string().trim().min(1).max(WIDGET_LABEL_MAX),
  fields: z.array(widgetFieldSchema).max(MAX_WIDGET_FIELDS),
  appearance: widgetAppearanceSchema,
  /** Inline or modal for the form types; ignored for the CTA popover, which
   *  blueprint 4.4 locks to a floating popover. */
  formMode: z.enum(FORM_MODES),
  triggers: z.array(widgetTriggerSchema).max(TRIGGER_TYPES.length),
  ctaAction: ctaActionSchema,
  success: successOutcomeSchema,
  targeting: widgetTargetingSchema,
});
export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const createWidgetSchema = z.object({
  type: z.enum(WIDGET_TYPES),
  name: z.string().trim().min(1, 'Give this widget a name').max(WIDGET_NAME_MAX),
});
export type CreateWidget = z.infer<typeof createWidgetSchema>;

/**
 * A draft edit.
 *
 * `expectedVersion` is mandatory. Blueprint 10.1 requires update operations
 * that can conflict to use a version precondition and answer 409 on a stale
 * write, and a teammate silently losing their edit is exactly the failure that
 * rule exists to prevent - so there is no "just overwrite" path.
 */
export const updateDraftSchema = z.object({
  name: z.string().trim().min(1).max(WIDGET_NAME_MAX).optional(),
  config: widgetConfigSchema,
  expectedVersion: z.number().int().min(0),
});
export type UpdateDraft = z.infer<typeof updateDraftSchema>;

export const publishWidgetSchema = z.object({
  expectedVersion: z.number().int().min(0),
});
export type PublishWidget = z.infer<typeof publishWidgetSchema>;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export const WIDGET_LIFECYCLE_STATES = ['draft', 'published', 'unpublished', 'deleted'] as const;
export type WidgetLifecycleState = (typeof WIDGET_LIFECYCLE_STATES)[number];

export interface WidgetSummary {
  readonly id: string;
  /** The opaque identifier that appears in the embed snippet. */
  readonly publicId: string;
  readonly type: WidgetType;
  readonly name: string;
  readonly state: WidgetLifecycleState;
  readonly publishedRevisionNumber: number | null;
  readonly publishedAt: string | null;
  readonly hasUnpublishedChanges: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WidgetRevisionSummary {
  readonly id: string;
  readonly revisionNumber: number;
  readonly status: 'draft' | 'published';
  readonly version: number;
  readonly config: WidgetConfig;
  readonly publishedAt: string | null;
  readonly publishedByUserId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WidgetDetail {
  readonly widget: WidgetSummary;
  /** The editable draft, or null when the widget has only a live revision. */
  readonly draft: WidgetRevisionSummary | null;
  readonly published: WidgetRevisionSummary | null;
  /** The one-line snippet from blueprint 7.2. */
  readonly snippet: string;
}

// ---------------------------------------------------------------------------
// The PUBLIC config, served to a visitor's browser (blueprint 7.2)
// ---------------------------------------------------------------------------

/**
 * The renderable half of a widget's configuration.
 *
 * Blueprint 7.2: "The public config contains only renderable settings. It never
 * includes email recipients, webhook URLs/secrets, internal notes, tenant
 * identifiers, or other private settings."
 *
 * This type is the allowlist that makes that true. It is built by naming the
 * fields that go OUT rather than by removing the ones that must not, because a
 * later stage adding a private setting to `WidgetConfig` would otherwise leak
 * it by default - and a leak by omission is the kind nobody notices.
 *
 * `allowedDomains` is deliberately absent even though it is not secret. It is
 * not renderable, the server is the authority on it (7.2 step 5), and shipping
 * an allowlist to the client it is meant to constrain invites someone to try
 * editing it.
 */
export interface PublicWidgetConfig {
  readonly headline: string;
  readonly body: string;
  readonly submitLabel: string;
  readonly fields: readonly WidgetField[];
  readonly appearance: WidgetAppearance;
  readonly formMode: FormMode;
  readonly triggers: readonly WidgetTrigger[];
  readonly ctaAction: CtaAction;
  readonly success: SuccessOutcome;
  /** Only the parts the runtime evaluates itself (7.2 step 7). */
  readonly targeting: {
    readonly includePatterns: readonly string[];
    readonly excludePatterns: readonly string[];
    readonly cooldown: Cooldown;
  };
}

/** What `GET /public/widgets/:publicId/config` returns. */
export interface PublicWidgetResponse {
  readonly publicId: string;
  readonly type: WidgetType;
  /** Which revision this is, so a stale cache is identifiable in support. */
  readonly revision: number;
  readonly config: PublicWidgetConfig;
}

/**
 * Narrow a stored configuration to the public one.
 *
 * Shared rather than server-only so the type and the projection stay in one
 * place; the runtime imports the TYPE and never this function.
 */
export function toPublicConfig(config: WidgetConfig): PublicWidgetConfig {
  return {
    headline: config.headline,
    body: config.body,
    submitLabel: config.submitLabel,
    fields: config.fields,
    appearance: config.appearance,
    formMode: config.formMode,
    triggers: config.triggers,
    ctaAction: config.ctaAction,
    success: config.success,
    targeting: {
      includePatterns: config.targeting.includePatterns,
      excludePatterns: config.targeting.excludePatterns,
      cooldown: config.targeting.cooldown,
    },
  };
}
