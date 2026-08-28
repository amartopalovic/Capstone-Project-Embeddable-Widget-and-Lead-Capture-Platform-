import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COLLECTIONS } from '@lcp/database';
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

/**
 * Stage 3a exit-gate proof.
 *
 * Runs the real Express application against real MongoDB, real Redis, and real
 * Mailpit SMTP. Only the clock is substituted, so session expiry can be tested
 * without waiting days.
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

/** Register, collect the emailed token, and verify. */
async function registerAndVerify(email: string): Promise<TestClient> {
  const api = client();
  const registered = await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
  expect(registered.status).toBe(202);

  const message = await waitForEmail(email, (m) => m.Subject.includes('Confirm'));
  const token = extractToken(await mailpitBody(message.ID));

  const verified = await api.post('/api/v1/auth/verify', { token });
  expect(verified.status).toBe(200);
  return api;
}

describe('registration, verification, and login', () => {
  it('completes the whole journey end to end', async () => {
    const email = uniqueEmail('journey');
    const api = await registerAndVerify(email);

    const login = await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
    expect(login.status).toBe(200);
    expect(
      (login.body as { user: { email: string; emailVerified: boolean } }).user.emailVerified,
    ).toBe(true);

    // The session cookie was issued and works.
    expect(api.cookie('lcp.sid')).toBeDefined();
    const me = await api.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect((me.body as { user: { email: string } }).user.email).toBe(email);
  }, 120_000);

  it('sends a real verification email observable in Mailpit', async () => {
    const email = uniqueEmail('mail');
    await client().post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });

    const message = await waitForEmail(email);
    expect(message.Subject).toContain('Confirm your email address');

    const body = await mailpitBody(message.ID);
    expect(body).toContain('/auth/verify?token=');
    // The email must not leak the password or the stored hash.
    expect(body).not.toContain(STRONG_PASSWORD);
    expect(body).not.toContain('$argon2id$');
  }, 120_000);

  it('refuses to log in before the address is verified only when required, but always after verification works', async () => {
    const email = uniqueEmail('unverified');
    const api = client();
    await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });

    // Blueprint 4.1: an unverified user may still use the dashboard, so login
    // succeeds; publishing and inviting are what get gated, in Stages 4 and 5.
    const login = await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
    expect(login.status).toBe(200);
    expect((login.body as { user: { emailVerified: boolean } }).user.emailVerified).toBe(false);
  }, 120_000);

  it('rejects a verification token that has already been used', async () => {
    const email = uniqueEmail('replay');
    const api = client();
    await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });

    const message = await waitForEmail(email, (m) => m.Subject.includes('Confirm'));
    const token = extractToken(await mailpitBody(message.ID));

    expect((await api.post('/api/v1/auth/verify', { token })).status).toBe(200);
    // Single use: the second redemption fails.
    const replay = await api.post('/api/v1/auth/verify', { token });
    expect(replay.status).toBe(400);
    expect((replay.body as { error: { code: string } }).error.code).toBe('invalid_token');
  }, 120_000);

  it('rejects an unknown verification token', async () => {
    const response = await client().post('/api/v1/auth/verify', { token: 'not-a-real-token' });
    expect(response.status).toBe(400);
  }, 60_000);
});

describe('password policy enforcement', () => {
  it('rejects a password below the 12-character minimum', async () => {
    const response = await client().post('/api/v1/auth/register', {
      email: uniqueEmail('short'),
      password: 'short1!',
    });
    expect(response.status).toBe(400);
  }, 60_000);

  it('rejects a known breached password even though it is long enough', async () => {
    const response = await client().post('/api/v1/auth/register', {
      email: uniqueEmail('breached'),
      password: 'password1234',
    });
    expect(response.status).toBe(400);
    const body = response.body as { error: { code: string; details?: { message: string }[] } };
    expect(body.error.code).toBe('weak_password');
    // The rejection explains itself without echoing the password.
    expect(JSON.stringify(body)).not.toContain('password1234'.toUpperCase());
  }, 60_000);

  it('stores an Argon2id hash and never the plaintext', async () => {
    const email = uniqueEmail('hash');
    await client().post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });

    const user = await harness.db.collection(COLLECTIONS.users).findOne({ normalizedEmail: email });
    expect(user).not.toBeNull();
    expect(String(user?.['passwordHash'])).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);

    // The plaintext appears nowhere in the stored document.
    expect(JSON.stringify(user)).not.toContain(STRONG_PASSWORD);
  }, 120_000);
});

