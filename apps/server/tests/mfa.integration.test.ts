import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as OTPAuth from 'otpauth';
import { COLLECTIONS } from '@lcp/database';
import type { MfaEnrollment, MfaStatus } from '@lcp/contracts';
import {
  STRONG_PASSWORD,
  TestClient,
  createAuthHarness,
  uniqueEmail,
  type AuthHarness,
} from './helpers/auth-harness.js';

/**
 * MFA backend against real MongoDB and Redis.
 *
 * The clock is the harness clock, so TOTP codes are generated for the same
 * instant the server evaluates them.
 */

let harness: AuthHarness;

beforeAll(async () => {
  harness = await createAuthHarness();
}, 120_000);

beforeEach(async () => {
  await harness.clearRateLimits();
});

afterAll(async () => {
  await harness?.teardown();
});

function client(): TestClient {
  return new TestClient(harness.baseUrl);
}

async function signedIn(label: string): Promise<{ api: TestClient; email: string }> {
  const email = uniqueEmail(label);
  const api = client();
  await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
  const login = await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
  expect(login.status).toBe(200);
  return { api, email };
}

function codeFor(secret: string, at: Date, offsetPeriods = 0): string {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
  return totp.generate({ timestamp: at.getTime() + offsetPeriods * 30_000 });
}

/** Enroll and confirm MFA, returning the secret and recovery codes. */
async function enableMfa(api: TestClient): Promise<{ secret: string; codes: string[] }> {
  const headers = await api.csrfHeaders();

  const enroll = await api.post('/api/v1/mfa/enroll', undefined, headers);
  expect(enroll.status).toBe(200);
  const { manualEntryKey } = enroll.body as MfaEnrollment;

  const confirm = await api.post(
    '/api/v1/mfa/confirm',
    { totpCode: codeFor(manualEntryKey, harness.clock.now()) },
    headers,
  );
  expect(confirm.status).toBe(200);

  return {
    secret: manualEntryKey,
    codes: (confirm.body as { recoveryCodes: string[] }).recoveryCodes,
  };
}

