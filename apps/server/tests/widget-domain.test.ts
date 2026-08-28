import { describe, expect, it } from 'vitest';
import {
  WIDGET_FIELD_MAX_LENGTH,
  widgetConfigSchema,
  type WidgetConfig,
  type WidgetType,
} from '@lcp/contracts';
import { defaultConfigFor } from '../src/domain/widget/defaults.js';
import {
  collectsSubmissions,
  mandatoryFieldsFor,
  validateConfig,
} from '../src/domain/widget/fields.js';
import {
  domainEntryMatches,
  isHostAllowed,
  isOriginAllowed,
} from '../src/domain/widget/domains.js';
import {
  compilePagePattern,
  isPageTargeted,
  matchesPattern,
  pathFromUrl,
} from '../src/domain/widget/page-patterns.js';
import { checkDestinationUrl, isSafeDestinationUrl } from '../src/domain/widget/urls.js';
import { canPublish, publishBlockers } from '../src/domain/widget/publishing.js';
import { embedSnippet, generatePublicId, isPublicIdShape } from '../src/domain/widget/snippet.js';

/**
 * Pure widget rules (blueprint 18.1: "widget field and revision rules", "host
 * and wildcard matching", "URL include/exclude matching", "trigger/cooldown
 * decisions", "payload and field validation").
 *
 * None of this needs a database, a request, or a server, which is the point:
 * these are the rules Stages 6 and 7 will lean on when a real visitor's browser
 * is involved and a mistake is expensive.
 */

/** A config that is valid for its type, so each test changes exactly one thing. */
function configFor(type: WidgetType): WidgetConfig {
  const config = defaultConfigFor(type);
  return {
    ...config,
    targeting: { ...config.targeting, allowedDomains: ['example.com'] },
  };
}

function fieldsOf(config: WidgetConfig, types: readonly string[]): WidgetConfig {
  return {
    ...config,
    fields: types.map((type, index) => ({
      type: type as WidgetConfig['fields'][number]['type'],
      label: type,
      placeholder: '',
      helpText: '',
      required: type === 'email' || type === 'message',
      maxLength: 100,
      order: index,
    })),
  };
}

// ---------------------------------------------------------------------------

describe('widget defaults', () => {
  it('produces a configuration that is already valid for every type', () => {
    for (const type of ['contact_form', 'email_signup', 'cta_popover'] as const) {
      expect(validateConfig(type, defaultConfigFor(type)), type).toEqual([]);
    }
  });

  it('does not make a new widget publishable, because it has no allowed domain', () => {
    // Blueprint 4.4: at least one allowed domain is required before publishing,
    // and only the creator knows which.
    for (const type of ['contact_form', 'email_signup', 'cta_popover'] as const) {
      expect(canPublish(type, defaultConfigFor(type)), type).toBe(false);
    }
  });
});

describe('mandatory fields (blueprint 4.3)', () => {
  it('keeps email and message on a contact form', () => {
    const config = configFor('contact_form');
    expect(mandatoryFieldsFor('contact_form', config)).toEqual(['email', 'message']);

    const withoutMessage = fieldsOf(config, ['name', 'email']);
    const errors = validateConfig('contact_form', withoutMessage);
    expect(errors.map((error) => error.message).join(' ')).toContain('message');
  });

  it('keeps email on an email signup form', () => {
    const config = configFor('email_signup');
    expect(mandatoryFieldsFor('email_signup', config)).toEqual(['email']);

    const withoutEmail = fieldsOf(config, ['name']);
    expect(validateConfig('email_signup', withoutEmail)).not.toEqual([]);
  });

  it('requires email on a CTA popover ONLY when its lead form is enabled', () => {
    const withForm = configFor('cta_popover');
    expect(mandatoryFieldsFor('cta_popover', withForm)).toEqual(['email']);

    const linkOnly: WidgetConfig = {
      ...withForm,
      ctaAction: { kind: 'external_url', url: 'https://example.com/book' },
    };
    // A popover that just links out collects nothing, so no field is mandatory.
    expect(mandatoryFieldsFor('cta_popover', linkOnly)).toEqual([]);
    expect(collectsSubmissions('cta_popover', linkOnly)).toBe(false);
    expect(validateConfig('cta_popover', { ...linkOnly, fields: [] })).toEqual([]);
  });

  it('refuses to let a mandatory field be made optional', () => {
    const config = configFor('email_signup');
    const optionalEmail: WidgetConfig = {
      ...config,
      fields: config.fields.map((field) => ({ ...field, required: false })),
    };
    const errors = validateConfig('email_signup', optionalEmail);
    expect(errors.map((error) => error.message).join(' ')).toContain('cannot be made optional');
  });

  it('rejects the same field type twice, and two fields in the same position', () => {
    const config = configFor('contact_form');
    const duplicated = fieldsOf(config, ['email', 'message', 'email']);
    expect(
      validateConfig('contact_form', duplicated).some((e) => e.message.includes('already has')),
    ).toBe(true);

    const sameOrder: WidgetConfig = {
      ...config,
      fields: config.fields.map((field) => ({ ...field, order: 0 })),
    };
    expect(
      validateConfig('contact_form', sameOrder).some((e) => e.message.includes('same position')),
    ).toBe(true);
  });
});

