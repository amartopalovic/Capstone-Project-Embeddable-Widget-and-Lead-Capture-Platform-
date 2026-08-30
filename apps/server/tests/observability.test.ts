import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ErrorEvent } from '@sentry/node';
import { ERROR_CODES, createLogger } from '@lcp/contracts';
import { scrubEvent } from '../src/infrastructure/observability/sentry.js';
import { ApiError, errorHandler } from '../src/http/middleware/error-handler.js';
import type { ErrorReporter, ErrorReportContext } from '../src/ports/error-reporter.js';

/**
 * Error monitoring (blueprint 16.3).
 *
 * Two claims, and both are the kind that is invisible until somebody reads
 * production data that should never have been sent:
 *
 *  1. PII scrubbing runs before transmission.
 *  2. Expected validation, authentication, spam, and rate-limit responses are
 *     not reported as crashes.
 *
 * The second is tested through the REAL error handler over real HTTP rather
 * than by inspecting the code, because the claim is about which responses reach
 * the reporter, and that is a property of the middleware's branching.
 */

function event(overrides: Partial<ErrorEvent>): ErrorEvent {
  return { type: undefined, event_id: 'e1', ...overrides };
}

describe('PII scrubbing before transmission - EXIT GATE', () => {
  it('removes the IP address, which blueprint 9.4 never persists anywhere', () => {
    const scrubbed = scrubEvent(
      event({ user: { id: 'u1', ip_address: '203.0.113.9', email: 'lead@example.invalid' } }),
    );
    expect(scrubbed.user).toEqual({ id: 'u1' });
  });

  it('removes cookies, headers, and the request body', () => {
    const scrubbed = scrubEvent(
      event({
        request: {
          url: 'https://app.example.invalid/api/v1/contacts',
          cookies: { 'lcp.sid': 'a-real-session-id' },
          headers: { cookie: 'lcp.sid=a-real-session-id', authorization: 'Bearer x' },
          data: { values: { email: 'lead@example.invalid', message: 'what somebody typed' } },
        },
      }),
    );

    expect(scrubbed.request?.cookies).toBeUndefined();
    expect(scrubbed.request?.headers).toBeUndefined();
    expect(scrubbed.request?.data).toBeUndefined();
    expect(JSON.stringify(scrubbed)).not.toContain('a-real-session-id');
    expect(JSON.stringify(scrubbed)).not.toContain('what somebody typed');
  });

  it('redacts a single-use token out of a URL', () => {
    /**
     * Every unsubscribe, opt-in, verification, invitation, and privacy link in
     * this product carries a token in its query string, and a URL is the single
     * most commonly attached piece of a crash report. An unscrubbed report from
     * one of those pages hands the monitoring vendor a working token.
     */
    const scrubbed = scrubEvent(
      event({
        request: {
          url: 'https://app.example.invalid/public/unsubscribe?token=live-single-use-token&id=7',
          query_string: 'token=live-single-use-token&id=7',
        },
      }),
    );

    expect(scrubbed.request?.query_string).toContain('token=%5Bredacted%5D');
    expect(scrubbed.request?.url).not.toContain('live-single-use-token');
    // The rest of the query survives, or the report stops being diagnosable.
    expect(scrubbed.request?.query_string).toContain('id=7');
  });

  it('runs attached context through the same redaction the logger uses', () => {
    const scrubbed = scrubEvent(
      event({
        extra: { webhookSecret: 'whsec_live', workspaceId: 'w1', fieldValues: { name: 'Ada' } },
      }),
    );

    expect(scrubbed.extra?.['webhookSecret']).toBe('[redacted]');
    expect(scrubbed.extra?.['fieldValues']).toBe('[redacted]');
    // Not everything: a workspace id is exactly what makes a report actionable.
    expect(scrubbed.extra?.['workspaceId']).toBe('w1');
  });

  it('rewrites a breadcrumb URL without dropping the trail', () => {
    const scrubbed = scrubEvent(
      event({
        breadcrumbs: [
          { category: 'fetch', data: { url: '/public/opt-in?code=secret-code', method: 'POST' } },
        ],
      }),
    );

    const crumb = scrubbed.breadcrumbs?.[0];
    expect(crumb?.data?.['method']).toBe('POST');
    expect(JSON.stringify(crumb)).not.toContain('secret-code');
  });
});

