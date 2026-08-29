/**
 * Outbound webhook port (blueprint 12.4).
 *
 * A port, so the delivery worker can be tested against stated outcomes -
 * success, timeout, 429/5xx, 4xx - rather than against whatever a real
 * receiver happens to do (blueprint 18.4).
 *
 * Implementations MUST NOT follow redirects and MUST refuse unsafe
 * destinations; the result type has a dedicated `blocked` outcome so a refusal
 * is distinguishable from a failure, and is never retried as though the
 * network had hiccuped.
 */

export interface WebhookRequest {
  readonly url: string;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

export type WebhookResult =
  | { readonly outcome: 'delivered'; readonly statusCode: number }
  | { readonly outcome: 'http_error'; readonly statusCode: number }
  | { readonly outcome: 'timeout' }
  | { readonly outcome: 'network_error'; readonly reason: string }
  /** Refused by us, not by them. Permanent by definition. */
  | { readonly outcome: 'blocked'; readonly reason: string };

export interface WebhookClient {
  readonly name: string;
  send(request: WebhookRequest): Promise<WebhookResult>;
}
