import { isPageTargeted, pathFromUrl } from '@lcp/contracts/rules';
import type { PublicWidgetResponse } from '@lcp/contracts';
import { buildStyles } from './styles.js';
import { collectFocusable, renderWidget, type SubmitOutcome } from './render.js';
import { isSuppressed, markSeen, visitorId } from './cooldown.js';
import { wireTriggers } from './triggers.js';
import { WidgetAnalytics } from './analytics.js';

/**
 * One widget instance: its Shadow root, its state, and its cleanup
 * (blueprint 8.1).
 *
 * Display mode decides almost everything about how this behaves:
 *
 *   inline    part of the page, always visible, no triggers, no focus moves
 *   modal     overlays the page, traps focus, Escape closes
 *   floating  a corner popover, dismissible, does not trap
 *
 * The focus rules are the part worth reading. Content that appears because the
 * VISITOR asked for it may take focus; content that appears on a timer or a
 * scroll position must not, because moving focus under someone mid-task is
 * hostile and WCAG 3.2.1 exists for that reason. So a click-opened modal
 * receives focus and a delay-opened floating popover does not - it announces
 * itself politely instead and waits to be tabbed into.
 */

export interface InstanceOptions {
  readonly response: PublicWidgetResponse;
  /** The script tag this widget was declared by, for inline placement. */
  readonly anchor: Element | null;
  /** Where funnel events are posted. Same origin the config came from. */
  readonly apiBase: string;
}

type Mode = 'inline' | 'modal' | 'floating';

function modeFor(response: PublicWidgetResponse): Mode {
  // Blueprint 4.4 locks the CTA popover to a floating popover regardless of
  // the form-mode setting, which only applies to the two form types.
  if (response.type === 'cta_popover') return 'floating';
  return response.config.formMode === 'modal' ? 'modal' : 'inline';
}

export class WidgetInstance {
  readonly #response: PublicWidgetResponse;
  readonly #mode: Mode;
  readonly #anchor: Element | null;

  #host: HTMLElement | null = null;
  #shadow: ShadowRoot | null = null;
  #open = false;
  #openedByVisitor = false;
  #previousFocus: Element | null = null;
  #unwireTriggers: (() => void) | null = null;
  #keydown: ((event: KeyboardEvent) => void) | null = null;
  readonly #analytics: WidgetAnalytics;
  readonly #options: InstanceOptions;

  /**
   * When this form appeared, and the key that identifies its submission.
   *
   * Both are set at RENDER time and reused for the life of that rendered form.
   * The timestamp is what the server's timing heuristic measures against, and
   * the key is what makes a double-click one lead rather than two. Both are
   * regenerated when the widget is rendered again, because that is a new form
   * and a genuinely new submission.
   */
  #renderedAt = Date.now();
  #idempotencyKey = newKey();

