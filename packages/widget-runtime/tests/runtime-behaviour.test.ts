import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSuppressed, markSeen, visitorId } from '../src/cooldown.js';
import { supportsExitIntent } from '../src/triggers.js';
import { buildStyles, hostDeclarations } from '../src/styles.js';
import { isPageTargeted, isSafeDestinationUrl } from '@lcp/contracts/rules';
import type { PublicWidgetConfig } from '@lcp/contracts';

/**
 * Runtime behaviour that does not need a browser (blueprint 18.1: "trigger/
 * cooldown decisions").
 *
 * In Stage 5a these were shapes a schema validated. Here they are decisions
 * that determine whether a real visitor sees a widget, so they are tested as
 * behaviour: does the cooldown suppress, does rotation reissue, does exit
 * intent decline to be faked.
 *
 * The browser half - Shadow DOM, focus, and the triggers actually firing - is
 * covered by the Playwright suite against the real second origin. What is here
 * is what can be checked without one.
 */

/** A minimal Storage, so these run in a Node environment with no DOM. */
class MemoryStorage {
  #map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.#map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, value);
  }
  clear(): void {
    this.#map.clear();
  }
}

const local = new MemoryStorage();
const session = new MemoryStorage();

beforeEach(() => {
  local.clear();
  session.clear();
  vi.stubGlobal('window', {
    localStorage: local,
    sessionStorage: session,
    matchMedia: (query: string) => ({ matches: query.includes('hover: hover') }),
  });
  vi.stubGlobal('crypto', globalThis.crypto);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const DAY = 24 * 60 * 60 * 1000;

describe('pseudonymous visitor identity (blueprint 4.4)', () => {
  it('issues one identifier per widget and keeps it stable', () => {
    const first = visitorId('w_alpha');
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(visitorId('w_alpha')).toBe(first);
  });

  it('does not share an identifier between two widgets on one page', () => {
    // Per-widget is the locked wording; a shared id would link a visitor's
    // behaviour across widgets that have no reason to be correlated.
    expect(visitorId('w_alpha')).not.toBe(visitorId('w_beta'));
  });

  it('rotates every 30 days by reissuing, not by extending', () => {
    const start = Date.UTC(2026, 0, 1);
    const original = visitorId('w_alpha', start);

    expect(visitorId('w_alpha', start + 29 * DAY)).toBe(original);

    const rotated = visitorId('w_alpha', start + 31 * DAY);
    expect(rotated).not.toBe(original);
    // And the new one stays put until ITS window ends.
    expect(visitorId('w_alpha', start + 32 * DAY)).toBe(rotated);
  });

  it('still returns an identifier when storage refuses to work', () => {
    // Private modes and locked-down host pages throw on access. A widget that
    // cannot remember must still render.
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      },
      sessionStorage: session,
    });
    expect(visitorId('w_alpha')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('repeat-appearance cooldown (blueprint 4.4)', () => {
  it('suppresses for the rest of the session once seen', () => {
    const cooldown = { kind: 'session' } as const;
    expect(isSuppressed('w_alpha', cooldown)).toBe(false);

    markSeen('w_alpha', cooldown);
    expect(isSuppressed('w_alpha', cooldown)).toBe(true);

    // Session state does not outlive the session, so a fresh one shows again.
    session.clear();
    expect(isSuppressed('w_alpha', cooldown)).toBe(false);
  });

  it('suppresses for the configured number of days, then shows again', () => {
    const cooldown = { kind: 'days', days: 7 } as const;
    const shown = Date.UTC(2026, 0, 1);

    markSeen('w_alpha', cooldown, shown);
    expect(isSuppressed('w_alpha', cooldown, shown + 6 * DAY)).toBe(true);
    expect(isSuppressed('w_alpha', cooldown, shown + 8 * DAY)).toBe(false);
  });

  it('keeps two widgets on one page independent', () => {
    const cooldown = { kind: 'session' } as const;
    markSeen('w_alpha', cooldown);
    expect(isSuppressed('w_beta', cooldown)).toBe(false);
  });

  it('shows the widget when storage is unreadable, rather than hiding it', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => undefined,
      },
      sessionStorage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => undefined,
      },
    });
    expect(isSuppressed('w_alpha', { kind: 'session' })).toBe(false);
    expect(isSuppressed('w_alpha', { kind: 'days', days: 7 })).toBe(false);
  });
});

