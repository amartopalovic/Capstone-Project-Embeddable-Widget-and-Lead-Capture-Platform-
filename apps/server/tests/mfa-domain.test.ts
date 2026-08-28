import { describe, expect, it } from 'vitest';
import * as OTPAuth from 'otpauth';
import { AesSecretCipher, parseMasterKey } from '../src/infrastructure/auth/aes-secret-cipher.js';
import { OtpauthTotpService } from '../src/infrastructure/auth/otpauth-totp-service.js';
import {
  generateRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  normaliseRecoveryCode,
} from '../src/domain/auth/recovery-codes.js';

/** Not a secret: a deterministic 32-byte key used only by these tests. */
const TEST_KEY = Buffer.from('unit-test-key-exactly-32-bytes!!').toString('base64');

function cipher(currentKeyVersion = 1, extraKeys: [number, string][] = []): AesSecretCipher {
  const keys = new Map<number, Buffer>([[1, parseMasterKey(TEST_KEY)]]);
  for (const [version, key] of extraKeys) keys.set(version, parseMasterKey(key));
  return new AesSecretCipher({ currentKeyVersion, keysByVersion: keys });
}

describe('AES-256-GCM secret encryption (blueprint 12.4)', () => {
  it('round-trips a secret', () => {
    const subject = cipher();
    const encrypted = subject.encrypt('JBSWY3DPEHPK3PXP');
    expect(subject.decrypt(encrypted)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('never stores the plaintext in the encrypted value', () => {
    const encrypted = cipher().encrypt('super-secret-totp-seed');
    expect(JSON.stringify(encrypted)).not.toContain('super-secret-totp-seed');
  });

  it('uses a fresh IV each time, so identical plaintext differs', () => {
    const subject = cipher();
    const first = subject.encrypt('same-value');
    const second = subject.encrypt('same-value');

    // Reusing an IV under one key catastrophically breaks GCM, so this matters.
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(subject.decrypt(first)).toBe(subject.decrypt(second));
  });

  it('records the key version, so rotation stays readable', () => {
    const encrypted = cipher().encrypt('value');
    expect(encrypted.keyVersion).toBe(1);
  });

  it('can still read a value written under an older key version', () => {
    const oldKey = Buffer.from('old-test-key-exactly-32-bytes!!!').toString('base64');
    const oldCipher = new AesSecretCipher({
      currentKeyVersion: 2,
      keysByVersion: new Map([[2, parseMasterKey(oldKey)]]),
    });
    const encrypted = oldCipher.encrypt('written-under-v2');

    // A cipher that knows both keys reads it, and writes new values under v1.
    const rotated = cipher(1, [[2, oldKey]]);
    expect(rotated.decrypt(encrypted)).toBe('written-under-v2');
    expect(rotated.encrypt('new').keyVersion).toBe(1);
  });

  it('returns null for an unknown key version rather than throwing', () => {
    const encrypted = cipher().encrypt('value');
    expect(cipher().decrypt({ ...encrypted, keyVersion: 99 })).toBeNull();
  });

  it('refuses a tampered ciphertext, because GCM is authenticated', () => {
    const subject = cipher();
    const encrypted = subject.encrypt('value');

    const flipped = Buffer.from(encrypted.ciphertext, 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;

    expect(subject.decrypt({ ...encrypted, ciphertext: flipped.toString('base64') })).toBeNull();
  });

  it('refuses a tampered authentication tag', () => {
    const subject = cipher();
    const encrypted = subject.encrypt('value');
    const badTag = Buffer.alloc(16, 7).toString('base64');
    expect(subject.decrypt({ ...encrypted, authTag: badTag })).toBeNull();
  });

  it('rejects a master key that is not 32 bytes', () => {
    expect(() => parseMasterKey(Buffer.from('too-short').toString('base64'))).toThrow(/32 bytes/);
  });

  it('refuses to construct without a key for the current version', () => {
    expect(() => new AesSecretCipher({ currentKeyVersion: 5, keysByVersion: new Map() })).toThrow(
      /No encryption key/,
    );
  });
});

describe('TOTP (RFC 6238)', () => {
  const service = new OtpauthTotpService('Lead Capture Test');

  it('enrolls with a base32 secret and an otpauth URI naming the account', () => {
    const enrollment = service.enroll('person@example.invalid');

    expect(enrollment.secret).toMatch(/^[A-Z2-7]+$/);
    expect(enrollment.secret.length).toBeGreaterThanOrEqual(32);
    expect(enrollment.otpauthUri.startsWith('otpauth://totp/')).toBe(true);
    expect(enrollment.otpauthUri).toContain('issuer=Lead%20Capture%20Test');
    expect(enrollment.otpauthUri).toContain(`secret=${enrollment.secret}`);
  });

  it('generates a different secret per enrollment', () => {
    expect(service.enroll('a@example.invalid').secret).not.toBe(
      service.enroll('b@example.invalid').secret,
    );
  });

  it('accepts a code produced by a standard authenticator implementation', () => {
    const { secret } = service.enroll('person@example.invalid');
    const now = new Date('2026-08-28T12:00:00.000Z');

    const reference = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
    const code = reference.generate({ timestamp: now.getTime() });

    const result = service.verify(secret, code, now);
    expect(result.valid).toBe(true);
    expect(result.counter).toBe(Math.floor(now.getTime() / 1000 / 30));
  });

  it('rejects a wrong code', () => {
    const { secret } = service.enroll('person@example.invalid');
    expect(service.verify(secret, '000000', new Date()).valid).toBe(false);
  });

  it('tolerates one period of clock drift in each direction', () => {
    const { secret } = service.enroll('person@example.invalid');
    const now = new Date('2026-08-28T12:00:00.000Z');

    const past = service.generate(secret, new Date(now.getTime() - 30_000));
    const future = service.generate(secret, new Date(now.getTime() + 30_000));

    expect(service.verify(secret, past, now).valid).toBe(true);
    expect(service.verify(secret, future, now).valid).toBe(true);
  });

  it('rejects a code more than one period away, keeping the window tight', () => {
    const { secret } = service.enroll('person@example.invalid');
    const now = new Date('2026-08-28T12:00:00.000Z');
    const distant = service.generate(secret, new Date(now.getTime() - 180_000));

    expect(service.verify(secret, distant, now).valid).toBe(false);
  });

  it('reports a distinct counter per period, which is what blocks replay', () => {
    const { secret } = service.enroll('person@example.invalid');
    const first = new Date('2026-08-28T12:00:00.000Z');
    const later = new Date('2026-08-28T12:01:00.000Z');

    const a = service.verify(secret, service.generate(secret, first), first);
    const b = service.verify(secret, service.generate(secret, later), later);

    expect(a.counter).not.toBe(b.counter);
    expect(b.counter as number).toBeGreaterThan(a.counter as number);
  });

  it('returns invalid rather than throwing on a malformed stored secret', () => {
    expect(service.verify('not-base32!!!', '123456', new Date()).valid).toBe(false);
  });
});

describe('recovery codes (blueprint 17)', () => {
  it('formats codes as three unambiguous groups of four', () => {
    for (let index = 0; index < 50; index += 1) {
      // The alphabet omits look-alikes such as 0/o and 1/l/i, because these are
      // read off paper and retyped.
      expect(generateRecoveryCode()).toMatch(
        /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/,
      );
    }
  });

  it('issues ten distinct codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  it('hashes rather than storing the code', () => {
    const code = generateRecoveryCode();
    const hashed = hashRecoveryCode(code);
    expect(hashed).not.toBe(code);
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes consistently despite spacing and case, so retyping works', () => {
    const code = 'abcd-efgh-jkmn';
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(' ABCD-EFGH-JKMN '));
    expect(normaliseRecoveryCode(' ABCD-EFGH-JKMN ')).toBe('abcd-efgh-jkmn');
  });

  it('produces different hashes for different codes', () => {
    expect(hashRecoveryCode('aaaa-bbbb-cccc')).not.toBe(hashRecoveryCode('aaaa-bbbb-cccd'));
  });
});
