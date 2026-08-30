import { describe, expect, it } from 'vitest';
import { scrubTelemetryEvent, scrubTelemetrySpan, scrubTelemetryUrl } from '../src/index.js';

const PRIVATE = 'AUDIT_PRIVATE_SENTINEL';

describe('monitoring privacy boundary', () => {
  it('drops arbitrary URLs, queries, fragments, origins and unknown path values', () => {
    expect(
      scrubTelemetryUrl(
        `https://${PRIVATE}@example.invalid/contacts/${PRIVATE}?search=${PRIVATE}#${PRIVATE}`,
      ),
    ).toBe('/contacts/:redacted');
    expect(scrubTelemetryUrl(`/public/unsubscribe?token=${PRIVATE}`)).toBe('/public/unsubscribe');
  });

  it.each(['error', 'transaction'])('scrubs %s envelopes without mutating the original', (type) => {
    const event = {
      type,
      start_timestamp: 100,
      timestamp: 101,
      release: 'test-release',
      event_id: 'event1',
      message: PRIVATE,
      transaction: `/contacts/${PRIVATE}?email=${PRIVATE}`,
      user: { id: 'user1', name: PRIVATE, email: PRIVATE, ip_address: PRIVATE },
      request: {
        method: 'POST',
        url: `/api/v1/contacts?search=${PRIVATE}`,
        query_string: PRIVATE,
        env: { REMOTE_ADDR: PRIVATE },
        headers: { cookie: PRIVATE },
        data: PRIVATE,
      },
      extra: { workspaceId: 'workspace1', arbitrary: PRIVATE },
      contexts: {
        trace: { trace_id: 'trace1', data: { private: PRIVATE } },
        arbitrary: { lead: PRIVATE },
      },
      tags: { correlation_id: 'request1', arbitrary: PRIVATE },
      exception: {
        values: [
          {
            type: 'MongoServerError',
            value: PRIVATE,
            stacktrace: {
              frames: [
                {
                  filename: `/srv/${PRIVATE}/app.js`,
                  vars: { lead: PRIVATE },
                  context_line: PRIVATE,
                  lineno: 42,
                },
              ],
            },
          },
        ],
      },
      breadcrumbs: [
        {
          timestamp: 1,
          category: 'fetch',
          message: PRIVATE,
          data: {
            method: 'GET',
            url: `/contacts/${PRIVATE}`,
            from: PRIVATE,
            to: PRIVATE,
            values: PRIVATE,
          },
        },
      ],
      spans: [{ span_id: 'span1', description: PRIVATE, data: { 'db.statement': PRIVATE } }],
      unknownSdkEnrichment: PRIVATE,
    };
    const before = JSON.stringify(event);
    const safe = scrubTelemetryEvent(event);
    expect(JSON.stringify(safe)).not.toContain(PRIVATE);
    expect(safe.user).toEqual({ id: 'user1' });
    expect(safe.start_timestamp).toBe(100);
    expect(safe.timestamp).toBe(101);
    expect(safe.extra.workspaceId).toBe('workspace1');
    expect(safe.tags.correlation_id).toBe('request1');
    expect(safe.exception.values[0]?.stacktrace.frames[0]).toEqual({
      filename: 'app.js',
      lineno: 42,
    });
    expect(JSON.stringify(event)).toBe(before);
  });

  it('scrubs spans even when the SDK serializes them separately', () => {
    const span = scrubTelemetrySpan({
      span_id: 'span1',
      op: 'db',
      description: PRIVATE,
      data: { 'db.statement': PRIVATE },
      attributes: { lead: PRIVATE },
    });
    expect(JSON.stringify(span)).not.toContain(PRIVATE);
    expect(span.span_id).toBe('span1');
    expect(span.op).toBe('db');
  });
});