describe('exit intent degrades rather than pretending (blueprint 4.4)', () => {
  it('is available where a pointer can hover', () => {
    expect(supportsExitIntent()).toBe(true);
  });

  it('is unavailable on a touch device, and is not simulated', () => {
    vi.stubGlobal('window', {
      localStorage: local,
      sessionStorage: session,
      matchMedia: () => ({ matches: false }),
    });
    expect(supportsExitIntent()).toBe(false);
  });

  it('is unavailable when the browser cannot answer the question at all', () => {
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session });
    expect(supportsExitIntent()).toBe(false);
  });
});

describe('page targeting, now executed rather than validated', () => {
  const targeting = {
    includePatterns: ['/pricing', '/blog/**'],
    excludePatterns: ['/blog/secret'],
  };

  it('runs on an included page and stays off everything else', () => {
    expect(isPageTargeted(targeting, '/pricing')).toBe(true);
    expect(isPageTargeted(targeting, '/blog/2026/hello')).toBe(true);
    expect(isPageTargeted(targeting, '/about')).toBe(false);
  });

  it('lets exclude win, and treats an empty include list as everywhere', () => {
    expect(isPageTargeted(targeting, '/blog/secret')).toBe(false);
    expect(isPageTargeted({ includePatterns: [], excludePatterns: [] }, '/anything')).toBe(true);
  });
});

describe('the stylesheet accepts only enumerated values (blueprint 4.3, 17)', () => {
  function configWith(appearance: Partial<PublicWidgetConfig['appearance']>): PublicWidgetConfig {
    return {
      headline: 'Hello',
      body: '',
      submitLabel: 'Send',
      fields: [],
      appearance: {
        primaryColor: '#3d2bd9',
        backgroundColor: '#ffffff',
        textColor: '#14162b',
        fontFamily: 'system',
        fontSize: 'medium',
        spacing: 'regular',
        borderRadius: 'small',
        buttonStyle: 'solid',
        ...appearance,
      },
      formMode: 'inline',
      triggers: [],
      ctaAction: { kind: 'lead_form' },
      success: { kind: 'message', message: 'Thanks' },
      targeting: { includePatterns: [], excludePatterns: [], cooldown: { kind: 'session' } },
    } as PublicWidgetConfig;
  }

  it('emits a validated colour', () => {
    expect(buildStyles(configWith({ primaryColor: '#ff0000' }))).toContain('#ff0000');
  });

  it('refuses a colour carrying CSS rather than interpolating it', () => {
    // If the server ever regressed, a colour is where CSS injection would
    // arrive. The stylesheet falls back instead of emitting the payload.
    const styles = buildStyles(
      configWith({ primaryColor: 'red; } body { display: none } .x {' as never }),
    );
    expect(styles).not.toContain('display: none');
    expect(styles).toContain('#3d2bd9');
  });

  it('resets inherited properties so a host page cannot deform the widget', () => {
    const styles = buildStyles(configWith({}));
    expect(styles).toContain('all: initial');
    expect(styles).toContain('box-sizing: border-box');
  });

  it('puts the widget FONT back after the reset, and makes both important', () => {
    /**
     * The Stage 12b defect, in the one place a unit test can see it.
     *
     * `all: initial` resets the font to the browser's default, so every widget
     * in the product rendered in Times New Roman whatever its creator chose.
     * The declarations that must survive come after the reset, where they win
     * on order.
     *
     * `!important` on both is what lets this live in the stylesheet at all: for
     * the host element a normal rule in the OUTER document outranks a normal
     * `:host` rule, so only an important declaration from inside the shadow
     * tree holds. It also means no inline style is needed, which is what makes
     * the widget installable on a page with a strict Content Security Policy -
     * proven end to end by the sandbox's own browser tests.
     */
    const styles = buildStyles(configWith({ fontFamily: 'mono' as never }));
    const host = styles.slice(styles.indexOf(':host'), styles.indexOf('}'));

    expect(host).toContain('all: initial !important');
    expect(host).toMatch(/font-family: [^;]*monospace[^;]*!important/);
    // Order is the whole mechanism: a reset AFTER the font would undo it.
    expect(host.indexOf('all: initial')).toBeLessThan(host.indexOf('font-family'));
  });

  it('never needs an inline style, so a strict style-src cannot break it', () => {
    // `hostDeclarations` is the single source for both the `:host` block and
    // anything that might apply the same values another way. Every property the
    // host depends on has to be in the stylesheet.
    const styles = buildStyles(configWith({}));
    for (const [property] of hostDeclarations(configWith({}))) {
      expect(styles, property).toContain(`${property}:`);
    }
  });
});

describe('CTA destinations are re-checked in the browser too', () => {
  it('accepts http and https and refuses script-bearing schemes', () => {
    expect(isSafeDestinationUrl('https://example.com/book')).toBe(true);
    expect(isSafeDestinationUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeDestinationUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });
});
