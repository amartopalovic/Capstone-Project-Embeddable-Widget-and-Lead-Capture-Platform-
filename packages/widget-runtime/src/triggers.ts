import type { WidgetTrigger } from '@lcp/contracts';

/**
 * Opening triggers (blueprint 4.4), and the shared listeners they need.
 *
 * Blueprint 8.1: "Global listeners needed for scroll or exit intent are
 * registered once and dispatch to eligible instances." So scroll and exit
 * intent are page-level here, with one listener each no matter how many widgets
 * are on the page - a per-instance scroll handler would multiply the cost of
 * the one event that fires most.
 *
 * Exit intent is the interesting case. Blueprint 4.4: "Exit intent is
 * desktop-capable behavior. On browsers where it cannot be meaningfully
 * detected, the widget does not fake the trigger; another configured trigger
 * may still open it." So it is not simulated on touch devices - a widget with
 * only an exit-intent trigger simply never opens there, which is the honest
 * outcome rather than an invented one.
 */

type Listener = () => void;

/** Whether this browser can meaningfully report an intent to leave. */
export function supportsExitIntent(): boolean {
  // A pointer that can hover is what makes "moved toward the browser chrome"
  // meaningful. Touch has no such gesture, so there is nothing to detect.
  return typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover)').matches;
}

/**
 * Page-level listeners, created lazily and shared by every instance.
 *
 * Registered on first use rather than at load, so a page whose widgets use only
 * click and delay triggers never installs a scroll handler at all.
 */
class SharedListeners {
  readonly #scroll = new Set<(depth: number) => void>();
  readonly #exit = new Set<Listener>();
  #scrollBound = false;
  #exitBound = false;

  onScroll(handler: (depth: number) => void): Listener {
    this.#scroll.add(handler);
    if (!this.#scrollBound) {
      this.#scrollBound = true;
      // Passive: this handler never calls preventDefault, and saying so keeps
      // it off the critical path of the page's own scrolling.
      window.addEventListener('scroll', this.#dispatchScroll, { passive: true });
    }
    return () => this.#scroll.delete(handler);
  }

  onExitIntent(handler: Listener): Listener {
    this.#exit.add(handler);
    if (!this.#exitBound) {
      this.#exitBound = true;
      document.addEventListener('mouseout', this.#dispatchExit);
    }
    return () => this.#exit.delete(handler);
  }

  readonly #dispatchScroll = (): void => {
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - window.innerHeight;
    // A page shorter than the viewport is fully seen; treat it as 100% so a
    // scroll trigger is not silently unreachable there.
    const depth = scrollable <= 0 ? 100 : Math.min(100, (window.scrollY / scrollable) * 100);
    for (const handler of [...this.#scroll]) handler(depth);
  };

  readonly #dispatchExit = (event: MouseEvent): void => {
    // Leaving through the top of the viewport, with no element being entered,
    // is the conventional signal that the pointer is heading for the tab bar.
    if (event.relatedTarget !== null) return;
    if (event.clientY > 0) return;
    for (const handler of [...this.#exit]) handler();
  };
}

export const sharedListeners = new SharedListeners();

export interface TriggerContext {
  readonly publicId: string;
  /** Called when any configured trigger fires. Opening is idempotent. */
  readonly open: () => void;
}

/**
 * Wire one instance's triggers, returning a function that unwires them all.
 *
 * A click trigger looks for host-page elements marked
 * `data-lcp-widget-open="<publicId>"`. That is the only contract a customer has
 * to learn, and it keeps the decision of WHAT opens the widget on the page that
 * owns the layout.
 */
export function wireTriggers(
  triggers: readonly WidgetTrigger[],
  context: TriggerContext,
): () => void {
  const teardown: Listener[] = [];

  for (const trigger of triggers) {
    switch (trigger.type) {
      case 'click': {
        const selector = `[data-lcp-widget-open="${CSS.escape(context.publicId)}"]`;
        const handler = (event: Event): void => {
          const target = event.target;
          if (target instanceof Element && target.closest(selector) !== null) {
            event.preventDefault();
            context.open();
          }
        };
        // Delegated from the document, so a trigger element added to the page
        // later still works without re-wiring.
        document.addEventListener('click', handler);
        teardown.push(() => document.removeEventListener('click', handler));
        break;
      }

      case 'delay': {
        const timer = window.setTimeout(context.open, trigger.delaySeconds * 1000);
        teardown.push(() => window.clearTimeout(timer));
        break;
      }

      case 'scroll_depth': {
        const off = sharedListeners.onScroll((depth) => {
          if (depth >= trigger.percent) context.open();
        });
        teardown.push(off);
        break;
      }

      case 'exit_intent': {
        // Not faked where it cannot be detected (blueprint 4.4).
        if (!supportsExitIntent()) break;
        teardown.push(sharedListeners.onExitIntent(context.open));
        break;
      }
    }
  }

  return () => {
    for (const off of teardown) off();
  };
}
