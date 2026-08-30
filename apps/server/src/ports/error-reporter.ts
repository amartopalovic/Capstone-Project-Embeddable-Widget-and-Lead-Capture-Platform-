/**
 * Where an unexpected failure goes (blueprint 16.3).
 *
 * A port rather than a direct Sentry call, for the same reason every other
 * outbound dependency is one: the error handler is application code and must
 * not know which monitoring vendor exists this year, and a test needs to assert
 * WHAT was reported without a network.
 *
 * The contract is deliberately narrow. There is no `captureMessage`, because a
 * message worth sending to a monitoring service is a log line, and this
 * project already has structured logging that redacts. This exists for the one
 * case logging cannot serve: an exception whose stack an operator needs.
 */

export interface ErrorReportContext {
  readonly correlationId?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly userId?: string | undefined;
  /** A safe, stable name such as `request.unhandled_error`. */
  readonly event?: string | undefined;
}

export interface ErrorReporter {
  /**
   * Report an exception.
   *
   * Never throws and never blocks the caller: an outage at the monitoring
   * vendor must not turn a handled 500 into a hung request.
   */
  captureException(error: unknown, context?: ErrorReportContext): void;
}

/** The reporter used when no DSN is configured, which is every local run. */
export const nullErrorReporter: ErrorReporter = {
  captureException: () => {
    // Deliberately nothing. Not having error monitoring configured is the
    // normal state of a development machine, not a condition to warn about on
    // every single error.
  },
};
