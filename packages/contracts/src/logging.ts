/**
 * Structured logging baseline (blueprint section 16.1).
 *
 * Every log line is one JSON object carrying: timestamp, severity, environment,
 * service, release, correlation ID, a safe event name, workspace and user IDs
 * where authorized, duration, and a result category.
 *
 * Blueprint section 16.1 also states what logs must NEVER contain: raw IP,
 * passwords, tokens, session IDs, captured lead values, email bodies, webhook
 * secrets, or encryption keys. That is enforced here by redacting forbidden
 * field names rather than trusting every future call site to remember.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogResult = 'success' | 'client_error' | 'server_error' | 'degraded';

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Field names that must never be logged, matched case-insensitively against the
 * whole key. Extended as later stages introduce more sensitive material.
 */
const FORBIDDEN_FIELDS: readonly string[] = [
  'ip',
  'ipaddress',
  'remoteaddress',
  'password',
  'passwordhash',
  'token',
  'tokenhash',
  'accesstoken',
  'refreshtoken',
  'sessionid',
  'sessiontoken',
  'cookie',
  'authorization',
  'secret',
  'webhooksecret',
  'signingsecret',
  'encryptionkey',
  'encryptionmasterkey',
  'encryptionkeyring',
  'iphmacsecret',
  'sessionsecret',
  'brevoapikey',
  'headers',
  'cookies',
  'apikey',
  'emailbody',
  'body',
  'payload',
  'fieldvalues',
  'submissionvalues',
  'totpsecret',
  'recoverycode',
  'email',
  'emails',
  'normalizedemail',
  'name',
  'fullname',
  'firstname',
  'lastname',
  'address',
  'values',
  'query',
  'url',
  'pageurl',
  'referrer',
  // Provider/driver error text is not an operational enum: it can contain a
  // duplicate-key value, connection URI, email address, or captured content.
  // The stable event name, error class, IDs, counts and result remain useful.
  'error',
  'message',
  'reason',
  'detail',
];

export const REDACTED = '[redacted]';

function isForbidden(key: string): boolean {
  return FORBIDDEN_FIELDS.includes(key.toLowerCase().replace(/[^a-z]/g, ''));
}

/** Recursively redact forbidden keys. Depth-limited to avoid pathological input. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value === null || typeof value !== 'object') return value;

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isForbidden(key) ? REDACTED : redact(nested, depth + 1);
  }
  return output;
}

export interface LogContext {
  readonly correlationId?: string;
  readonly workspaceId?: string;
  readonly userId?: string;
  readonly durationMs?: number;
  readonly result?: LogResult;
  readonly [key: string]: unknown;
}

export interface LogRecord extends LogContext {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly service: string;
  readonly environment: string;
  readonly release: string;
  /** Safe, stable event name such as `mongo.connected` or `migration.applied`. */
  readonly event: string;
}

export interface LoggerBindings {
  readonly service: string;
  readonly environment: string;
  readonly release: string;
}

export interface Logger {
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
  /** Derive a logger that always carries extra context, e.g. a correlation ID. */
  child(context: LogContext): Logger;
}

export interface LoggerOptions {
  readonly bindings: LoggerBindings;
  readonly minLevel?: LogLevel;
  /** Defaults to writing one JSON line to stdout. Overridden in tests. */
  readonly sink?: (record: LogRecord) => void;
}

function defaultSink(record: LogRecord): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export function createLogger(options: LoggerOptions): Logger {
  const minLevel = options.minLevel ?? 'info';
  const sink = options.sink ?? defaultSink;

  function build(inherited: LogContext): Logger {
    function emit(level: LogLevel, event: string, context?: LogContext): void {
      if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

      const merged = { ...inherited, ...context };
      const safe = redact(merged) as LogContext;

      sink({
        ...safe,
        timestamp: new Date().toISOString(),
        level,
        service: options.bindings.service,
        environment: options.bindings.environment,
        release: options.bindings.release,
        event,
      });
    }

    return {
      debug: (event, context) => emit('debug', event, context),
      info: (event, context) => emit('info', event, context),
      warn: (event, context) => emit('warn', event, context),
      error: (event, context) => emit('error', event, context),
      child: (context) => build({ ...inherited, ...context }),
    };
  }

  return build({});
}
