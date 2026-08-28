import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EncryptedValue } from '@lcp/database';
import type { SecretCipher } from '../../ports/secret-cipher.js';

/**
 * AES-256-GCM secret encryption with key versioning (blueprint 12.4).
 *
 * GCM is authenticated encryption, so a tampered ciphertext fails to decrypt
 * rather than yielding attacker-chosen plaintext. A fresh 96-bit IV is drawn per
 * encryption, which is required: reusing an IV under the same key catastrophically
 * breaks GCM.
 *
 * Keys are held per version. Rotation adds a new version and keeps the old ones
 * readable, so existing records do not need rewriting in the same deployment.
 */

export interface AesSecretCipherOptions {
  /** Version to encrypt NEW values with. */
  readonly currentKeyVersion: number;
  /** Every known key, by version. Base64-encoded 32-byte values. */
  readonly keysByVersion: ReadonlyMap<number, Buffer>;
}

const IV_BYTES = 12;
const KEY_BYTES = 32;

/** Decode and validate a base64 master key. */
export function parseMasterKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `Encryption master key must decode to ${String(KEY_BYTES)} bytes, got ${String(key.length)}`,
    );
  }
  return key;
}

export class AesSecretCipher implements SecretCipher {
  readonly #currentKeyVersion: number;
  readonly #keys: ReadonlyMap<number, Buffer>;

  constructor(options: AesSecretCipherOptions) {
    if (!options.keysByVersion.has(options.currentKeyVersion)) {
      throw new Error(
        `No encryption key configured for current version ${String(options.currentKeyVersion)}`,
      );
    }
    this.#currentKeyVersion = options.currentKeyVersion;
    this.#keys = options.keysByVersion;
  }

  encrypt(plaintext: string): EncryptedValue {
    const key = this.#keys.get(this.#currentKeyVersion);
    if (key === undefined) {
      throw new Error('Current encryption key is missing');
    }

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: this.#currentKeyVersion,
    };
  }

  decrypt(value: EncryptedValue): string | null {
    const key = this.#keys.get(value.keyVersion);
    if (key === undefined) return null;

    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, 'base64')),
        decipher.final(),
      ]);
      return plaintext.toString('utf8');
    } catch {
      // Wrong key, tampered ciphertext, or a corrupt tag.
      return null;
    }
  }
}