describe('configuration coherence', () => {
  it('only lets a CTA popover link to an external address', () => {
    const config: WidgetConfig = {
      ...configFor('contact_form'),
      ctaAction: { kind: 'external_url', url: 'https://example.com' },
    };
    expect(validateConfig('contact_form', config).some((e) => e.path === 'config.ctaAction')).toBe(
      true,
    );
  });

  it('rejects a modal or popover with no trigger, since nothing could open it', () => {
    const modal: WidgetConfig = { ...configFor('contact_form'), formMode: 'modal', triggers: [] };
    expect(validateConfig('contact_form', modal).some((e) => e.path === 'config.triggers')).toBe(
      true,
    );

    const popover: WidgetConfig = { ...configFor('cta_popover'), triggers: [] };
    expect(validateConfig('cta_popover', popover).some((e) => e.path === 'config.triggers')).toBe(
      true,
    );
  });

  it('rejects the same trigger added twice', () => {
    const config: WidgetConfig = {
      ...configFor('contact_form'),
      formMode: 'modal',
      triggers: [{ type: 'click' }, { type: 'click' }],
    };
    expect(validateConfig('contact_form', config).some((e) => e.path === 'config.triggers')).toBe(
      true,
    );
  });

  it('keeps a CTA popover as a floating popover, never a modal (blueprint 4.4)', () => {
    const config: WidgetConfig = { ...configFor('cta_popover'), formMode: 'modal' };
    expect(validateConfig('cta_popover', config).some((e) => e.path === 'config.formMode')).toBe(
      true,
    );
  });
});

describe('payload and field validation (schema bounds)', () => {
  it('caps a field maximum at the same 5,000 characters submissions allow', () => {
    // Blueprint 7.3 rejects long-text values above 5,000 characters, so a
    // larger configured maximum would build a form the server would refuse.
    expect(WIDGET_FIELD_MAX_LENGTH).toBe(5000);

    const config = configFor('contact_form');
    const tooLong = {
      ...config,
      fields: config.fields.map((field) => ({ ...field, maxLength: WIDGET_FIELD_MAX_LENGTH + 1 })),
    };
    expect(widgetConfigSchema.safeParse(tooLong).success).toBe(false);
    expect(widgetConfigSchema.safeParse(config).success).toBe(true);
  });

  it('refuses anything that is not an enumerated appearance value', () => {
    const config = configFor('contact_form');

    // No free-form style is representable: the colour must be a hex triple and
    // every other property is an enum (blueprint 4.3, 17).
    const injected = {
      ...config,
      appearance: {
        ...config.appearance,
        primaryColor: 'red; background: url(javascript:alert(1))',
      },
    };
    expect(widgetConfigSchema.safeParse(injected).success).toBe(false);

    const badEnum = { ...config, appearance: { ...config.appearance, buttonStyle: 'custom' } };
    expect(widgetConfigSchema.safeParse(badEnum).success).toBe(false);
  });

  it('rejects an unknown field type and an unknown trigger type', () => {
    const config = configFor('contact_form');
    expect(
      widgetConfigSchema.safeParse({ ...config, fields: [{ ...config.fields[0], type: 'ssn' }] })
        .success,
    ).toBe(false);
    expect(
      widgetConfigSchema.safeParse({ ...config, triggers: [{ type: 'on_rage_quit' }] }).success,
    ).toBe(false);
  });

  it('bounds the cooldown and the scroll trigger', () => {
    const config = configFor('contact_form');
    expect(
      widgetConfigSchema.safeParse({
        ...config,
        targeting: { ...config.targeting, cooldown: { kind: 'days', days: 0 } },
      }).success,
    ).toBe(false);
    expect(
      widgetConfigSchema.safeParse({
        ...config,
        formMode: 'modal',
        triggers: [{ type: 'scroll_depth', percent: 101 }],
      }).success,
    ).toBe(false);
    expect(
      widgetConfigSchema.safeParse({
        ...config,
        formMode: 'modal',
        triggers: [{ type: 'scroll_depth', percent: 50 }],
      }).success,
    ).toBe(true);
  });
});

