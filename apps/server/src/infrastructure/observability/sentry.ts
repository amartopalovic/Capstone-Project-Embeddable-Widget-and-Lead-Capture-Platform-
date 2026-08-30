import * as Sentry from '@sentry/node';
import type { ErrorEvent, EventHint } from '@sentry/node';
import { redact } from '@lcp/contracts';
import type { ErrorReporter, ErrorReportContext } from '../../ports/error-reporter.js';

/**
 * Sentry (blueprint 16.3).
 *
 * Four requirements, and each one is implemented rather than assumed:
 *
 *  - uncaught server errors are captured;
 *  - the release identifier matches the deployed commit;
 *  - PII scrubbing runs BEFORE transmission;
 *  - expected validation, authentication, spam, and rate-limit responses are
 *    not reported as crashes.
 *
 * The last one is not a filter in this file. It falls out of where capture is
 * called from: the terminal error handler reports only the branch that produces
 * a 500, so every `ApiError`, every CSRF rejection, every 413 and every 429 is
 * answered and never reported. That is stronger than a list of ignored
 * messages, because a new expected error added in some future stage is excluded
 * by construction rather than by remembering to add it here.
 */

export interface SentryOptions {
  readonly dsn: string;
  readonly environment: string;
  /** The deployed commit. Blueprint 16.3 requires these to be the same string. */
  readonly release: string;
  readonly tracesSampleRate: number;
}

/**
 * Query parameters this product puts real secrets in.
 *
 * Every unsubscribe, opt-in, verification, invitation, and privacy link in the
 * system carries a single-use token in its URL. A URL is the single most
 * commonly attached piece of an error report, so a report from any of those
 * pages would otherwise hand the monitoring vendor a working token.
 */
const SECRET_QUERY_KEYS = new Set(['token', 'code', 'key', 'secret', 'signature', 'invitation']);

/**
 * Strip an event of everything blueprint 16.1 forbids in logs.
 *
 * Exported and pure so it can be tested directly, which matters more here than
 * anywhere else in the codebase: this is the one function whose failure is
 * invisible locally and only discovered by reading production data that should
 * never have left the building.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: ErrorEvent = { ...event };

  /**
   * The IP address, unconditionally (blueprint 9.4).
   *
   * `sendDefaultPii: false` already stops the SDK attaching one, so this is the
   * second of two independent controls rather than the only one. The product's
   * position on raw IPs is that they are never persisted anywhere, and a crash
   * report is somewhere.
   */
  if (scrubbed.user !== undefined) {
    const { ip_address: _ip, email: _email, username: _username, ...safe } = scrubbed.user;
    scrubbed.user = safe;
  }

  if (scrubbed.request !== undefined) {
    const request = { ...scrubbed.request };
    // Cookies carry the session id; headers carry the cookie and any
    // authorization; the body carries whatever a visitor typed into a form.
    delete request.cookies;
    delete request.headers;
    delete request.data;
    if (typeof request.query_string === 'string') {
      request.query_string = stripSecretQuery(request.query_string);
    }
    if (typeof request.url === 'string') request.url = stripSecretsFromUrl(request.url);
    scrubbed.request = request;
  }

  // Anything a call site attached, through the same redaction the structured
  // logger uses, so the two cannot disagree about what is sensitive.
  if (scrubbed.extra !== undefined) {
    scrubbed.extra = redact(scrubbed.extra) as Record<string, unknown>;
  }
  if (scrubbed.contexts !== undefined) {
    scrubbed.contexts = redact(scrubbed.contexts) as typeof scrubbed.contexts;
  }
  /**
   * Breadcrumbs, which needed two passes rather than one.
   *
   * `redact` matches forbidden KEY names, and the first version of this
   * function stopped there - which left `data.url` untouched, because `url` is
   * not a sensitive field name. It is a sensitive VALUE: the SDK records every
   * outbound request as a breadcrumb, so an unsubscribe or opt-in link went to
   * the monitoring vendor with its single-use token intact. Found by the test
   * below rather than by reading this file.
   */
  if (scrubbed.breadcrumbs !== undefined) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map((crumb) => {
      if (crumb.data === undefined) return crumb;
      const data = redact(crumb.data) as Record<string, unknown>;
      const url = data['url'];
      if (typeof url === 'string') data['url'] = stripSecretsFromUrl(url);
      return { ...crumb, data };
    });
  }

  return scrubbed;
}

function stripSecretQuery(queryString: string): string {
  const params = new URLSearchParams(queryString);
  for (const key of [...params.keys()]) {
    if (SECRET_QUERY_KEYS.has(key.toLowerCase())) params.set(key, '[redacted]');
  }
  return params.toString();
}

function stripSecretsFromUrl(url: string): string {
  const marker = url.indexOf('?');
  if (marker === -1) return url;
  return `${url.slice(0, marker)}?${stripSecretQuery(url.slice(marker + 1))}`;
}

/**
 * Start Sentry, and hand back the reporter the application will use.
 *
 * Called from `instrument.ts` before anything else is imported, because the
 * SDK's automatic instrumentation has to patch modules before they are loaded.
 */
export function initSentry(options: SentryOptions): ErrorReporter {
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    tracesSampleRate: options.tracesSampleRate,
    /**
     * OFF, and the whole PII posture depends on it.
     *
     * With this on, the SDK attaches the client IP, request headers, and cookies
     * by itself. `scrubEvent` removes them again, but a control that only works
     * because a second control undoes the first is one edit away from failing
     * silently.
     */
    sendDefaultPii: false,
    beforeSend: (event: ErrorEvent, _hint: EventHint) => scrubEvent(event),
  });

  return {
    captureException(error: unknown, context?: ErrorReportContext): void {
      try {
        Sentry.withScope((scope) => {
          if (context?.correlationId !== undefined) {
            scope.setTag('correlation_id', context.correlationId);
          }
          if (context?.workspaceId !== undefined) scope.setTag('workspace_id', context.workspaceId);
          if (context?.userId !== undefined) scope.setUser({ id: context.userId });
          if (context?.event !== undefined) scope.setTag('event', context.event);
          Sentry.captureException(error);
        });
      } catch {
        // A monitoring outage is not an application failure. The structured log
        // line for this error was already written by the caller.
      }
    },
  };
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Shutting down either way.
  }
}
