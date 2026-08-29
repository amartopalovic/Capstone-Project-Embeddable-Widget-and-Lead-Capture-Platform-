import type { InteractionEventValue } from '@lcp/contracts';

/**
 * Funnel instrumentation (blueprint 4.9, 13.2).
 *
 * Three rules govern everything here, and they all come from the same place:
 * this code runs on somebody else's website, and telemetry is the least
 * important thing on that page.
 *
 *  1. **Best effort.** Every failure is swallowed. A blocked request, an
 *     offline visitor, a content blocker eating the endpoint - none of it may
 *     surface to the host page or interrupt the widget. A lead capture tool
 *     that breaks because its analytics failed has its priorities backwards.
 *  2. **Batched.** Events cluster: an impression and an open arrive within
 *     milliseconds of each other, and a form start follows a moment later.
 *     Sending each one immediately would mean four requests where one will do.
 *  3. **Flushed on the way out.** A visitor who submits and closes the tab must
 *     not lose the event that says so, which is what `sendBeacon` exists for.
 */

/** How long to wait for more events before sending (milliseconds). */
const BATCH_WINDOW_MS = 1_000;

/** Matches EVENT_MAX_BATCH on the server; a fuller batch is split. */
const MAX_BATCH = 20;

export interface AnalyticsOptions {
  readonly publicId: string;
  readonly apiBase: string;
}

interface QueuedEvent {
  readonly type: InteractionEventValue;
  readonly pageUrl: string;
  readonly observedAt: number;
}

export class WidgetAnalytics {
  readonly #options: AnalyticsOptions;
  readonly #queue: QueuedEvent[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;

  /**
   * Types already recorded for this instance.
   *
   * The funnel counts a visitor reaching a STAGE, not how many times they
   * touched it. Without this, typing in three fields would report three form
   * starts and make the form-start rate exceed 100% - a metric that can be
   * greater than one is a metric nobody trusts.
   */
  readonly #once = new Set<InteractionEventValue>();

  constructor(options: AnalyticsOptions) {
    this.#options = options;

    /**
     * Flush when the page goes away.
     *
     * `visibilitychange` rather than `unload`: browsers have been retiring
     * `unload` for years and it never fired reliably on mobile, where a tab is
     * backgrounded rather than closed. `pagehide` covers the bfcache case.
     */
    if (typeof document !== 'undefined') {
      const flush = (): void => {
        if (document.visibilityState === 'hidden') this.#send(true);
      };
      document.addEventListener('visibilitychange', flush);
      window.addEventListener('pagehide', () => this.#send(true));
    }
  }

  /** Record a funnel event. Safe to call more than once per type. */
  record(type: InteractionEventValue): void {
    if (this.#disposed) return;
    if (this.#once.has(type)) return;
    this.#once.add(type);

    this.#queue.push({
      type,
      pageUrl: typeof location === 'undefined' ? '' : location.href,
      observedAt: Date.now(),
    });

    if (this.#queue.length >= MAX_BATCH) {
      this.#send(false);
      return;
    }
    if (this.#timer === null) {
      this.#timer = setTimeout(() => this.#send(false), BATCH_WINDOW_MS);
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#send(true);
  }

  /**
   * Send whatever is queued.
   *
   * `beacon` is used when the page is going away, because `fetch` is cancelled
   * on navigation and `sendBeacon` is specified to survive it. Otherwise a
   * `keepalive` fetch, which lets the response be ignored without the request
   * being torn down.
   */
  #send(beacon: boolean): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#queue.length === 0) return;

    const events = this.#queue.splice(0, MAX_BATCH);
    const url = `${this.#options.apiBase}/widget/v1/events/${this.#options.publicId}`;
    const body = JSON.stringify({ events });

    try {
      if (
        beacon &&
        typeof navigator !== 'undefined' &&
        typeof navigator.sendBeacon === 'function'
      ) {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        return;
      }

      void fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
        // No credentials: this is a cross-origin call from a customer's page
        // and there is no session to send. Sending cookies would only add a
        // reason for a browser to block it.
        credentials: 'omit',
      }).catch(() => undefined);
    } catch {
      // Telemetry never interrupts the widget. See rule 1 above.
    }
  }
}
