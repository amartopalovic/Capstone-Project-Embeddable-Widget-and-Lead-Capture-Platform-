import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COLLECTIONS } from '@lcp/database';
import type { SessionSummary } from '@lcp/contracts';
import {
  STRONG_PASSWORD,
  TestClient,
  createAuthHarness,
  uniqueEmail,
  type AuthHarness,
} from './helpers/auth-harness.js';

/**
 * Session lifetime, revocation, CSRF, throttling, audit, and email budget.
 *
 * Real Redis and MongoDB throughout. The clock is driven explicitly so the
 * 7-day idle and 30-day absolute lifetimes can actually be crossed.
 */

let harness: AuthHarness;

beforeAll(async () => {
  harness = await createAuthHarness();
}, 120_000);

beforeEach(async () => {
  // Every request comes from 127.0.0.1, so throttle counters are reset between
  // tests. The throttle tests below clear and then deliberately exhaust them.
  await harness.clearRateLimits();
});

afterAll(async () => {
  await harness?.teardown();
});

function client(): TestClient {
  return new TestClient(harness.baseUrl);
}

/** Register and sign in, returning a client holding a live session. */
async function signedIn(label: string): Promise<{ api: TestClient; email: string }> {
  const email = uniqueEmail(label);
  const api = client();
  await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
  const login = await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
  expect(login.status).toBe(200);
  return { api, email };
}

describe('session cookie and CSRF (blueprint 10.3)', () => {
  it('issues an HttpOnly, path-scoped, SameSite session cookie', async () => {
    const { api } = await signedIn('cookie');
    void api;

    // Inspect the raw Set-Cookie rather than the parsed jar.
    const fresh = client();
    const email = uniqueEmail('cookieflags');
    await fresh.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
    const login = await fresh.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });

    const setCookie = login.headers.getSetCookie().find((entry) => entry.startsWith('lcp.sid='));
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/');
    expect(setCookie?.toLowerCase()).toContain('samesite=lax');
    // Secure is off only because the test server is plain HTTP; in production
    // NODE_ENV drives it on.
  }, 120_000);

  it('rejects an authenticated state-changing request without a CSRF token', async () => {
    const { api } = await signedIn('csrf');

    // No x-csrf-token header.
    const denied = await api.post('/api/v1/sessions/revoke-all');
    expect(denied.status).toBe(403);
  }, 120_000);

  it('accepts the same request once a valid CSRF token is supplied', async () => {
    const { api } = await signedIn('csrfok');
    const headers = await api.csrfHeaders();

    const allowed = await api.post('/api/v1/sessions/revoke-all', undefined, headers);
    expect(allowed.status).toBe(200);
  }, 120_000);
});

