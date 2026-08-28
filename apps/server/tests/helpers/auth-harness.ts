import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import { MongoConnection, runMigrations } from '@lcp/database';
import { createLogger, type LogRecord } from '@lcp/contracts';
import type { Db } from 'mongodb';
import { buildDependencies, type AppDependencies } from '../../src/composition.js';
import { createApp } from '../../src/http/app.js';
import { HealthService } from '../../src/application/health-service.js';
import type { ServerEnv } from '../../src/config/env.js';
import type { Clock } from '../../src/ports/clock.js';
import { MailpitEmailSender } from '../../src/infrastructure/email/mailpit-sender.js';

/**
 * Integration harness for the auth backend.
 *
 * Builds the REAL dependency graph against real MongoDB, real Redis, and real
 * Mailpit SMTP. The only substitution is the clock, so expiry can be tested
 * without sleeping for seven days.
 *
 * Each harness gets its own Mongo database and its own Redis key prefix, so
 * test files cannot interfere with each other or with a developer's local data.
 */

export const TEST_MONGO_URI =
  process.env['TEST_MONGODB_URI'] ?? 'mongodb://localhost:27017/?directConnection=true';
export const TEST_REDIS_URL = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379';
export const MAILPIT_HOST = process.env['MAILPIT_SMTP_HOST'] ?? 'localhost';
export const MAILPIT_SMTP_PORT = Number(process.env['MAILPIT_SMTP_PORT'] ?? 1025);
export const MAILPIT_API = process.env['MAILPIT_API'] ?? 'http://localhost:8025';

/** A clock the test drives explicitly. */
export class MutableClock implements Clock {
  #now: Date;

  constructor(start = new Date('2026-08-28T09:00:00.000Z')) {
    this.#now = start;
  }

  now(): Date {
    return this.#now;
  }

  advanceSeconds(seconds: number): void {
    this.#now = new Date(this.#now.getTime() + seconds * 1000);
  }

  advanceDays(days: number): void {
    this.advanceSeconds(days * 86_400);
  }
}

export interface AuthHarness {
  readonly baseUrl: string;
  readonly db: Db;
  readonly redis: Redis;
  readonly deps: AppDependencies;
  readonly clock: MutableClock;
  readonly logs: readonly LogRecord[];
  readonly keyPrefix: string;
  /**
   * Clear this harness's throttle counters.
   *
   * Every test request originates from 127.0.0.1, so without this the real
   * per-IP limits would make each test consume the next test's allowance. The
   * production limits are left untouched; only the counters are reset, and the
   * throttle tests deliberately exhaust them on purpose after clearing.
   */
  clearRateLimits(): Promise<void>;
  teardown(): Promise<void>;
}

