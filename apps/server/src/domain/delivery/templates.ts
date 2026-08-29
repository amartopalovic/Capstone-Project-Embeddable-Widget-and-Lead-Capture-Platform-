/**
 * Controlled email templates (blueprint 12.3).
 *
 * "The email system supports controlled customization of subject, message,
 * reply-to, branding, and allowlisted template variables. Arbitrary HTML is not
 * accepted."
 *
 * Two separate dangers, handled separately because conflating them is how
 * template systems leak.
 *
 *  1. **The template comes from a customer.** Someone with
 *     `settings.delivery.write` types a subject and a message body. If that
 *     text reached an HTML email unescaped, it would be a stored XSS aimed at
 *     their own colleagues' mail clients. So customer text is treated as TEXT
 *     everywhere and escaped on the way into HTML.
 *  2. **The variables come from a visitor.** `{{contact.name}}` is whatever a
 *     stranger typed into a form on the internet. It is escaped for the same
 *     reason, and only an ALLOWLIST of names resolves at all - an unknown
 *     `{{user.passwordHash}}` must render as nothing rather than reaching into
 *     whatever object the renderer was handed.
 */

/** Every variable a customer template may reference. Nothing else resolves. */
export const TEMPLATE_VARIABLES = [
  'contact.name',
  'contact.email',
  'contact.phone',
  'contact.company',
  'submission.message',
  'submission.pageUrl',
  'submission.domain',
  'submission.submittedAt',
  'widget.name',
  'workspace.name',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export type TemplateValues = Partial<Record<TemplateVariable, string>>;

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ALLOWED = new Set<string>(TEMPLATE_VARIABLES);

/** Which placeholders in a template are not on the allowlist. */
export function unknownVariables(template: string): readonly string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name !== undefined && !ALLOWED.has(name)) found.add(name);
  }
  return [...found].sort();
}

/**
 * Render a customer template.
 *
 * `escape` decides whether the OUTPUT is HTML. The plain-text part of an email
 * must not be escaped or a visitor's apostrophe becomes `&#39;` in someone's
 * terminal; the HTML part must be, always.
 *
 * An unknown or missing variable renders as an empty string rather than
 * leaving the raw `{{...}}` in the message: a customer who mistypes a
 * placeholder should get a slightly empty email, not one that leaks the
 * template language at their own leads.
 */
export function renderTemplate(template: string, values: TemplateValues, escape: boolean): string {
  return template.replace(PLACEHOLDER, (_match, rawName: string) => {
    if (!ALLOWED.has(rawName)) return '';
    const value = values[rawName as TemplateVariable] ?? '';
    return escape ? escapeHtml(value) : value;
  });
}

/**
 * Strip anything that looks like markup from customer-supplied text.
 *
 * Belt and braces beside the escaping: blueprint 12.3 says arbitrary HTML is
 * not accepted, so a template containing tags is rejected at SAVE time by the
 * schema, and this is the second line for anything already stored.
 */
export function containsMarkup(value: string): boolean {
  return /<[a-zA-Z/!]/.test(value);
}

/**
 * The built-in notification copy.
 *
 * Lives here, in the domain, because two places need it and they must not
 * disagree: the settings page shows it as the starting point, and the send
 * path uses it for a widget whose settings were never opened. A customer
 * comparing the form to the email they received should see the same words.
 */
export const DEFAULT_NOTIFICATION_TEMPLATE = {
  subject: 'New lead from {{widget.name}}',
  body: [
    'You have a new lead.',
    '',
    'Name: {{contact.name}}',
    'Email: {{contact.email}}',
    '',
    '{{submission.message}}',
  ].join('\n'),
} as const;