describe('session listing and revocation (blueprint 4.2)', () => {
  it('lists only the calling user sessions and marks the current one', async () => {
    const email = uniqueEmail('list');
    const first = client();
    await first.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
    await first.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });

    // A second sign-in from another client is a second device.
    const second = client();
    await second.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });

    const listed = await first.get('/api/v1/sessions');
    expect(listed.status).toBe(200);
    const sessions = (listed.body as { sessions: SessionSummary[] }).sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session) => session.current)).toHaveLength(1);

    // Safe metadata only: no raw user agent, no token-like material.
    for (const session of sessions) {
      expect(session.userAgentSummary).toBe('Chrome on Windows');
      expect(JSON.stringify(session)).not.toContain('Mozilla');
    }
  }, 180_000);

  it('revokes a single session, and only that one', async () => {
    const email = uniqueEmail('revokeone');
    const first = client();
    await first.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
    await first.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });

    const second = client();
    await second.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });

    const listed = await first.get('/api/v1/sessions');
    const other = (listed.body as { sessions: SessionSummary[] }).sessions.find((s) => !s.current);
    expect(other).toBeDefined();

    const headers = await first.csrfHeaders();
    const revoked = await first.delete(`/api/v1/sessions/${other?.id ?? ''}`, headers);
    expect(revoked.status).toBe(204);

    // The revoked client is out immediately; the revoking client remains in.
    expect((await second.get('/api/v1/auth/me')).status).toBe(401);
    expect((await first.get('/api/v1/auth/me')).status).toBe(200);
  }, 180_000);

  it('cannot revoke a session belonging to another user', async () => {
    const victim = await signedIn('victim');
    const attacker = await signedIn('attacker');

    const victimSessions = await victim.api.get('/api/v1/sessions');
    const victimSessionId =
      (victimSessions.body as { sessions: SessionSummary[] }).sessions[0]?.id ?? '';

    const headers = await attacker.api.csrfHeaders();
    const attempt = await attacker.api.delete(`/api/v1/sessions/${victimSessionId}`, headers);

    // Same answer as a session that does not exist, so this cannot be used to
    // probe for valid session identifiers.
    expect(attempt.status).toBe(404);
    expect((await victim.api.get('/api/v1/auth/me')).status).toBe(200);
  }, 180_000);

  it('revokes every other session while keeping the caller signed in', async () => {
    const email = uniqueEmail('revokeall');
    const first = client();
    await first.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
    await first.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });

    const second = client();
    await second.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
    const third = client();
    await third.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });

    const headers = await first.csrfHeaders();
    const result = await first.post('/api/v1/sessions/revoke-all', undefined, headers);
    expect(result.status).toBe(200);
    expect((result.body as { revoked: number }).revoked).toBe(2);

    expect((await second.get('/api/v1/auth/me')).status).toBe(401);
    expect((await third.get('/api/v1/auth/me')).status).toBe(401);
    expect((await first.get('/api/v1/auth/me')).status).toBe(200);
  }, 180_000);

  it('signs out everywhere including the caller when asked', async () => {
    const { api } = await signedIn('revokeeverything');
    const headers = await api.csrfHeaders();

    const result = await api.post(
      '/api/v1/sessions/revoke-all?includeCurrent=true',
      undefined,
      headers,
    );
    expect(result.status).toBe(200);
    expect((await api.get('/api/v1/auth/me')).status).toBe(401);
  }, 120_000);

  it('logout destroys the session in Redis immediately', async () => {
    const { api } = await signedIn('logout');
    const sessionId = api.cookie('lcp.sid') ?? '';
    expect(sessionId).not.toBe('');

    const key = `${harness.keyPrefix}:session:${sessionId}`;
    expect(await harness.redis.exists(key)).toBe(1);

    expect((await api.post('/api/v1/auth/logout')).status).toBe(204);

    // Deleted, not merely flagged: revocation is immediate (section 10.3).
    expect(await harness.redis.exists(key)).toBe(0);
    expect((await api.get('/api/v1/auth/me')).status).toBe(401);
  }, 120_000);
});

describe('session lifetimes (blueprint 4.2: 7-day idle, 30-day absolute)', () => {
  it('expires a session after 7 days of inactivity', async () => {
    const { api } = await signedIn('idle');
    expect((await api.get('/api/v1/auth/me')).status).toBe(200);

    harness.clock.advanceDays(6);
    // Still inside the idle window, and this request slides it forward.
    expect((await api.get('/api/v1/auth/me')).status).toBe(200);

    harness.clock.advanceDays(6);
    // Would have expired at day 7 from login, but activity refreshed it.
    expect((await api.get('/api/v1/auth/me')).status).toBe(200);

    harness.clock.advanceDays(8);
    expect((await api.get('/api/v1/auth/me')).status).toBe(401);
  }, 180_000);

  it('expires a session at the 30-day absolute maximum despite continuous activity', async () => {
    const { api } = await signedIn('absolute');

    // Stay active every few days, so the idle window never lapses.
    for (let day = 0; day < 30; day += 5) {
      harness.clock.advanceDays(5);
      const response = await api.get('/api/v1/auth/me');
      if (response.status !== 200) break;
    }

    harness.clock.advanceDays(1);
    // The absolute cap is not extended by activity.
    expect((await api.get('/api/v1/auth/me')).status).toBe(401);
  }, 180_000);
});

describe('auth throttles (blueprint 10.3)', () => {
  it('rate-limits repeated failed logins for one account', async () => {
    const email = uniqueEmail('throttle');
    await client().post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await client().post('/api/v1/auth/login', {
        email,
        password: `wrong-password-${String(attempt)}`,
      });
      statuses.push(response.status);
    }

    // The per-account rule allows 5 in its window; the rest are refused.
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 5).every((status) => status === 401)).toBe(true);
  }, 180_000);

  it('rate-limits password-reset requests per email', async () => {
    const email = uniqueEmail('resetthrottle');
    await client().post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await client().post('/api/v1/auth/password/reset-request', { email });
      statuses.push(response.status);
    }

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  }, 180_000);

  it('returns a Retry-After header when throttled', async () => {
    const email = uniqueEmail('retryafter');
    let retryAfter: string | null = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await client().post('/api/v1/auth/verify/resend', { email });
      if (response.status === 429) {
        retryAfter = response.headers.get('retry-after');
        break;
      }
    }
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  }, 180_000);
});