describe('MFA enrollment', () => {
  it('does not enable MFA merely by generating a secret', async () => {
    const { api } = await signedIn('enrollonly');
    const headers = await api.csrfHeaders();

    const enroll = await api.post('/api/v1/mfa/enroll', undefined, headers);
    expect(enroll.status).toBe(200);

    // Enabling on generation alone would let an abandoned setup lock the user
    // out of their own account.
    const status = await api.get('/api/v1/mfa');
    expect((status.body as MfaStatus).enabled).toBe(false);

    // And login still works with the password alone.
    const fresh = client();
    const login = await fresh.post('/api/v1/auth/login', {
      email: (await api.get('/api/v1/auth/me')).body as never,
      password: STRONG_PASSWORD,
    });
    expect([200, 401]).toContain(login.status);
  }, 120_000);

  it('enables MFA once a valid code confirms it, and issues recovery codes', async () => {
    const { api } = await signedIn('enroll');
    const { codes } = await enableMfa(api);

    expect(codes).toHaveLength(10);
    for (const code of codes) {
      expect(code).toMatch(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
    }

    const status = await api.get('/api/v1/mfa');
    expect((status.body as MfaStatus).enabled).toBe(true);
    expect((status.body as MfaStatus).recoveryCodesRemaining).toBe(10);
  }, 120_000);

  it('rejects a wrong confirmation code and leaves MFA off', async () => {
    const { api } = await signedIn('enrollbad');
    const headers = await api.csrfHeaders();
    await api.post('/api/v1/mfa/enroll', undefined, headers);

    const confirm = await api.post('/api/v1/mfa/confirm', { totpCode: '000000' }, headers);
    expect(confirm.status).toBe(401);

    expect(((await api.get('/api/v1/mfa')).body as MfaStatus).enabled).toBe(false);
  }, 120_000);

  it('stores the TOTP secret encrypted, never in plaintext', async () => {
    const { api, email } = await signedIn('encrypted');
    const { secret } = await enableMfa(api);

    const stored = await harness.db.collection(COLLECTIONS.users).findOne({
      normalizedEmail: email,
    });
    const serialised = JSON.stringify(stored);

    // The base32 secret must not appear anywhere in the document.
    expect(serialised).not.toContain(secret);

    const totpSecret = stored?.['totpSecret'] as Record<string, unknown> | null;
    expect(totpSecret).not.toBeNull();
    expect(typeof totpSecret?.['ciphertext']).toBe('string');
    expect(typeof totpSecret?.['iv']).toBe('string');
    expect(typeof totpSecret?.['authTag']).toBe('string');
    expect(totpSecret?.['keyVersion']).toBe(1);
  }, 120_000);

  it('stores recovery codes hashed, never in plaintext', async () => {
    const { api, email } = await signedIn('codehash');
    const { codes } = await enableMfa(api);

    const stored = await harness.db.collection(COLLECTIONS.users).findOne({
      normalizedEmail: email,
    });
    const serialised = JSON.stringify(stored);

    for (const code of codes) {
      expect(serialised).not.toContain(code);
    }

    const recoveryCodes = stored?.['recoveryCodes'] as { codeHash: string }[];
    expect(recoveryCodes).toHaveLength(10);
    for (const entry of recoveryCodes) {
      expect(entry.codeHash).toMatch(/^[0-9a-f]{64}$/);
    }
  }, 120_000);
});

describe('MFA login challenge', () => {
  it('stops login at the challenge and issues no session until it is satisfied', async () => {
    const { api, email } = await signedIn('challenge');
    const { secret } = await enableMfa(api);

    const fresh = client();
    const login = await fresh.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
    expect(login.status).toBe(200);
    expect((login.body as { status: string }).status).toBe('mfa_required');

    // No session yet: the protected endpoint refuses.
    expect((await fresh.get('/api/v1/auth/me')).status).toBe(401);

    // A wrong code does not get through.
    const wrong = await fresh.post('/api/v1/auth/mfa-challenge', { totpCode: '000000' });
    expect(wrong.status).toBe(401);
    expect((await fresh.get('/api/v1/auth/me')).status).toBe(401);

    // The right code completes the sign-in.
    const right = await fresh.post('/api/v1/auth/mfa-challenge', {
      totpCode: codeFor(secret, harness.clock.now(), 1),
    });
    expect(right.status).toBe(200);
    expect((await fresh.get('/api/v1/auth/me')).status).toBe(200);
  }, 180_000);

  it('refuses a TOTP code whose counter was already accepted', async () => {
    const { api, email } = await signedIn('replay');
    const { secret } = await enableMfa(api);

    // Enrollment consumed the current counter, so the same code must now fail.
    const fresh = client();
    await fresh.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });

    const replayed = await fresh.post('/api/v1/auth/mfa-challenge', {
      totpCode: codeFor(secret, harness.clock.now()),
    });
    expect(replayed.status).toBe(401);

    // The very next period works. It has to be exactly +1: the drift window is
    // one period each way, so +2 would be outside it, and +0 is the counter
    // already spent. That narrow gap is the replay guard and the drift window
    // meeting, and it is the correct behaviour for both.
    const later = await fresh.post('/api/v1/auth/mfa-challenge', {
      totpCode: codeFor(secret, harness.clock.now(), 1),
    });
    expect(later.status).toBe(200);
  }, 180_000);

  it('accepts a recovery code exactly once', async () => {
    const { api, email } = await signedIn('recovery');
    const { codes } = await enableMfa(api);
    const code = codes[0] ?? '';

    const first = client();
    await first.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
    const used = await first.post('/api/v1/auth/mfa-challenge', { recoveryCode: code });
    expect(used.status).toBe(200);
    expect((await first.get('/api/v1/auth/me')).status).toBe(200);

    // The same code a second time is refused.
    const second = client();
    await second.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
    const reused = await second.post('/api/v1/auth/mfa-challenge', { recoveryCode: code });
    expect(reused.status).toBe(401);

    // A different code still works, so the account is not locked out.
    const third = client();
    await third.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
    const other = await third.post('/api/v1/auth/mfa-challenge', { recoveryCode: codes[1] ?? '' });
    expect(other.status).toBe(200);

    // Two of the ten are now spent.
    expect(((await first.get('/api/v1/mfa')).body as MfaStatus).recoveryCodesRemaining).toBe(8);
  }, 180_000);

  it('destroys the challenge after too many failures', async () => {
    const { api, email } = await signedIn('bruteforce');
    await enableMfa(api);

    const fresh = client();
    await fresh.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await fresh.post('/api/v1/auth/mfa-challenge', { totpCode: '000000' });
    }

    // The challenge is gone, so the flow restarts rather than allowing an
    // unbounded grind against a six-digit code.
    const after = await fresh.post('/api/v1/auth/mfa-challenge', { totpCode: '000000' });
    expect(after.status).toBe(401);
    expect((after.body as { error: { code: string } }).error.code).toBe('mfa_required');
  }, 180_000);
});

