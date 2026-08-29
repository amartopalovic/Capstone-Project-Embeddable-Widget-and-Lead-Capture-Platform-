import { lookup } from 'node:dns/promises';
import type { WebhookClient, WebhookRequest, WebhookResult } from '../../ports/webhook-client.js';
import { checkDestination, type Resolver } from '../../domain/delivery/ssrf.js';

/**
 * The real outbound webhook sender (blueprint 12.4).
 *
 * Three defences, each doing a distinct job:
 *
 *  1. **Destination validation immediately before the request.** Not only when
 *     the endpoint was saved - DNS changes, and 12.4 says destinations are
 *     blocked, full stop. Every resolved address is checked, not just the first.
 *  2. **`redirect: 'manual'`.** Blueprint 12.4 allows redirects to be disabled
 *     OR revalidated per hop; disabling is the choice here because it is the
 *     one with no bypass. A 3xx is reported as an error rather than followed,
 *     so a public URL cannot bounce the request to 169.254.169.254. Node's
 *     fetch returns the real response under `manual`, so the status is visible.
 *  3. **A hard timeout.** A receiver that accepts a connection and never
 *     answers would otherwise hold a worker slot indefinitely.
 */

export const WEBHOOK_TIMEOUT_MS = 10_000;

/** Read the whole response but keep only enough to describe what happened. */
const MAX_CAPTURED_RESPONSE = 200;

export interface HttpWebhookClientOptions {
  readonly requireHttps: boolean;
  readonly timeoutMs?: number;
  /** Injectable so the SSRF tests can state what a hostname resolves to. */
  readonly resolver?: Resolver;
}

const defaultResolver: Resolver = async (hostname) => {
  const results = await lookup(hostname, { all: true });
  return results.map((entry) => entry.address);
};

export class HttpWebhookClient implements WebhookClient {
  readonly name = 'http';
  readonly #options: HttpWebhookClientOptions;

  constructor(options: HttpWebhookClientOptions) {
    this.#options = options;
  }

  async send(request: WebhookRequest): Promise<WebhookResult> {
    const check = await checkDestination(
      request.url,
      this.#options.requireHttps,
      this.#options.resolver ?? defaultResolver,
    );
    if (!check.ok) {
      return { outcome: 'blocked', reason: check.reason };
    }

    try {
      const response = await fetch(check.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...request.headers },
        body: request.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.#options.timeoutMs ?? WEBHOOK_TIMEOUT_MS),
      });

      /**
       * A redirect is refused rather than followed. Reported as an http_error
       * so it classifies through the ordinary status rules: a 3xx is not a 4xx,
       * so it is treated as transient, which is right - a receiver that has
       * temporarily put a redirect in front of its endpoint deserves a retry
       * once they take it down.
       */
      if (response.status >= 300 && response.status < 400) {
        return { outcome: 'http_error', statusCode: response.status };
      }

      if (response.ok) {
        // Drain, so the socket is released back to the pool promptly.
        await response.text().catch(() => '');
        return { outcome: 'delivered', statusCode: response.status };
      }

      await response.text().then(
        (text) => text.slice(0, MAX_CAPTURED_RESPONSE),
        () => '',
      );
      return { outcome: 'http_error', statusCode: response.status };
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        return { outcome: 'timeout' };
      }
      return {
        outcome: 'network_error',
        // The message only; a cause chain can carry the resolved address.
        reason: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
      };
    }
  }
}