describe('audit events (blueprint 9.3) contain no credential material', () => {
  it('records registration, login, and logout with actor and correlation id', async () => {
    const { api } = await signedIn('audit');
    await api.post('/api/v1/auth/logout');

    const events = await harness.db
      .collection(COLLECTIONS.auditEvents)
      .find({})
      .sort({ occurredAt: 1 })
      .toArray();

    const types = events.map((event) => String(event['type']));
    expect(types).toContain('auth.registered');
    expect(types).toContain('auth.logged_in');
    expect(types).toContain('auth.logged_out');

    for (const event of events) {
      expect(event['actorUserId']).toBeTruthy();
      expect(typeof event['correlationId']).toBe('string');
      expect(String(event['correlationId']).length).toBeGreaterThan(0);
    }
  }, 180_000);

  it('never stores a password, token, or session id in an audit record', async () => {
    const email = uniqueEmail('auditsafe');
    const api = client();
    await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
    await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
    const sessionId = api.cookie('lcp.sid') ?? 'no-session';

    const events = await harness.db.collection(COLLECTIONS.auditEvents).find({}).toArray();
    const serialised = JSON.stringify(events);

    expect(serialised).not.toContain(STRONG_PASSWORD);
    expect(serialised).not.toContain(sessionId);
    expect(serialised).not.toContain('$argon2id$');
  }, 180_000);

  it('never writes a password, token, or session id into a log record', async () => {
    const email = uniqueEmail('logsafe');
    const api = client();
    await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
    await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
    const sessionId = api.cookie('lcp.sid') ?? 'no-session';

    const serialised = JSON.stringify(harness.logs);
    expect(serialised).not.toContain(STRONG_PASSWORD);
    expect(serialised).not.toContain(sessionId);
    expect(serialised).not.toContain('$argon2id$');
  }, 180_000);
});

describe('Brevo daily budget (blueprint 5.3)', () => {
  it('counts critical auth mail against the daily allowance', async () => {
    const before = await harness.deps.emailBudget.usage(harness.clock.now());
    await client().post('/api/v1/auth/register', {
      email: uniqueEmail('budget'),
      password: STRONG_PASSWORD,
    });
    const after = await harness.deps.emailBudget.usage(harness.clock.now());

    expect(after.total).toBe(before.total + 1);
    // Auth mail draws on the reserve, not the side-effect allowance.
    expect(after.sideEffect).toBe(before.sideEffect);
  }, 120_000);

  it('caps side-effect mail at 200 while critical mail may still send', async () => {
    const budget = harness.deps.emailBudget;
    const now = new Date('2026-12-01T00:00:00.000Z');

    // Burn the entire side-effect allowance.
    for (let index = 0; index < 200; index += 1) {
      const decision = await budget.tryConsume('side_effect', now);
      expect(decision.allowed).toBe(true);
    }

    // The 201st side effect is refused...
    const refused = await budget.tryConsume('side_effect', now);
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toBe('budget_exhausted');

    // ...while critical mail still has its reserved 100.
    const critical = await budget.tryConsume('critical', now);
    expect(critical.allowed).toBe(true);
  }, 120_000);

  it('refuses everything once the full 300 allowance is gone', async () => {
    const budget = harness.deps.emailBudget;
    const now = new Date('2026-12-02T00:00:00.000Z');

    for (let index = 0; index < 300; index += 1) {
      expect((await budget.tryConsume('critical', now)).allowed).toBe(true);
    }

    expect((await budget.tryConsume('critical', now)).allowed).toBe(false);
    expect((await budget.tryConsume('side_effect', now)).allowed).toBe(false);

    // A new day restores the allowance.
    const tomorrow = new Date('2026-12-03T00:00:00.000Z');
    expect((await budget.tryConsume('critical', tomorrow)).allowed).toBe(true);
  }, 120_000);
});