describe('host and wildcard matching (blueprint 4.4)', () => {
  it('matches an exact host, case-insensitively', () => {
    expect(domainEntryMatches('example.com', 'example.com')).toBe(true);
    expect(domainEntryMatches('Example.COM', 'example.com')).toBe(true);
    expect(domainEntryMatches('example.com', 'other.com')).toBe(false);
  });

  it('does NOT let *.example.com cover example.com', () => {
    // The blueprint states this rule explicitly: "*.example.com does not
    // include example.com; both must be listed when both are allowed".
    expect(domainEntryMatches('*.example.com', 'example.com')).toBe(false);
    expect(domainEntryMatches('*.example.com', 'app.example.com')).toBe(true);
    expect(isHostAllowed(['*.example.com', 'example.com'], 'example.com')).toBe(true);
  });

  it('covers deeper subdomains but never a bare or empty label', () => {
    expect(domainEntryMatches('*.example.com', 'eu.app.example.com')).toBe(true);
    expect(domainEntryMatches('*.example.com', '.example.com')).toBe(false);
  });

  it('does not match a host that merely ends with the same text', () => {
    // `notexample.com` ends with `example.com` as a STRING but is a different
    // domain; matching on suffix alone would hand it access.
    expect(domainEntryMatches('*.example.com', 'evilexample.com')).toBe(false);
    expect(domainEntryMatches('example.com', 'notexample.com')).toBe(false);
  });

  it('tolerates a trailing dot, which is the same host', () => {
    expect(domainEntryMatches('example.com', 'example.com.')).toBe(true);
  });

  it('reads the host out of an Origin, and refuses one it cannot parse', () => {
    expect(isOriginAllowed(['example.com'], 'https://example.com')).toBe(true);
    expect(isOriginAllowed(['example.com'], 'https://example.com:8443')).toBe(true);
    expect(isOriginAllowed(['example.com'], 'not a url')).toBe(false);
    // A non-web scheme is never an allowed origin.
    expect(isOriginAllowed(['example.com'], 'file:///example.com')).toBe(false);
  });
});

