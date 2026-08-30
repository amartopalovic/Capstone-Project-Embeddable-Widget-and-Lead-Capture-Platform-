import * as Sentry from '@sentry/react';
import type { ErrorEvent } from '@sentry/react';
import { scrubTelemetryEvent, scrubTelemetrySpan, scrubTelemetryUrl } from '@lcp/contracts';

export function scrubUrl(raw: string): string {
  return scrubTelemetryUrl(raw);
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  return scrubTelemetryEvent(event);
}

/** Off without a DSN. Error, transaction and span paths share the same policy. */
export function initObservability(): void {
  const dsn = import.meta.env['VITE_SENTRY_DSN'] ?? '';
  if (dsn === '') return;

  Sentry.init({
    dsn,
    environment: import.meta.env['VITE_ENVIRONMENT'] ?? 'development',
    release: import.meta.env['VITE_RELEASE'] ?? 'local-dev',
    tracesSampleRate: Number(import.meta.env['VITE_SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1'),
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeSendTransaction: (event) => scrubTelemetryEvent(event),
    beforeSendSpan: (span) => scrubTelemetrySpan(span),
    beforeSendLog: () => null,
    ignoreErrors: [
      'AbortError',
      'Failed to fetch',
      'NetworkError',
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
    ],
  });
}

/** React 19 hooks have a different optional componentStack shape than Sentry's adapter. */
export function captureReactError(
  error: unknown,
  info: { readonly componentStack?: string | undefined },
): void {
  Sentry.captureException(error, {
    contexts: { react: { componentStack: info.componentStack ?? 'unavailable' } },
  });
}
