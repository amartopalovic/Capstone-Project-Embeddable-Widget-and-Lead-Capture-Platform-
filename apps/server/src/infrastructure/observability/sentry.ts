import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';
import { scrubTelemetryEvent, scrubTelemetrySpan } from '@lcp/contracts';
import type { ErrorReporter, ErrorReportContext } from '../../ports/error-reporter.js';

export interface SentryOptions {
  readonly dsn: string;
  readonly environment: string;
  readonly release: string;
  readonly tracesSampleRate: number;
}

/** A shared allowlist protects errors and traces on both sides of the wire. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  return scrubTelemetryEvent(event);
}

/** Called by instrument.ts before importing instrumented application modules. */
export function initSentry(options: SentryOptions): ErrorReporter {
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    tracesSampleRate: options.tracesSampleRate,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeSendTransaction: (event) => scrubTelemetryEvent(event),
    beforeSendSpan: (span) => scrubTelemetrySpan(span),
    beforeSendLog: () => null,
  });

  return {
    captureException(error: unknown, context?: ErrorReportContext): void {
      try {
        Sentry.withScope((scope) => {
          if (context?.correlationId !== undefined)
            scope.setTag('correlation_id', context.correlationId);
          if (context?.workspaceId !== undefined) scope.setTag('workspace_id', context.workspaceId);
          if (context?.userId !== undefined) scope.setUser({ id: context.userId });
          if (context?.event !== undefined) scope.setTag('event', context.event);
          Sentry.captureException(error);
        });
      } catch {
        // Monitoring failure must not interrupt the application.
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