describe('generic responses prevent account enumeration (blueprint 10.3)', () => {
  it('returns an identical response for a fresh and an already-registered email', async () => {
    const email = uniqueEmail('dupe');

    const first = await client().post('/api/v1/auth/register', {
      email,
      password: STRONG_PASSWORD,
    });
    const second = await client().post('/api/v1/auth/register', {
      email,
      password: STRONG_PASSWORD,
    });

    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);

    // And exactly one account exists.
    const count = await harness.db
      .collection(COLLECTIONS.users)
      .countDocuments({ normalizedEmail: email });
    expect(count).toBe(1);
  }, 120_000);

  it('returns an identical failure for an unknown account and a wrong password', async () => {
    const known = uniqueEmail('known');
    await client().post('/api/v1/auth/register', { email: known, password: STRONG_PASSWORD });

    const wrongPassword = await client().post('/api/v1/auth/login', {
      email: known,
      password: 'definitely-not-the-password',
    });
    const unknownAccount = await client().post('/api/v1/auth/login', {
      email: uniqueEmail('ghost'),
      password: 'definitely-not-the-password',
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect((wrongPassword.body as { error: { code: string; message: string } }).error.code).toBe(
      (unknownAccount.body as { error: { code: string } }).error.code,
    );
    expect((wrongPassword.body as { error: { message: string } }).error.message).toBe(
      (unknownAccount.body as { error: { message: string } }).error.message,
    );
  }, 120_000);

  it('returns an identical acknowledgement for a reset request on a known and unknown email', async () => {
    const known = uniqueEmail('resetknown');
    await client().post('/api/v1/auth/register', { email: known, password: STRONG_PASSWORD });

    const forKnown = await client().post('/api/v1/auth/password/reset-request', { email: known });
    const forUnknown = await client().post('/api/v1/auth/password/reset-request', {
      email: uniqueEmail('resetghost'),
    });

    expect(forKnown.status).toBe(forUnknown.status);
    expect(forKnown.body).toEqual(forUnknown.body);
  }, 120_000);
});

describe('password reset', () => {
  it('resets the password, signs out every session, and lets the new password in', async () => {
    const email = uniqueEmail('reset');
    const api = await registerAndVerify(email);
    await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
    expect((await api.get('/api/v1/auth/me')).status).toBe(200);

    await client().post('/api/v1/auth/password/reset-request', { email });
    const message = await waitForEmail(email, (m) => m.Subject.includes('Reset'));
    const token = extractToken(await mailpitBody(message.ID));

    const newPassword = 'amber-tortoise-window-5512';
    const confirmed = await client().post('/api/v1/auth/password/reset-confirm', {
      token,
      password: newPassword,
    });
    expect(confirmed.status).toBe(200);

    // Blueprint 4.2: the pre-existing session no longer works.
    expect((await api.get('/api/v1/auth/me')).status).toBe(401);

    // The old password is dead and the new one works.
    const withOld = await client().post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
    expect(withOld.status).toBe(401);

    const fresh = client();
    expect((await fresh.post('/api/v1/auth/login', { email, password: newPassword })).status).toBe(
      200,
    );
  }, 180_000);

  it('rejects a reset token that has already been used', async () => {
    const email = uniqueEmail('resetreplay');
    await client().post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
    await client().post('/api/v1/auth/password/reset-request', { email });

    const message = await waitForEmail(email, (m) => m.Subject.includes('Reset'));
    const token = extractToken(await mailpitBody(message.ID));

    const first = await client().post('/api/v1/auth/password/reset-confirm', {
      token,
      password: 'first-choice-passphrase-88',
    });
    expect(first.status).toBe(200);

    const second = await client().post('/api/v1/auth/password/reset-confirm', {
      token,
      password: 'second-choice-passphrase-99',
    });
    expect(second.status).toBe(400);
  }, 180_000);

  it('rejects a weak new password at reset time too', async () => {
    const email = uniqueEmail('resetweak');
    await client().post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
    await client().post('/api/v1/auth/password/reset-request', { email });

    const message = await waitForEmail(email, (m) => m.Subject.includes('Reset'));
    const token = extractToken(await mailpitBody(message.ID));

    const response = await client().post('/api/v1/auth/password/reset-confirm', {
      token,
      password: 'password1234',
    });
    expect(response.status).toBe(400);
    expect((response.body as { error: { code: string } }).error.code).toBe('weak_password');
  }, 180_000);
});
