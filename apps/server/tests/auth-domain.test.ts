import { describe, expect, it } from 'vitest';
import { assessPassword, assessStrength } from '../src/domain/auth/password-policy.js';
import {
  EMAIL_VERIFICATION_TTL_HOURS,
  PASSWORD_RESET_TTL_HOURS,
  expiryFromNow,
  generateToken,
  hashToken,
  isExpired,
  tokenHashesMatch,
} from '../src/domain/auth/tokens.js';
import {
  ARGON2ID_PARAMETERS,
  Argon2PasswordHasher,
  parseDigest,
} from '../src/infrastructure/auth/argon2-password-hasher.js';
import { LocalListBreachChecker } from '../src/infrastructure/auth/breach-checker.js';
import {
  budgetDayKey,
  CRITICAL_RESERVE,
  SIDE_EFFECT_CAP,
} from '../src/infrastructure/redis/email-budget.js';
import { summariseUserAgent } from '../src/application/auth/session-service.js';

describe('password policy (blueprint 4.2)', () => {
  it('requires at least 12 characters', () => {
    expect(assessPassword('short').acceptable).toBe(false);
    expect(assessPassword('elevenchars').acceptable).toBe(false);
    expect(assessPassword('twelvechars!').acceptable).toBe(true);
  });

  it('rejects an over-long password, which would be a hashing DoS vector', () => {
    expect(assessPassword('a1!'.repeat(200)).acceptable).toBe(false);
  });

  it('rejects common passwords that are long enough to pass the length rule', () => {
    // This is the gap a length-only check leaves open.
    expect('password1234'.length).toBeGreaterThanOrEqual(12);
    expect(assessPassword('password1234').acceptable).toBe(false);
    expect(assessPassword('PASSWORD1234').acceptable).toBe(false);
  });

  it('rejects a single repeated character', () => {
    expect(assessPassword('aaaaaaaaaaaaaaa').acceptable).toBe(false);
  });

  it('rejects sequential runs in either direction', () => {
    expect(assessPassword('abcdefghijklm').acceptable).toBe(false);
    expect(assessPassword('mlkjihgfedcba').acceptable).toBe(false);
  });

  it('rejects a password containing the email local part', () => {
    const result = assessPassword('alexander-rocks-99', 'alexander@example.invalid');
    expect(result.acceptable).toBe(false);
    expect(result.problems.join(' ')).toContain('email');
  });

  it('never echoes the password back in its problems', () => {
    const secret = 'password1234';
    for (const problem of assessPassword(secret).problems) {
      expect(problem).not.toContain(secret);
    }
  });

  it('reports a strength band as feedback without gating on composition', () => {
    expect(assessStrength('aaaa')).toBe('weak');
    expect(assessStrength('correct-horse-battery-staple-42')).toBe('strong');
    // Composition alone does not make a password unacceptable.
    expect(assessPassword('lowercaseonlyletters').acceptable).toBe(true);
  });
});

describe('single-use tokens (blueprint 17)', () => {
  it('generates high-entropy, url-safe, unique tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBeGreaterThanOrEqual(40);
    }
  });

  it('hashes deterministically and never returns the plaintext', () => {
    const token = generateToken();
    const hashed = hashToken(token);
    expect(hashed).toBe(hashToken(token));
    expect(hashed).not.toBe(token);
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
  });

  it('compares hashes in constant time and rejects mismatches', () => {
    const a = hashToken('one');
    const b = hashToken('two');
    expect(tokenHashesMatch(a, a)).toBe(true);
    expect(tokenHashesMatch(a, b)).toBe(false);
    expect(tokenHashesMatch(a, 'short')).toBe(false);
  });

  it('applies the documented expiry windows', () => {
    const now = new Date('2026-08-28T00:00:00.000Z');
    const verify = expiryFromNow(now, EMAIL_VERIFICATION_TTL_HOURS);
    const reset = expiryFromNow(now, PASSWORD_RESET_TTL_HOURS);

    expect(verify.toISOString()).toBe('2026-08-29T00:00:00.000Z');
    expect(reset.toISOString()).toBe('2026-08-28T01:00:00.000Z');

    expect(isExpired(reset, now)).toBe(false);
    expect(isExpired(reset, new Date('2026-08-28T01:00:01.000Z'))).toBe(true);
    // Exactly at the boundary counts as expired.
    expect(isExpired(reset, new Date('2026-08-28T01:00:00.000Z'))).toBe(true);
  });
});

