import { createLogger, type LogRecord, type Logger } from '@lcp/contracts';

export interface CapturedLogger {
  readonly logger: Logger;
  readonly records: readonly LogRecord[];
}

/** A logger that captures records in memory instead of writing to stdout. */
export function createCapturingLogger(): CapturedLogger {
  const records: LogRecord[] = [];
  const logger = createLogger({
    bindings: { service: 'test', environment: 'test', release: 'test' },
    minLevel: 'debug',
    sink: (record) => records.push(record),
  });
  return { logger, records };
}

/** A logger that discards everything, for tests that do not assert on logs. */
export function createSilentLogger(): Logger {
  return createLogger({
    bindings: { service: 'test', environment: 'test', release: 'test' },
    minLevel: 'error',
    sink: () => undefined,
  });
}