// ---------------------------------------------------------------------------

class RecordingReporter implements ErrorReporter {
  readonly reports: { error: unknown; context?: ErrorReportContext | undefined }[] = [];

  captureException(error: unknown, context?: ErrorReportContext): void {
    this.reports.push({ error, context });
  }
}

/**
 * A tiny application whose only job is to raise each kind of failure the real
 * error handler distinguishes between.
 */
function buildErrorApp(reporter: ErrorReporter): express.Express {
  const app = express();
  const logger = createLogger({
    bindings: { service: 'test', environment: 'test', release: 'test' },
    minLevel: 'error',
    sink: () => {
      // Silent: this suite is about what is REPORTED, not what is logged.
    },
  });

  app.use((request: Request, _response: Response, next: NextFunction) => {
    request.correlationId = 'test-correlation';
    next();
  });
  app.use(express.json({ limit: '32kb' }));

  app.get('/validation', (_request, _response, next) => {
    next(new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Invalid'));
  });
  app.get('/unauthenticated', (_request, _response, next) => {
    next(new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required'));
  });
  app.get('/throttled', (_request, _response, next) => {
    next(new ApiError(ERROR_CODES.RATE_LIMITED, 'Too many requests'));
  });
  app.get('/csrf', (_request, _response, next) => {
    next(Object.assign(new Error('invalid csrf token'), { code: 'EBADCSRFTOKEN' }));
  });
  app.post('/oversized', (_request, response) => {
    response.status(200).json({ ok: true });
  });
  app.get('/broken', () => {
    throw new Error('a driver said something we do not understand');
  });

  app.use(errorHandler(logger, reporter));
  return app;
}

describe('expected responses are never reported as crashes - EXIT GATE', () => {
  let server: Server;
  let baseUrl: string;
  let reporter: RecordingReporter;

  beforeAll(async () => {
    reporter = new RecordingReporter();
    server = createServer(buildErrorApp(reporter));
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(() => {
    server.close();
  });

  it('answers a validation failure, a 401, a 429, a CSRF rejection and a 413 without reporting one', async () => {
    const statuses = [
      (await fetch(`${baseUrl}/validation`)).status,
      (await fetch(`${baseUrl}/unauthenticated`)).status,
      (await fetch(`${baseUrl}/throttled`)).status,
      (await fetch(`${baseUrl}/csrf`)).status,
      (
        await fetch(`${baseUrl}/oversized`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ padding: 'x'.repeat(40_000) }),
        })
      ).status,
    ];

    // Every one of them is an answer this server meant to give.
    expect(statuses).toEqual([400, 401, 429, 403, 413]);
    expect(reporter.reports).toHaveLength(0);
  });

  it('reports the one failure nothing understood', async () => {
    const response = await fetch(`${baseUrl}/broken`);
    expect(response.status).toBe(500);

    expect(reporter.reports).toHaveLength(1);
    const report = reporter.reports[0];
    expect((report?.error as Error).message).toContain('do not understand');
    expect(report?.context?.correlationId).toBe('test-correlation');
    expect(report?.context?.event).toBe('request.unhandled_error');
  });

  it('never leaks the internal message to the caller', async () => {
    const body = (await (await fetch(`${baseUrl}/broken`)).json()) as {
      error: { message: string; requestId: string };
    };
    expect(body.error.message).toBe('An unexpected error occurred');
    expect(body.error.requestId).toBe('test-correlation');
  });
});