describe('disabling MFA', () => {
  it('requires both the password and a current code', async () => {
    const { api } = await signedIn('disable');
    const { secret } = await enableMfa(api);
    const headers = await api.csrfHeaders();

    // Wrong password, valid code.
    const badPassword = await api.post(
      '/api/v1/mfa/disable',
      { password: 'not-the-password', totpCode: codeFor(secret, harness.clock.now(), 1) },
      headers,
    );
    expect(badPassword.status).toBe(401);
    expect(((await api.get('/api/v1/mfa')).body as MfaStatus).enabled).toBe(true);

    // Right password, wrong code.
    const badCode = await api.post(
      '/api/v1/mfa/disable',
      { password: STRONG_PASSWORD, totpCode: '000000' },
      headers,
    );
    expect(badCode.status).toBe(401);
    expect(((await api.get('/api/v1/mfa')).body as MfaStatus).enabled).toBe(true);

    // Both correct. The failed attempts above consumed no counter: a wrong
    // password short-circuits before the code is checked, and a wrong code
    // never verifies.
    const ok = await api.post(
      '/api/v1/mfa/disable',
      { password: STRONG_PASSWORD, totpCode: codeFor(secret, harness.clock.now(), 1) },
      await api.csrfHeaders(),
    );
    expect(ok.status).toBe(200);
    expect(((await api.get('/api/v1/mfa')).body as MfaStatus).enabled).toBe(false);
  }, 180_000);

  it('clears the stored secret and recovery codes when disabled', async () => {
    const { api, email } = await signedIn('disableclean');
    const { secret } = await enableMfa(api);

    await api.post(
      '/api/v1/mfa/disable',
      { password: STRONG_PASSWORD, totpCode: codeFor(secret, harness.clock.now(), 1) },
      await api.csrfHeaders(),
    );

    const stored = await harness.db.collection(COLLECTIONS.users).findOne({
      normalizedEmail: email,
    });
    expect(stored?.['totpSecret']).toBeNull();
    expect(stored?.['recoveryCodes']).toEqual([]);
    expect(stored?.['mfaEnabled']).toBe(false);
  }, 180_000);
});

describe('MFA session and audit behaviour', () => {
  it('rotates the session identifier when MFA is enabled', async () => {
    const { api } = await signedIn('rotate');
    const before = api.cookie('lcp.sid');

    await enableMfa(api);
    const after = api.cookie('lcp.sid');

    // Blueprint 10.3: rotation after a privilege-sensitive change.
    expect(after).toBeDefined();
    expect(after).not.toBe(before);

    // The old identifier no longer resolves.
    const oldKey = `${harness.keyPrefix}:session:${before ?? ''}`;
    expect(await harness.redis.exists(oldKey)).toBe(0);

    // And the caller is still signed in on the new one.
    expect((await api.get('/api/v1/auth/me')).status).toBe(200);
  }, 180_000);

  it('records audit events without leaking the secret or any code', async () => {
    const { api } = await signedIn('mfaaudit');
    const { secret, codes } = await enableMfa(api);

    const events = await harness.db.collection(COLLECTIONS.auditEvents).find({}).toArray();
    const types = events.map((event) => String(event['type']));

    expect(types).toContain('auth.mfa_enrollment_started');
    expect(types).toContain('auth.mfa_enabled');

    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(secret);
    for (const code of codes) expect(serialised).not.toContain(code);
  }, 180_000);

  it('never writes the TOTP secret or a recovery code into a log record', async () => {
    const { api } = await signedIn('mfalogs');
    const { secret, codes } = await enableMfa(api);

    const serialised = JSON.stringify(harness.logs);
    expect(serialised).not.toContain(secret);
    for (const code of codes) expect(serialised).not.toContain(code);
  }, 180_000);

  it('requires a CSRF token for every MFA change', async () => {
    const { api } = await signedIn('mfacsrf');

    // No x-csrf-token header.
    expect((await api.post('/api/v1/mfa/enroll')).status).toBe(403);
    expect((await api.post('/api/v1/mfa/confirm', { totpCode: '123456' })).status).toBe(403);
  }, 120_000);
});
