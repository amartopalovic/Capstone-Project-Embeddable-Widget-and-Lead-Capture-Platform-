import type { EncryptedValue } from '@lcp/database';

/**
 * Application-level encryption for readable secrets (blueprint 12.4 and 17).
 *
 * "Readable" means the application must recover the plaintext to use it, unlike
 * a password which is only ever compared. TOTP secrets are the first such value;
 * Stage 9 adds webhook signing secrets.
 *
 * Every ciphertext records the key version that produced it, so a rotated
 * master key can still read older values.
 */
export interface SecretCipher {
  encrypt(plaintext: string): EncryptedValue;
  /**
   * Returns null when the value cannot be decrypted - unknown key version, or a
   * failed authentication tag - rather than throwing, so a tampered record
   * degrades to "no secret" instead of crashing a request.
   */
  decrypt(value: EncryptedValue): string | null;
}
