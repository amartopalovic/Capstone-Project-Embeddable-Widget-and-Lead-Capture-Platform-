import * as Sentry from '@sentry/react';
import type { ErrorEvent } from '@sentry/react';

/**
 * Browser error monitoring (blueprint 16.3).
 *
 * The same four requirements as the server, and the same answers, because a
 * PII rule that applies only on one side of the wire is not a rule. What
 * differs is what there is to leak: the dashboard renders real contacts, so an
 * error report from this application could carry a lead's name in a breadcrumb
 * or an address in a URL, and both are scrubbed here before transmission.
 *
 * Off unless a DSN is configured, which is every local run and every test.
 */

/** The values a URL in this application can carry that must not be reported. */
const SECRET_QUERY_KEYS = new Set(['token', 'code', 'key', 'secret', 'signature', 'invitation']);

/**
 * Path segments that ARE an identifier.
 *
 * `/contacts/68f3a91b0c4e5d2f7a8b9c01` names one person's record. The path is
 * useful for grouping errors and the id is not, so the id is replaced rather
 * than the URL being dropped: a report that cannot say which page broke is not
 * worth sending.
 */
const ID_SEGMENT = /\/[0-9a-f]{24}(?=\/|$)/g;

export function scrubUrl(raw: string): string {
  const [path = '', query] = raw.split('?');
  const safePath = path.replace(ID_SEGMENT, '/:id');
  if (query === undefined) return safePath;

  const params = new URLSearchParams(query);
  for (const key of [...params.keys()]) {
    if (SECRET_QUERY_KEYS.has(key.toLowerCase())) params.set(key, '[redacted]');
  }
  const rendered = params.toString();
  return rendered === '' ? safePath : `${safePath}?${rendered}`;
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: ErrorEvent = { ...event };

  if (scrubbed.user !== undefined) {
    const { ip_address: _ip, email: _email, username: _username, ...safe } = scrubbed.user;
    scrubbed.user = safe;
  }

  if (scrubbed.request !== undefined) {
    const request = { ...scrubbed.request };
    delete request.cookies;
    delete request.headers;
    delete request.data;
    if (typeof request.url === 'string') request.url = scrubUrl(request.url);
    scrubbed.request = request;
  }

  /**
   * Breadcrumbs are where the dashboard actually leaks.
   *
   * The SDK records every fetch and every navigation by default, so an
   * unscrubbed trail from this application contains the URL of each contact the
   * user opened and each export they requested. Only the URL is rewritten -
   * dropping breadcrumbs entirely would remove the one thing that makes a
   * browser error report diagnosable.
   */
  if (scrubbed.breadcrumbs !== undefined) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map((crumb) => {
      const data = crumb.data;
      if (data === undefined) return crumb;
      const url = data['url'];
      if (typeof url !== 'string') return crumb;
      return { ...crumb, data: { ...data, url: scrubUrl(url) } };
    });
  }

  return scrubbed;
}

export function initObservability(): void {
  const dsn = import.meta.env['VITE_SENTRY_DSN'] ?? '';
  if (dsn === '') return;

  Sentry.init({
    dsn,
    environment: import.meta.env['VITE_ENVIRONMENT'] ?? 'development',
    /**
     * The deployed commit, injected at build time.
     *
     * Blueprint 16.3 requires this to match the server's, or a browser error
     * and the API error it caused land under two different releases and nobody
     * connects them.
     */
    release: import.meta.env['VITE_RELEASE'] ?? 'local-dev',
    tracesSampleRate: Number(import.meta.env['VITE_SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1'),
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    /**
     * Noise that is not this application's failure.
     *
     * A cancelled fetch is what a browser reports when somebody navigates away
     * mid-request, and a ResizeObserver loop notice is a benign browser
     * warning that every application on the web produces. Reporting either as
     * a crash buries the ones that are real.
     */
    ignoreErrors: [
      'AbortError',
      'Failed to fetch',
      'NetworkError',
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
    ],
  });
}

/**
 * React 19's error hooks, adapted.
 *
 * `Sentry.reactErrorHandler()` exists for exactly this, but its callback is
 * typed against React's own `ErrorInfo`, whose `componentStack` is
 * `string | null` where `createRoot`'s option is `string | undefined`. Under
 * `exactOptionalPropertyTypes` those are not the same type. Capturing directly
 * is three lines and keeps the strict setting doing its job, rather than
 * casting the difference away at the one place a type mismatch would be worth
 * knowing about.
 */
export function captureReactError(
  error: unknown,
  info: { readonly componentStack?: string | undefined },
): void {
  Sentry.captureException(error, {
    contexts: { react: { componentStack: info.componentStack ?? 'unavailable' } },
  });
}
