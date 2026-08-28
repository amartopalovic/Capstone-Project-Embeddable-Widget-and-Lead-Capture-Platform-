import {
  MANDATORY_FIELDS,
  type ApiFieldError,
  type WidgetConfig,
  type WidgetFieldType,
  type WidgetType,
} from '@lcp/contracts';
import { checkDestinationUrl, describeUrlRejection } from './urls.js';

/**
 * Field-schema and configuration rules (blueprint 4.3, 4.4).
 *
 * The Zod schema in `packages/contracts` checks SHAPE - that a field has a
 * known type, a label within bounds, an integer order. These are the rules that
 * shape alone cannot express: which fields a given widget type may not lose,
 * that a field type appears at most once, and that the settings a type does not
 * use are not contradictory.
 *
 * Everything here returns field errors rather than throwing, so a bad
 * configuration becomes a 400 listing every problem at once instead of a 500 or
 * a game of whack-a-mole.
 */

/**
 * Fields this widget type may never lose.
 *
 * The CTA popover is the conditional case in blueprint 4.3: email is mandatory
 * only "when lead capture is enabled", which is a property of the CTA action
 * rather than of the type, so it cannot live in the static table.
 */
export function mandatoryFieldsFor(
  type: WidgetType,
  config: WidgetConfig,
): readonly WidgetFieldType[] {
  const base = MANDATORY_FIELDS[type];
  if (type === 'cta_popover' && config.ctaAction.kind === 'lead_form') {
    return ['email'];
  }
  return base;
}

/**
 * Whether this widget type collects anything at all.
 *
 * A CTA popover pointing at an external URL is a button, not a form, so field
 * and submit-label rules do not apply to it.
 */
export function collectsSubmissions(type: WidgetType, config: WidgetConfig): boolean {
  if (type !== 'cta_popover') return true;
  return config.ctaAction.kind === 'lead_form';
}

/**
 * Validate a whole configuration for one widget type.
 *
 * Called on every draft write AND again before publish. Re-validating at
 * publish is deliberate: a draft may have been written when the type's rules
 * were satisfied differently - for instance a CTA popover whose action was
 * later switched to the built-in form, which newly requires an email field.
 */
export function validateConfig(type: WidgetType, config: WidgetConfig): readonly ApiFieldError[] {
  const errors: ApiFieldError[] = [];

  const seen = new Set<WidgetFieldType>();
  config.fields.forEach((field, index) => {
    if (seen.has(field.type)) {
      errors.push({
        path: `config.fields[${String(index)}].type`,
        message: `This form already has a ${field.type} field`,
      });
    }
    seen.add(field.type);
  });

  const orders = new Set<number>();
  config.fields.forEach((field, index) => {
    if (orders.has(field.order)) {
      errors.push({
        path: `config.fields[${String(index)}].order`,
        message: 'Two fields cannot share the same position',
      });
    }
    orders.add(field.order);
  });

  if (collectsSubmissions(type, config)) {
    for (const required of mandatoryFieldsFor(type, config)) {
      if (!seen.has(required)) {
        errors.push({
          path: 'config.fields',
          message: `A ${labelForType(type)} must keep its ${required} field`,
        });
      }
    }

    // A mandatory field that is present but optional is the same hole by a
    // different route, so the rule covers both.
    for (const required of mandatoryFieldsFor(type, config)) {
      const field = config.fields.find((candidate) => candidate.type === required);
      if (field !== undefined && !field.required) {
        errors.push({
          path: 'config.fields',
          message: `The ${required} field cannot be made optional on a ${labelForType(type)}`,
        });
      }
    }

    if (config.fields.length === 0) {
      errors.push({ path: 'config.fields', message: 'Add at least one field' });
    }
  }

  // A consent checkbox that is not required collects nothing meaningful, but
  // that is a judgement for the creator; only the mandatory rules are enforced.

  if (config.ctaAction.kind === 'external_url') {
    if (type !== 'cta_popover') {
      errors.push({
        path: 'config.ctaAction',
        message: 'Only a CTA popover can link to an external address',
      });
    }
    const check = checkDestinationUrl(config.ctaAction.url);
    if (!check.ok) {
      errors.push({ path: 'config.ctaAction.url', message: describeUrlRejection(check.reason) });
    }
  }

  if (config.success.kind === 'redirect') {
    const check = checkDestinationUrl(config.success.url);
    if (!check.ok) {
      errors.push({ path: 'config.success.url', message: describeUrlRejection(check.reason) });
    }
  }

  // Blueprint 4.4 locks the CTA popover to a floating popover; inline/modal is
  // a form-mode concept and saying otherwise would be a contradiction stored
  // in the record.
  if (type === 'cta_popover' && config.formMode !== 'inline') {
    errors.push({
      path: 'config.formMode',
      message: 'A CTA popover always opens as a floating popover',
    });
  }

  const triggerTypes = new Set(config.triggers.map((trigger) => trigger.type));
  if (triggerTypes.size !== config.triggers.length) {
    errors.push({ path: 'config.triggers', message: 'Each trigger can only be added once' });
  }

  // An inline form is part of the page and is not "opened", so a trigger on it
  // would never fire. A modal or popover with no trigger can never open.
  if (config.formMode === 'modal' || type === 'cta_popover') {
    if (config.triggers.length === 0) {
      errors.push({
        path: 'config.triggers',
        message: 'Add at least one trigger, or nothing will open this widget',
      });
    }
  }

  return errors;
}

function labelForType(type: WidgetType): string {
  switch (type) {
    case 'contact_form':
      return 'contact form';
    case 'email_signup':
      return 'email signup form';
    case 'cta_popover':
      return 'CTA popover';
  }
}
