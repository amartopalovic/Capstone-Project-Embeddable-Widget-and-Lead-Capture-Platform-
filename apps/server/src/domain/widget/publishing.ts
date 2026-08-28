import type { ApiFieldError, WidgetConfig, WidgetType } from '@lcp/contracts';
import { validateConfig } from './fields.js';

/**
 * Publish-readiness rules (blueprint 4.4, 4.5).
 *
 * Publishing is stricter than saving a draft, on purpose. A draft is
 * work-in-progress and a creator must be able to save a half-finished widget;
 * a published widget is live on someone else's website, so the rules that only
 * matter once real visitors see it are checked here rather than blocking every
 * save.
 *
 * The one rule the blueprint states in exactly these terms: "Allowed domains |
 * At least one is required before publishing" (4.4).
 */
export function publishBlockers(type: WidgetType, config: WidgetConfig): readonly ApiFieldError[] {
  const errors: ApiFieldError[] = [...validateConfig(type, config)];

  if (config.targeting.allowedDomains.length === 0) {
    errors.push({
      path: 'config.targeting.allowedDomains',
      message: 'Add at least one allowed domain before publishing',
    });
  }

  return errors;
}

export function canPublish(type: WidgetType, config: WidgetConfig): boolean {
  return publishBlockers(type, config).length === 0;
}