describe('page include/exclude matching (blueprint 4.4)', () => {
  it('matches literal paths', () => {
    expect(matchesPattern('/pricing', '/pricing')).toBe(true);
    expect(matchesPattern('/pricing', '/pricing/enterprise')).toBe(false);
  });

  it('treats * as a single path segment and ** as any depth', () => {
    expect(matchesPattern('/blog/*', '/blog/hello')).toBe(true);
    expect(matchesPattern('/blog/*', '/blog/2026/hello')).toBe(false);
    expect(matchesPattern('/blog/**', '/blog/2026/hello')).toBe(true);
  });

  it('treats regular-expression syntax as literal text, never as a pattern', () => {
    // This is the property blueprint 4.4 is asking for when it says "safe glob
    // patterns rather than executable regular expressions".
    expect(matchesPattern('/a.b', '/axb')).toBe(false);
    expect(matchesPattern('/a.b', '/a.b')).toBe(true);
    expect(matchesPattern('/(a|b)', '/a')).toBe(false);
    expect(matchesPattern('/(a|b)', '/(a|b)')).toBe(true);
    expect(matchesPattern('/x+', '/xxx')).toBe(false);
    expect(matchesPattern('/x+', '/x+')).toBe(true);
  });

  it('compiles to an anchored expression with no quantifier a pattern could nest', () => {
    const compiled = compilePagePattern('/blog/**/*.html');
    expect(compiled?.source.startsWith('^')).toBe(true);
    expect(compiled?.source.endsWith('$')).toBe(true);
    // The only quantifiers present are the two the translator introduces.
    expect(compiled?.source).toBe('^\\/blog\\/.*\\/[^/]*\\.html$');
  });

  it('excludes beat includes, and an empty include list means everywhere', () => {
    expect(isPageTargeted({ includePatterns: [], excludePatterns: [] }, '/anything')).toBe(true);
    expect(isPageTargeted({ includePatterns: ['/blog/**'], excludePatterns: [] }, '/pricing')).toBe(
      false,
    );
    expect(
      isPageTargeted(
        { includePatterns: ['/blog/**'], excludePatterns: ['/blog/secret'] },
        '/blog/secret',
      ),
    ).toBe(false);
  });

  it('reads the path and query out of a URL', () => {
    expect(pathFromUrl('https://example.com/pricing?plan=pro')).toBe('/pricing?plan=pro');
    expect(pathFromUrl('javascript:alert(1)')).toBeNull();
    expect(pathFromUrl('nonsense')).toBeNull();
  });
});

describe('CTA and redirect destinations (blueprint 17)', () => {
  it('accepts ordinary web addresses', () => {
    expect(isSafeDestinationUrl('https://example.com/book')).toBe(true);
    expect(isSafeDestinationUrl('http://example.com')).toBe(true);
  });

  it('refuses schemes that would execute in the visitor page', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      expect(isSafeDestinationUrl(url), url).toBe(false);
    }
    expect(checkDestinationUrl('javascript:alert(1)')).toEqual({
      ok: false,
      reason: 'unsupported_scheme',
    });
  });

  it('refuses embedded credentials, which disguise the real destination', () => {
    expect(checkDestinationUrl('https://evil.example.com@bank.example.com/')).toEqual({
      ok: false,
      reason: 'embedded_credentials',
    });
  });

  it('refuses a relative address, which has no base to resolve against', () => {
    expect(checkDestinationUrl('/pricing')).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('publish readiness (blueprint 4.4, 4.5)', () => {
  it('requires at least one allowed domain', () => {
    const config = defaultConfigFor('contact_form');
    const blockers = publishBlockers('contact_form', config);
    expect(blockers.some((error) => error.path === 'config.targeting.allowedDomains')).toBe(true);

    expect(canPublish('contact_form', configFor('contact_form'))).toBe(true);
  });

  it('re-checks the type rules, so a later change cannot be published around', () => {
    // A CTA popover switched to its built-in form newly requires an email
    // field; publishing must notice even though the draft saved fine before.
    const popover = configFor('cta_popover');
    const switched: WidgetConfig = { ...popover, fields: [], ctaAction: { kind: 'lead_form' } };
    expect(canPublish('cta_popover', switched)).toBe(false);
  });
});

describe('public identifiers and the embed snippet (blueprint 7.2, 10.1)', () => {
  it('generates opaque identifiers that do not collide', () => {
    const ids = new Set(Array.from({ length: 500 }, () => generatePublicId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(isPublicIdShape(id)).toBe(true);
  });

  it('avoids characters that are misread when a snippet is retyped', () => {
    const id = generatePublicId().slice(2);
    expect(/[lo01]/.test(id)).toBe(false);
  });

  it('renders one async script tag carrying the public identifier', () => {
    const snippet = embedSnippet('https://app.example.com/', 'w_abcdefghijkmnpqr');
    expect(snippet).toBe(
      '<script async src="https://app.example.com/widget/v1/loader.js" data-widget="w_abcdefghijkmnpqr"></script>',
    );
    // One trailing slash on the base must not become two in the URL.
    expect(snippet).not.toContain('com//');
  });

  it('rejects an identifier that is not the shape we issue', () => {
    expect(isPublicIdShape('w_short')).toBe(false);
    expect(isPublicIdShape('abcdefghijkmnpqr')).toBe(false);
  });
});