  constructor(options: InstanceOptions) {
    this.#options = options;
    this.#response = options.response;
    this.#mode = modeFor(options.response);
    this.#anchor = options.anchor;
    this.#analytics = new WidgetAnalytics({
      publicId: options.response.publicId,
      apiBase: options.apiBase,
    });
  }

  get publicId(): string {
    return this.#response.publicId;
  }

  /**
   * Decide whether this widget belongs on this page and, if so, start it.
   *
   * Returns false when targeting or cooldown rules out this page, so a caller
   * can tell "not shown" from "failed".
   */
  start(): boolean {
    const { config } = this.#response;

    /**
     * Blueprint 7.2 step 7: the runtime evaluates include/exclude patterns.
     *
     * It has to happen here rather than on the server, because one cached
     * config answer is shared by every page on the site - the server does not
     * know which page this is.
     */
    const path = pathFromUrl(window.location.href);
    if (path === null) return false;
    if (!isPageTargeted(config.targeting, path)) return false;

    // Inline widgets are part of the page, so a cooldown that hides them would
    // leave a hole in the layout. Cooldown governs interruptions.
    if (this.#mode !== 'inline' && isSuppressed(this.publicId, config.targeting.cooldown)) {
      return false;
    }

    // Establishes the pseudonymous identifier on first sight (blueprint 4.4).
    visitorId(this.publicId);

    /**
     * The impression, recorded once targeting and cooldown have both said yes.
     *
     * Deliberately here rather than at the top of `start`: a widget suppressed
     * by cooldown or excluded by a page rule was never shown, and counting it
     * would put impressions in the denominator that no visitor ever saw.
     */
    this.#analytics.record('impression');

    if (this.#mode === 'inline') {
      this.open(false);
      return true;
    }

    this.#unwireTriggers = wireTriggers(config.triggers, {
      publicId: this.publicId,
      open: () => this.open(false),
    });

    // A click on a host-page trigger is the visitor asking, so that path opens
    // with focus. `wireTriggers` cannot tell us which trigger fired, so the
    // click case is wired separately for exactly that distinction.
    if (config.triggers.some((trigger) => trigger.type === 'click')) {
      const selector = `[data-lcp-widget-open="${CSS.escape(this.publicId)}"]`;
      const handler = (event: Event): void => {
        const target = event.target;
        if (target instanceof Element && target.closest(selector) !== null) {
          this.#openedByVisitor = true;
        }
      };
      // Capture phase, so this runs before the delegated open handler.
      document.addEventListener('click', handler, true);
      const previous = this.#unwireTriggers;
      this.#unwireTriggers = (): void => {
        previous?.();
        document.removeEventListener('click', handler, true);
      };
    }

    return true;
  }

  open(force: boolean): void {
    if (this.#open && !force) return;
    this.#open = true;
    /**
     * Only a widget that CAN be closed can meaningfully be opened. An inline
     * form calls `open` once as part of mounting, and counting that as an open
     * would report every inline widget at a 100% open rate.
     */
    if (this.#mode !== 'inline') this.#analytics.record('open');

    const host = document.createElement('div');
    host.setAttribute('data-lcp-widget', this.publicId);
    // A host page's `div { margin: 2rem }` must not move a fixed overlay.
    host.style.setProperty('all', 'initial');

    /**
     * An OPEN shadow root, not closed.
     *
     * Closed would hide the root from the host page's script, but it hides
     * nothing from a determined one - and CSS isolation, which is the property
     * that actually matters here, is identical either way. Open keeps the
     * widget inspectable by the site owner who installed it and testable from
     * the outside, which is worth more than the appearance of secrecy.
     */
    this.#renderedAt = Date.now();
    this.#idempotencyKey = newKey();

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = buildStyles(this.#response.config);
    shadow.append(style);

    const rendered = renderWidget({
      response: this.#response,
      dismissible: this.#mode !== 'inline',
      onClose: () => this.close(),
      onSubmit: async (values) => {
        /**
         * The submission, posted to the Stage 7 endpoint.
         *
         * The funnel event is recorded first and unconditionally: "the visitor
         * completed the form" is a stage they reached whether or not the post
         * then succeeds, and counting only successes would quietly hide a
         * broken integration behind a healthy-looking funnel.
         */
        this.#analytics.record('submission');
        return this.#send(values);
      },
      onFormStart: () => this.#analytics.record('form_start'),
      onCtaClick: () => this.#analytics.record('cta_click'),
    });

    if (this.#mode === 'inline') {
      shadow.append(rendered.panel);
      this.#anchor?.parentNode?.insertBefore(host, this.#anchor);
      if (this.#anchor === null) document.body.append(host);
    } else {
      const container = document.createElement('div');
      container.className = this.#mode === 'modal' ? 'backdrop' : 'floating';
      container.setAttribute('role', 'dialog');
      container.setAttribute('aria-labelledby', `lcp-${this.publicId}-headline`);
      // Only a modal traps; a corner popover leaves the page usable.
      container.setAttribute('aria-modal', this.#mode === 'modal' ? 'true' : 'false');
      container.append(rendered.panel);
      shadow.append(container);
      document.body.append(host);

      if (this.#mode === 'modal') {
        // A backdrop click is a conventional dismissal, but only on the
        // backdrop itself - not on a click that happened to bubble from inside.
        container.addEventListener('click', (event) => {
          if (event.target === container) this.close();
        });
      }
    }

    this.#host = host;
    this.#shadow = shadow;

    if (this.#mode !== 'inline') {
      markSeen(this.publicId, this.#response.config.targeting.cooldown);
      this.#bindKeyboard(rendered.focusable);
      this.#takeFocus(rendered.focusable);
    }
  }

  /**
   * Post one submission (blueprint 7.3).
   *
   * Three details are the server's contract rather than this runtime's taste:
   *
   * `idempotencyKey` is generated here and reused for the life of this rendered
   * form, so a visitor who double-clicks, or whose connection retries, creates
   * one lead rather than two. It is regenerated only when the form is rendered
   * again.
   *
   * `renderedAt` is when the form appeared, not when Send was pressed. The
   * server's timing heuristic uses the gap between the two to tell a person
   * from a script, and sending the click time would defeat it.
   *
   * The outcome comes back from the server unaltered. The success wording is
   * the workspace's own configuration and a rejection names its own fields;
   * inventing either here would give the runtime a second opinion about a
   * schema only the server owns.
   */
  async #send(values: Record<string, string>): Promise<SubmitOutcome> {
    const base = this.#options.apiBase.replace(/\/+$/, '');
    const url = `${base}/widget/v1/submit/${encodeURIComponent(this.#response.publicId)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        credentials: 'omit',
        mode: 'cors',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: this.#idempotencyKey,
          values,
          pageUrl: window.location.href,
          referrer: document.referrer === '' ? undefined : document.referrer,
          renderedAt: this.#renderedAt,
        }),
      });
    } catch {
      return { kind: 'error', message: 'That did not send. Check your connection and try again.' };
    }

    if (response.status === 202) {
      const body = (await response.json().catch(() => null)) as {
        outcome?: { kind?: string; message?: string; url?: string };
      } | null;
      const outcome = body?.outcome;
      if (outcome?.kind === 'redirect' && typeof outcome.url === 'string') {
        return { kind: 'redirect', url: outcome.url };
      }
      return {
        kind: 'message',
        message: outcome?.message ?? 'Thank you. Your message has been sent.',
      };
    }

    const failure = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    return {
      kind: 'error',
      message: failure?.error?.message ?? 'That could not be sent. Please try again.',
    };
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;

    if (this.#keydown !== null) {
      document.removeEventListener('keydown', this.#keydown, true);
      this.#keydown = null;
    }

    this.#host?.remove();
    this.#host = null;
    this.#shadow = null;

    // Return focus where the visitor left it, but only if we took it.
    if (this.#previousFocus instanceof HTMLElement) {
      this.#previousFocus.focus();
      this.#previousFocus = null;
    }
    this.#openedByVisitor = false;
  }

  /** Remove the widget and every listener it installed (blueprint 8.1). */
  destroy(): void {
    this.close();
    this.#unwireTriggers?.();
    this.#unwireTriggers = null;
    // Flushes anything still queued, so a widget removed by the host page does
    // not take its unsent funnel events with it.
    this.#analytics.dispose();
  }

  #bindKeyboard(focusable: () => HTMLElement[]): void {
    const handler = (event: KeyboardEvent): void => {
      if (!this.#open) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        return;
      }

      // Only a modal traps Tab; a floating popover must let the visitor tab
      // straight back out into the page.
      if (event.key !== 'Tab' || this.#mode !== 'modal') return;

      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;

      const active = this.#shadow?.activeElement ?? null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Capture, because the host page may stop propagation on its own handlers.
    document.addEventListener('keydown', handler, true);
    this.#keydown = handler;
  }

  #takeFocus(focusable: () => HTMLElement[]): void {
    /**
     * Focus moves only when the visitor asked for this, or when the mode traps.
     *
     * A modal already prevents interaction with the page, so leaving focus
     * outside it would be worse than moving it. A floating popover that
     * appeared on a timer takes nothing and is announced politely instead.
     */
    const shouldFocus = this.#openedByVisitor || this.#mode === 'modal';
    if (!shouldFocus) {
      const live = document.createElement('p');
      live.className = 'sr-only';
      live.setAttribute('role', 'status');
      live.textContent = this.#response.config.headline;
      this.#shadow?.append(live);
      return;
    }

    this.#previousFocus = document.activeElement;
    const target = focusable()[0] ?? null;
    target?.focus();
  }

  /** Exposed for tests and for the registry's own bookkeeping. */
  get isOpen(): boolean {
    return this.#open;
  }

  get shadowRoot(): ShadowRoot | null {
    return this.#shadow;
  }

  static focusableIn(root: ParentNode): HTMLElement[] {
    return collectFocusable(root);
  }
}

/**
 * A submission key that is unique per rendered form.
 *
 * `crypto.randomUUID` where it exists, which is everywhere this runtime
 * supports; the fallback keeps an older browser working rather than sending a
 * constant, which would make every submission from that browser collide with
 * the first one and silently discard them.
 */
function newKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid !== undefined) return uuid;
  return `k-${String(Date.now())}-${Math.random().toString(36).slice(2, 12)}`;
}