export async function createAuthHarness(): Promise<AuthHarness> {
  const suffix = randomBytes(6).toString('hex');
  const databaseName = `lcp_auth_${suffix}`;
  const keyPrefix = `lcp:test:${suffix}`;

  const mongo = new MongoConnection({ uri: TEST_MONGO_URI, databaseName });
  await mongo.connect();

  const logs: LogRecord[] = [];
  const logger = createLogger({
    bindings: { service: 'server-test', environment: 'test', release: 'test' },
    minLevel: 'debug',
    sink: (record) => logs.push(record),
  });

  await runMigrations(mongo.db, logger);

  const redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: 2 });
  const clock = new MutableClock();

  const env = {
    nodeEnv: 'test',
    port: 0,
    release: 'test',
    mongoUri: TEST_MONGO_URI,
    mongoDbName: databaseName,
    redisUrl: TEST_REDIS_URL,
    redisKeyPrefix: keyPrefix,
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: 'integration-test-secret-not-a-real-credential',
    sessionCookieName: 'lcp.sid',
    sessionIdleTtlSeconds: 7 * 86_400,
    sessionAbsoluteTtlSeconds: 30 * 86_400,
    emailProvider: 'mailpit',
    brevoApiKey: '',
    brevoSenderEmail: `no-reply+${suffix}@example.invalid`,
    brevoSenderName: 'Lead Capture Test',
    mailpitHost: MAILPIT_HOST,
    mailpitPort: MAILPIT_SMTP_PORT,
    breachCheckRemote: false,
  } satisfies ServerEnv;

  // The real SMTP sender, pointed at the real Mailpit service.
  const emailSender = new MailpitEmailSender({
    host: env.mailpitHost,
    port: env.mailpitPort,
    fromEmail: env.brevoSenderEmail,
    fromName: env.brevoSenderName,
  });

  const deps = buildDependencies(env, mongo.db, redis, { clock, logger, emailSender });
  const healthService = new HealthService([], env.release);
  const app = createApp({ env, healthService, deps });

  const server: Server = createServer(app);
  const baseUrl = await new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${String(port)}`);
    });
  });

  return {
    baseUrl,
    db: mongo.db,
    redis,
    deps,
    clock,
    logs,
    keyPrefix,
    async clearRateLimits(): Promise<void> {
      const keys = await redis.keys(`${keyPrefix}:ratelimit:*`);
      if (keys.length > 0) await redis.del(...keys);
    },
    async teardown(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      emailSender.close();
      // Remove only this harness's keys, never the whole database.
      const keys = await redis.keys(`${keyPrefix}:*`);
      if (keys.length > 0) await redis.del(...keys);
      redis.disconnect();
      await mongo.db.dropDatabase();
      await mongo.close();
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP client that remembers cookies, so session behaviour is exercised the way
// a browser would exercise it.
// ---------------------------------------------------------------------------

export class TestClient {
  readonly #baseUrl: string;
  readonly #cookies = new Map<string, string>();

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl;
  }

  get cookieHeader(): string {
    return [...this.#cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  cookie(name: string): string | undefined {
    return this.#cookies.get(name);
  }

  clearCookies(): void {
    this.#cookies.clear();
  }

  #absorb(response: Response): void {
    const raw = response.headers.getSetCookie();
    for (const entry of raw) {
      const [pair] = entry.split(';');
      const separator = pair?.indexOf('=') ?? -1;
      if (pair === undefined || separator < 0) continue;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value === '') this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; body: unknown; headers: Headers }> {
    const headers: Record<string, string> = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36',
      ...extraHeaders,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const cookieHeader = this.cookieHeader;
    if (cookieHeader !== '') headers['cookie'] = cookieHeader;

    const response = await fetch(`${this.#baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    this.#absorb(response);

    const text = await response.text();
    let parsed: unknown = null;
    if (text !== '') {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    return { status: response.status, body: parsed, headers: response.headers };
  }

  post(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request('POST', path, body, headers);
  }

  get(path: string, headers?: Record<string, string>) {
    return this.request('GET', path, undefined, headers);
  }

  delete(path: string, headers?: Record<string, string>) {
    return this.request('DELETE', path, undefined, headers);
  }

  /** Fetch a CSRF token and return the header needed to send it. */
  async csrfHeaders(): Promise<Record<string, string>> {
    const response = await this.get('/api/v1/auth/csrf');
    const body = response.body as { csrfToken: string };
    return { 'x-csrf-token': body.csrfToken };
  }
}

// ---------------------------------------------------------------------------
// Mailpit API helpers
// ---------------------------------------------------------------------------

export interface MailpitMessage {
  readonly ID: string;
  readonly Subject: string;
  readonly To: readonly { readonly Address: string }[];
}

export async function mailpitSearch(recipient: string): Promise<readonly MailpitMessage[]> {
  const url = `${MAILPIT_API}/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const body = (await response.json()) as { messages?: MailpitMessage[] };
  return body.messages ?? [];
}

/** Poll until a message arrives, because SMTP delivery is asynchronous. */
export async function waitForEmail(
  recipient: string,
  predicate: (message: MailpitMessage) => boolean = () => true,
  timeoutMs = 10_000,
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matches = (await mailpitSearch(recipient)).filter(predicate);
    if (matches.length > 0) return matches[0] as MailpitMessage;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No email for ${recipient} within ${String(timeoutMs)}ms`);
}

/** Fetch the plain-text body of a captured message. */
export async function mailpitBody(id: string): Promise<string> {
  const response = await fetch(`${MAILPIT_API}/api/v1/message/${id}`);
  const body = (await response.json()) as { Text?: string; HTML?: string };
  return `${body.Text ?? ''}\n${body.HTML ?? ''}`;
}

/** Extract the single-use token from a verification or reset link. */
export function extractToken(body: string): string {
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(body);
  if (match?.[1] === undefined) {
    throw new Error('No token found in email body');
  }
  return match[1];
}

export async function deleteAllMail(): Promise<void> {
  await fetch(`${MAILPIT_API}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined);
}

export function uniqueEmail(label: string): string {
  return `${label}-${randomBytes(6).toString('hex')}@example.invalid`;
}

export const STRONG_PASSWORD = 'ripe-avocado-lantern-7731';
