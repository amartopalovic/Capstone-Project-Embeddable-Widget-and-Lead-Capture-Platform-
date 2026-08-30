import { REDACTED } from './logging.js';

// Monitoring is an external data sink. Allow structural diagnostics, not
// arbitrary SDK enrichment or free-text fields whose contents are unknowable.
const ROUTE_SEGMENTS = new Set(
  'api v1 widget public demo auth login logout register verify resend password reset-request reset-confirm csrf me sessions revoke-all mfa setup enable disable challenge recovery workspaces workspace members invitations widgets contacts events deliveries analytics diagnostics config feed submit privacy unsubscribe opt-in export deletion docs install domains consent webhooks troubleshooting policies terms storage acceptable-use health live ready api-reference account onboarding'.split(
    ' ',
  ),
);

export function scrubTelemetryUrl(raw: string): string {
  try {
    const url = new URL(raw, 'https://telemetry.invalid');
    return url.pathname
      .split('/')
      .map((part) => (part === '' || ROUTE_SEGMENTS.has(part) ? part : ':redacted'))
      .join('/');
  } catch {
    return REDACTED;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  );
}

/** Same policy for server and browser errors AND sampled transactions. */
export function scrubTelemetryEvent<T extends object>(event: T): T {
  const source = record(event);
  const safe = pick(source, [
    'type',
    'event_id',
    'timestamp',
    'start_timestamp',
    'platform',
    'level',
    'environment',
    'release',
    'dist',
  ]);
  if (source['message'] !== undefined) safe['message'] = REDACTED;
  if (typeof source['transaction'] === 'string')
    safe['transaction'] = scrubTelemetryUrl(source['transaction']);

  if (source['user'] !== undefined) safe['user'] = pick(record(source['user']), ['id']);
  if (source['request'] !== undefined) {
    const request = record(source['request']);
    safe['request'] = {
      ...pick(request, ['method']),
      ...(typeof request['url'] === 'string' ? { url: scrubTelemetryUrl(request['url']) } : {}),
    };
  }
  if (source['extra'] !== undefined) {
    safe['extra'] = Object.fromEntries(
      Object.entries(record(source['extra'])).map(([key, value]) => [
        key,
        ['workspaceId', 'userId', 'correlationId'].includes(key) ? value : REDACTED,
      ]),
    );
  }
  if (source['tags'] !== undefined)
    safe['tags'] = pick(record(source['tags']), ['correlation_id', 'workspace_id', 'event']);
  if (source['contexts'] !== undefined) {
    const trace = record(record(source['contexts'])['trace']);
    safe['contexts'] = {
      trace: pick(trace, ['trace_id', 'span_id', 'parent_span_id', 'op', 'status']),
    };
  }
  const exceptions = record(source['exception'])['values'];
  if (Array.isArray(exceptions)) {
    safe['exception'] = {
      values: exceptions.map((item: unknown) => {
        const exception = record(item);
        const frames = record(exception['stacktrace'])['frames'];
        return {
          type:
            typeof exception['type'] === 'string' &&
            /^[A-Za-z][A-Za-z0-9]*Error$/.test(exception['type'])
              ? exception['type']
              : 'Error',
          value: REDACTED,
          ...(Array.isArray(frames)
            ? {
                stacktrace: {
                  frames: frames.map((item: unknown) => {
                    const frame = record(item);
                    const filename =
                      typeof frame['filename'] === 'string'
                        ? frame['filename']
                            .split(/[\\/?#]/)
                            .filter(Boolean)
                            .at(-1)
                        : undefined;
                    return {
                      ...pick(frame, ['lineno', 'colno', 'in_app']),
                      ...(filename !== undefined && /^[A-Za-z0-9_.-]+\.[cm]?[jt]sx?$/.test(filename)
                        ? { filename }
                        : {}),
                    };
                  }),
                },
              }
            : {}),
        };
      }),
    };
  }
  if (Array.isArray(source['breadcrumbs'])) {
    safe['breadcrumbs'] = source['breadcrumbs'].map((item: unknown) => {
      const crumb = record(item);
      const data = record(crumb['data']);
      return {
        ...pick(crumb, ['timestamp', 'type', 'category', 'level']),
        data: {
          ...pick(data, ['method', 'status_code']),
          ...(typeof data['url'] === 'string' ? { url: scrubTelemetryUrl(data['url']) } : {}),
        },
      };
    });
  }
  if (Array.isArray(source['spans']))
    safe['spans'] = source['spans'].map((span: object) => scrubTelemetrySpan(span));
  return safe as T;
}

/** DB statements, HTTP URLs, exception text and attributes can all hold PII. */
export function scrubTelemetrySpan<T extends object>(span: T): T {
  return {
    ...pick(record(span), [
      'span_id',
      'trace_id',
      'parent_span_id',
      'start_timestamp',
      'timestamp',
      'op',
      'status',
      'is_segment',
    ]),
    description: REDACTED,
    data: {},
  } as T;
}