describe('Argon2id hashing (blueprint 4.2)', () => {
  const hasher = new Argon2PasswordHasher();

  it('uses the recommended parameters', () => {
    expect(ARGON2ID_PARAMETERS.memoryCost).toBe(65_536);
    expect(ARGON2ID_PARAMETERS.timeCost).toBe(3);
    expect(ARGON2ID_PARAMETERS.parallelism).toBe(4);
    expect(ARGON2ID_PARAMETERS.outputLen).toBe(32);
  });

  it('produces an argon2id PHC digest carrying those parameters', async () => {
    const digest = await hasher.hash('correct horse battery staple');
    expect(digest.startsWith('$argon2id$v=19$m=65536,t=3,p=4$')).toBe(true);

    const parsed = parseDigest(digest);
    expect(parsed?.algorithm).toBe('argon2id');
    expect(parsed?.version).toBe(19);
    expect(parsed?.memoryCost).toBe(65_536);
  }, 30_000);

  it('verifies the correct password and rejects a wrong one', async () => {
    const digest = await hasher.hash('a-sufficiently-long-password');
    expect(await hasher.verify(digest, 'a-sufficiently-long-password')).toBe(true);
    expect(await hasher.verify(digest, 'a-sufficiently-long-passworD')).toBe(false);
  }, 30_000);

  it('salts, so the same password hashes differently each time', async () => {
    const [first, second] = await Promise.all([
      hasher.hash('same-password-here'),
      hasher.hash('same-password-here'),
    ]);
    expect(first).not.toBe(second);
  }, 30_000);

  it('returns false rather than throwing on a malformed digest', async () => {
    expect(await hasher.verify('not-a-digest', 'anything')).toBe(false);
    expect(await hasher.verify('', 'anything')).toBe(false);
  });

  it('flags weaker stored parameters for rehash, and leaves current ones alone', async () => {
    const current = await hasher.hash('a-sufficiently-long-password');
    expect(hasher.needsRehash(current)).toBe(false);

    expect(hasher.needsRehash('$argon2id$v=19$m=4096,t=3,p=4$c2FsdA$aGFzaA')).toBe(true);
    expect(hasher.needsRehash('$argon2id$v=19$m=65536,t=1,p=4$c2FsdA$aGFzaA')).toBe(true);
    expect(hasher.needsRehash('$argon2i$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA')).toBe(true);
    expect(hasher.needsRehash('garbage')).toBe(true);
  }, 30_000);
});

describe('breach checking (blueprint 4.2)', () => {
  it('blocks a known breached password offline, with no network access', async () => {
    const checker = new LocalListBreachChecker();
    expect(await checker.isBreached('password1234')).toBe(true);
    expect(await checker.isBreached('PassWord1234')).toBe(true);
    expect(await checker.isBreached('a-genuinely-unusual-passphrase-42')).toBe(false);
  });
});

describe('email budget (blueprint 5.3)', () => {
  it('reserves 100 of 300 for critical mail, capping side effects at 200', () => {
    expect(CRITICAL_RESERVE).toBe(100);
    expect(SIDE_EFFECT_CAP).toBe(200);
  });

  it('keys the window by UTC day so it is deterministic', () => {
    expect(budgetDayKey(new Date('2026-08-28T23:59:59.000Z'))).toBe('2026-08-28');
    expect(budgetDayKey(new Date('2026-08-29T00:00:00.000Z'))).toBe('2026-08-29');
  });
});

describe('user-agent summarising (blueprint 9.4)', () => {
  it('reduces a user agent to a coarse, non-fingerprintable label', () => {
    expect(
      summariseUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      ),
    ).toBe('Chrome on Windows');
    expect(summariseUserAgent('Mozilla/5.0 (Macintosh) Firefox/121.0')).toBe('Firefox on macOS');
    expect(summariseUserAgent(undefined)).toBe('Unknown device');
  });

  it('never retains the raw user agent string', () => {
    const raw = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.6099.71 Safari/537.36';
    const summary = summariseUserAgent(raw);
    expect(summary.length).toBeLessThan(40);
    expect(summary).not.toContain('6099');
  });
});
