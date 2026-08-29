import type { PublicWidgetResponse } from '@lcp/contracts';
import { WidgetInstance } from './instance.js';

/**
 * The page-level widget registry (blueprint 8.1).
 *
 * "The loader maintains a page-level registry so multiple script tags share one
 * runtime" and "Each instance has its own public widget ID, Shadow root, event
 * state, and cleanup lifecycle."
 *
 * The loader collects the widget ids on the page into a global queue and loads
 * this bundle once. This module drains that queue and then REPLACES it with an
 * object whose `push` mounts immediately, so a script tag added after the
 * runtime has loaded still works and nothing has to poll.
 */

const QUEUE = '__LCP_WIDGET_QUEUE__';
const REGISTRY = '__LCP_WIDGET_REGISTRY__';

export interface QueueEntry {
  readonly publicId: string;
  readonly apiBase: string;
}

interface QueueLike {
  push(entry: QueueEntry): unknown;
}

declare global {
  interface Window {
    __LCP_WIDGET_QUEUE__?: QueueEntry[] | QueueLike;
    __LCP_WIDGET_REGISTRY__?: WidgetRegistry;
  }
}

export class WidgetRegistry {
  readonly #instances = new Map<string, WidgetInstance>();
  readonly #pending = new Set<string>();

  /** Every mounted instance, keyed by public widget id. */
  get instances(): ReadonlyMap<string, WidgetInstance> {
    return this.#instances;
  }

  async mount(entry: QueueEntry): Promise<void> {
    // One instance per public id per page. A duplicated script tag is a
    // mistake we absorb rather than a second widget.
    if (this.#instances.has(entry.publicId) || this.#pending.has(entry.publicId)) return;
    this.#pending.add(entry.publicId);

    try {
      const response = await fetchConfig(entry);
      if (response === null) return;

      const instance = new WidgetInstance({
        response,
        anchor: document.querySelector(`script[data-widget="${CSS.escape(entry.publicId)}"]`),
        // Funnel events go back to the origin the config came from, so a
        // self-hosted deployment needs no second base URL to configure.
        apiBase: entry.apiBase,
      });

      if (instance.start()) this.#instances.set(entry.publicId, instance);
    } finally {
      this.#pending.delete(entry.publicId);
    }
  }

  /** Tear every instance down, releasing listeners and DOM (blueprint 8.1). */
  destroyAll(): void {
    for (const instance of this.#instances.values()) instance.destroy();
    this.#instances.clear();
  }
}

/**
 * Fetch a widget's published configuration.
 *
 * Any failure is silent by design. A refused Origin, an unpublished widget, or
 * a network problem must leave the customer's page exactly as it was - a widget
 * that cannot load is invisible, never an error message on somebody else's
 * site.
 */
async function fetchConfig(entry: QueueEntry): Promise<PublicWidgetResponse | null> {
  try {
    const base = entry.apiBase.replace(/\/+$/, '');
    const url = `${base}/widget/v1/config/${encodeURIComponent(entry.publicId)}`;
    const response = await fetch(url, { credentials: 'omit', mode: 'cors' });
    if (!response.ok) return null;
    return (await response.json()) as PublicWidgetResponse;
  } catch {
    return null;
  }
}

function bootstrap(): WidgetRegistry {
  const existing = window[REGISTRY];
  if (existing !== undefined) return existing;

  const registry = new WidgetRegistry();
  window[REGISTRY] = registry;

  const queued = window[QUEUE];
  const entries: QueueEntry[] = Array.isArray(queued) ? [...queued] : [];

  // Replace the array with a live queue, so a later tag mounts immediately.
  window[QUEUE] = {
    push(entry: QueueEntry): number {
      void registry.mount(entry);
      return 0;
    },
  };

  for (const entry of entries) void registry.mount(entry);
  return registry;
}

export const registry = bootstrap();
export { WidgetInstance };
