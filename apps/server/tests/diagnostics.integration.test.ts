import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  STRONG_PASSWORD,
  TestClient,
  createAuthHarness,
  extractToken,
  mailpitBody,
  uniqueEmail,
  waitForEmail,
  type AuthHarness,
} from './helpers/auth-harness.js';
import { QUEUE_NAMES } from '../src/infrastructure/queue/queues.js';

/**
 * The protected operator diagnostics surface (blueprint 16.4).
 *
 * Two questions, and the first one matters more: who can read this. It crosses
 * every tenant, so an authorisation mistake here is not a tenancy bug in one
 * workspace - it is every workspace's queue depth and dead-letter count handed
 * to whoever asked.
 *
 * The second is whether it reports the seven things section 16.4 names.
 */

let harness: AuthHarness;
/** The address the harness is told is an operator. Not a credential. */
const OPERATOR = uniqueEmail('operator');
/**
 * Registered once and reused.
 *
 * A verification token is single use, so registering the same operator per test
 * would fail on the second one - which is the account-security property working
 * as designed and has nothing to teach this file.
 */
let operator: TestClient;

beforeAll(async () => {
  harness = await createAuthHarness({ operatorEmails: [OPERATOR] });
  operator = await signedIn(OPERATOR);
}, 180_000);

afterAll(async () => {
  await harness?.teardown();
});

async function signedIn(email: string): Promise<TestClient> {
  const api = new TestClient(harness.baseUrl);
  await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
  const message = await waitForEmail(email, (m) => m.Subject.includes('Confirm'));
  const token = extractToken(await mailpitBody(message.ID));
  expect((await api.post('/api/v1/auth/verify', { token })).status).toBe(200);
  expect((await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD })).status).toBe(
    200,
  );
  return api;
}

describe('who may read the diagnostics - EXIT GATE', () => {
  it('refuses an anonymous caller', async () => {
    const response = await new TestClient(harness.baseUrl).get('/api/v1/diagnostics');
    expect(response.status).toBe(401);
  });

  it('answers a signed-in NON-operator with 404, not 403', async () => {
    /**
     * A 403 would confirm the endpoint exists to anybody with an account, which
     * is the same enumeration problem blueprint 10.3 solves with generic auth
     * responses everywhere else. There is no reason to tell somebody who may
     * not use a surface that the surface is there.
     */
    const ordinary = await signedIn(uniqueEmail('not-operator'));
    const response = await ordinary.get('/api/v1/diagnostics');
    expect(response.status).toBe(404);
    expect((response.body as { error: { code: string } }).error.code).toBe('not_found');
  }, 90_000);

  it('answers the operator', async () => {
    expect((await operator.get('/api/v1/diagnostics')).status).toBe(200);
  }, 90_000);
});

describe('what the diagnostics report (blueprint 16.4)', () => {
  it('carries every figure section 16.4 asks for', async () => {
    const snapshot = (await operator.get('/api/v1/diagnostics')).body as {
      queues: { name: string; waiting: number; oldestWaitingAgeMs: number | null }[];
      deadLetters: { total: number; unalerted: number };
      email: { dailyBudget: number; sideEffectCap: number; sideEffectUsedToday: number };
      redis: { commandsProcessed: number | null };
      mongo: { name: string; status: string; detail?: string }[];
      retention: { lastSweepAt: string | null };
      demo: { seededAt: string | null; resetsAt: string | null };
      release: string;
    };

    /**
     * Every queue family that EXISTS, each with a depth and the age of its
     * oldest waiting job - the figure that means "behind" in a way a depth
     * alone does not.
     *
     * Asserted against `QUEUE_NAMES` rather than against a literal count, and
     * that is not laziness. Writing `9` here to match blueprint 12.1's list is
     * what a reader would expect, and it would be wrong: this codebase has
     * eight of the nine, because "authentication/privacy email" was never given
     * a queue and those messages are still sent inline. Recorded in EVIDENCE.md
     * as an open gap rather than papered over with a number that happens to
     * match the specification.
     */
    expect(snapshot.queues.map((queue) => queue.name).sort()).toEqual(
      Object.values(QUEUE_NAMES).slice().sort(),
    );
    for (const queue of snapshot.queues) {
      expect(typeof queue.waiting).toBe('number');
      expect(queue).toHaveProperty('oldestWaitingAgeMs');
    }

    expect(snapshot.deadLetters.total).toBeGreaterThanOrEqual(0);
    expect(snapshot.email.dailyBudget).toBe(300);
    expect(snapshot.email.sideEffectCap).toBeLessThan(snapshot.email.dailyBudget);
    expect(snapshot.mongo.find((probe) => probe.name === 'migrations')?.status).toBe('up');
    expect(snapshot.retention).toHaveProperty('lastSweepAt');
    expect(snapshot.demo).toHaveProperty('resetsAt');
    expect(snapshot.release).toBe('test');
  }, 120_000);

  it('names no tenant, no contact, and no captured value', async () => {
    /**
     * The one property that makes a cross-tenant view acceptable at all. Every
     * figure in it is an aggregate; nothing identifies whose work produced it.
     */
    const raw = JSON.stringify((await operator.get('/api/v1/diagnostics')).body);

    expect(raw).not.toMatch(/[0-9a-f]{24}/);
    expect(raw).not.toContain('@');
  }, 90_000);
});

describe('the surface is closed when no operator is configured', () => {
  it('refuses everybody, including a signed-in user, on a default deployment', async () => {
    /**
     * The default is empty, and an operator view that defaults to open is a
     * data breach with a changelog entry. Proven with a second harness whose
     * allowlist was never set, which is the state of a fresh deployment.
     */
    const closed = await createAuthHarness();
    try {
      const api = new TestClient(closed.baseUrl);
      const email = uniqueEmail('nobody');
      await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
      const message = await waitForEmail(email, (m) => m.Subject.includes('Confirm'));
      const token = extractToken(await mailpitBody(message.ID));
      await api.post('/api/v1/auth/verify', { token });
      await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });

      expect((await api.get('/api/v1/diagnostics')).status).toBe(404);
    } finally {
      await closed.teardown();
    }
  }, 180_000);
});
