import { describe, expect, it } from 'vitest';
import { createLogger, redact, REDACTED, type LogRecord } from '../src/index.js';

/**
 * Blueprint section 16.1 lists exactly what logs must never contain. These
 * tests exist because that rule is only real if it is enforced centrally
 * rather than left to every future call site to remember.
 */

function collect(): { records: LogRecord[]; sink: (record: LogRecord) => void } {
  const records: LogRecord[] = [];
  return { records, sink: (record: LogRecord) => records.push(record) };
}

describe('structured log record shape', () => {
  it('always carries the required envelope fields', () => {
    const { records, sink } = collect();
    const logger = createLogger({
      bindings: { service: 'server', environment: 'test', release: 'abc123' },
      sink,
    });

    logger.info('mongo.connected', { correlationId: 'req-1', durationMs: 12, result: 'success' });

    const record = records[0];
    expect(record).toBeDefined();
    expect(record?.service).toBe('server');
    expect(record?.environment).toBe('test');
    expect(record?.release).toBe('abc123');
    expect(record?.event).toBe('mongo.connected');
    expect(record?.level).toBe('info');
    expect(record?.correlationId).toBe('req-1');
    expect(record?.durationMs).toBe(12);
    expect(record?.result).toBe('success');
    expect(() => new Date(String(record?.timestamp)).toISOString()).not.toThrow();
  });

  it('honours the minimum level', () => {
    const { records, sink } = collect();
    const logger = createLogger({
      bindings: { service: 's', environment: 'test', release: 'r' },
      minLevel: 'warn',
      sink,
    });

    logger.debug('ignored.debug');
    logger.info('ignored.info');
    logger.warn('kept.warn');
    logger.error('kept.error');

    expect(records.map((record) => record.event)).toEqual(['kept.warn', 'kept.error']);
  });

  it('child loggers inherit context such as a correlation id', () => {
    const { records, sink } = collect();
    const logger = createLogger({
      bindings: { service: 's', environment: 'test', release: 'r' },
      sink,
    }).child({ correlationId: 'req-42', workspaceId: 'ws-1' });

    logger.info('scoped.event');

    expect(records[0]?.correlationId).toBe('req-42');
    expect(records[0]?.workspaceId).toBe('ws-1');
  });

  it('permits workspace and user ids, which section 16.1 explicitly allows', () => {
    const { records, sink } = collect();
    const logger = createLogger({
      bindings: { service: 's', environment: 'test', release: 'r' },
      sink,
    });

    logger.info('membership.updated', { workspaceId: 'ws-1', userId: 'user-1' });

    expect(records[0]?.workspaceId).toBe('ws-1');
    expect(records[0]?.userId).toBe('user-1');
  });
});

describe('forbidden fields are redacted', () => {
  it('scrubs success and failure metadata including provider text and lead values', () => {
    const { records, sink } = collect();
    const logger = createLogger({
      bindings: { service: 'audit', environment: 'test', release: 'test' },
      sink,
    });
    for (const level of ['info', 'warn', 'error'] as const) {
      logger[level]('audit.event', {
        email: 'AUDIT_PRIVATE_SENTINEL@example.invalid',
        normalizedEmail: 'AUDIT_PRIVATE_SENTINEL',
        name: 'AUDIT_PRIVATE_SENTINEL',
        values: { message: 'AUDIT_PRIVATE_SENTINEL' },
        reason: 'driver: AUDIT_PRIVATE_SENTINEL',
        error: 'AUDIT_PRIVATE_SENTINEL',
        detail: 'AUDIT_PRIVATE_SENTINEL',
        query: 'AUDIT_PRIVATE_SENTINEL',
        url: 'AUDIT_PRIVATE_SENTINEL',
        message: 'AUDIT_PRIVATE_SENTINEL',
        correlationId: 'safe-correlation',
        result: 'server_error',
      });
    }
    expect(JSON.stringify(records)).not.toContain('AUDIT_PRIVATE_SENTINEL');
    expect(records.every((record) => record.correlationId === 'safe-correlation')).toBe(true);
  });
  it('redacts every category named in blueprint section 16.1', () => {
    const { records, sink } = collect();
    const logger = createLogger({
      bindings: { service: 's', environment: 'test', release: 'r' },
      sink,
    });

    logger.info('request.completed', {
      ip: '203.0.113.10',
      remoteAddress: '203.0.113.10',
      password: 'hunter2',
      passwordHash: 'argon2id-hash',
      token: 'tok-abc',
      tokenHash: 'sha256-abc',
      sessionId: 'sess-abc',
      cookie: 'lcp.sid=abc',
      authorization: 'Bearer abc',
      webhookSecret: 'whsec-abc',
      encryptionKey: 'key',
      apiKey: 'provider-key',
      emailBody: 'Dear user',
      submissionValues: { email: 'lead@example.invalid' },
      totpSecret: 'JBSWY3DP',
      recoveryCode: '1234-5678',
    });

    const record = records[0] as unknown as Record<string, unknown>;
    const mustRedact = [
      'ip',
      'remoteAddress',
      'password',
      'passwordHash',
      'token',
      'tokenHash',
      'sessionId',
      'cookie',
      'authorization',
      'webhookSecret',
      'encryptionKey',
      'apiKey',
      'emailBody',
      'submissionValues',
      'totpSecret',
      'recoveryCode',
    ];

    for (const key of mustRedact) {
      expect(record[key], `${key} must be redacted`).toBe(REDACTED);
    }
  });

  it('redacts nested forbidden fields', () => {
    const output = redact({
      safe: 'kept',
      nested: { deeper: { password: 'hunter2', keepMe: 'yes' } },
      list: [{ token: 'abc' }],
    }) as Record<string, unknown>;

    const nested = (output['nested'] as Record<string, unknown>)['deeper'] as Record<
      string,
      unknown
    >;
    expect(nested['password']).toBe(REDACTED);
    expect(nested['keepMe']).toBe('yes');
    expect(output['safe']).toBe('kept');

    const list = output['list'] as Record<string, unknown>[];
    expect(list[0]?.['token']).toBe(REDACTED);
  });

  it('matches field names case- and separator-insensitively', () => {
    const output = redact({
      IP: 'x',
      Password: 'x',
      session_id: 'x',
      'webhook-secret': 'x',
      API_KEY: 'x',
    }) as Record<string, unknown>;

    for (const key of ['IP', 'Password', 'session_id', 'webhook-secret', 'API_KEY']) {
      expect(output[key], `${key} must be redacted`).toBe(REDACTED);
    }
  });

  it('does not recurse without bound on deeply nested input', () => {
    let deep: Record<string, unknown> = { password: 'x' };
    for (let index = 0; index < 50; index += 1) {
      deep = { nested: deep };
    }
    expect(() => redact(deep)).not.toThrow();
  });
});
