import {
  DEFAULT_FIELDS,
  MANDATORY_FIELDS,
  WIDGET_FIELD_MAX_LENGTH,
  type WidgetConfig,
  type WidgetField,
  type WidgetFieldType,
  type WidgetType,
} from '@lcp/contracts';

/**
 * The starting configuration for a new widget (blueprint 4.3).
 *
 * A new widget is created as a saveable draft, not as an empty shell: the
 * defaults for its type are already in place, its mandatory fields are already
 * required, and it is already valid against `validateConfig`. What it is NOT is
 * publishable - it has no allowed domain yet, which is the one thing blueprint
 * 4.4 requires before going live and the one thing only the creator can supply.
 */

/** Sensible per-field defaults; every one is editable afterwards. */
const FIELD_DEFAULTS: Readonly<
  Record<
    WidgetFieldType,
    { readonly label: string; readonly placeholder: string; readonly maxLength: number }
  >
> = {
  name: { label: 'Name', placeholder: 'Your name', maxLength: 120 },
  email: { label: 'Email', placeholder: 'you@example.com', maxLength: 254 },
  subject: { label: 'Subject', placeholder: 'How can we help?', maxLength: 200 },
  message: {
    label: 'Message',
    placeholder: 'Tell us a little more',
    maxLength: WIDGET_FIELD_MAX_LENGTH,
  },
  phone: { label: 'Phone', placeholder: '', maxLength: 40 },
  company: { label: 'Company', placeholder: '', maxLength: 120 },
  consent: { label: 'I agree to be contacted', placeholder: '', maxLength: 1 },
};

function defaultField(type: WidgetFieldType, order: number, required: boolean): WidgetField {
  const defaults = FIELD_DEFAULTS[type];
  return {
    type,
    label: defaults.label,
    placeholder: defaults.placeholder,
    helpText: '',
    required,
    maxLength: defaults.maxLength,
    order,
  };
}

const DEFAULT_APPEARANCE = {
  primaryColor: '#3d2bd9',
  backgroundColor: '#ffffff',
  textColor: '#14162b',
  fontFamily: 'system',
  fontSize: 'medium',
  spacing: 'regular',
  borderRadius: 'small',
  buttonStyle: 'solid',
} as const;

export function defaultConfigFor(type: WidgetType): WidgetConfig {
  const mandatory = new Set<WidgetFieldType>(MANDATORY_FIELDS[type]);
  const fields = DEFAULT_FIELDS[type].map((fieldType, index) =>
    defaultField(fieldType, index, mandatory.has(fieldType) || fieldType === 'email'),
  );

  const base = {
    fields,
    appearance: { ...DEFAULT_APPEARANCE },
    targeting: {
      // Empty on purpose: blueprint 4.4 requires at least one allowed domain
      // before publishing, and only the creator knows which.
      allowedDomains: [],
      includePatterns: [],
      excludePatterns: [],
      cooldown: { kind: 'session' as const },
    },
    success: { kind: 'message' as const, message: 'Thanks - we will be in touch shortly.' },
  };

  switch (type) {
    case 'contact_form':
      return {
        ...base,
        headline: 'Get in touch',
        body: 'Send us a message and we will reply by email.',
        submitLabel: 'Send message',
        formMode: 'inline',
        triggers: [],
        ctaAction: { kind: 'lead_form' },
      };

    case 'email_signup':
      return {
        ...base,
        headline: 'Subscribe for updates',
        body: 'Occasional product news. Unsubscribe at any time.',
        submitLabel: 'Subscribe',
        formMode: 'inline',
        triggers: [],
        ctaAction: { kind: 'lead_form' },
      };

    case 'cta_popover':
      return {
        ...base,
        headline: 'Talk to the team',
        body: 'Book a walkthrough with someone who knows the product.',
        submitLabel: 'Request a call',
        // Blueprint 4.4 locks the CTA popover to a floating popover.
        formMode: 'inline',
        // A popover that is never triggered can never open, so it starts with
        // the least intrusive trigger rather than none.
        triggers: [{ type: 'delay', delaySeconds: 10 }],
        ctaAction: { kind: 'lead_form' },
      };
  }
}
