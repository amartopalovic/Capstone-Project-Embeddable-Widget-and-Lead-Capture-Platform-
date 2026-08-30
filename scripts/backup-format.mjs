import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform, Writable } from 'node:stream';

const MAGIC = Buffer.from('LCPBK01\0', 'ascii');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;

function keyFor(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 16) {
    throw new Error('BACKUP_PASSPHRASE must contain at least 16 characters');
  }
  return scryptSync(passphrase, salt, 32, { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

class EncryptBackup extends Transform {
  constructor(passphrase) {
    super();
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    this.cipher = createCipheriv('aes-256-gcm', keyFor(passphrase, salt), iv);
    this.push(Buffer.concat([MAGIC, salt, iv]));
  }

  _transform(chunk, _encoding, callback) {
    try {
      this.push(this.cipher.update(chunk));
      callback();
    } catch (error) {
      callback(error);
    }
  }

  _flush(callback) {
    try {
      this.push(this.cipher.final());
      this.push(this.cipher.getAuthTag());
      callback();
    } catch (error) {
      callback(error);
    }
  }
}

class DecryptBackup extends Transform {
  constructor(passphrase) {
    super();
    this.passphrase = passphrase;
    this.header = Buffer.alloc(0);
    this.tail = Buffer.alloc(0);
    this.decipher = null;
  }

  _transform(chunk, _encoding, callback) {
    try {
      let body = Buffer.from(chunk);
      if (this.decipher === null) {
        this.header = Buffer.concat([this.header, body]);
        if (this.header.length < HEADER_BYTES) {
          callback();
          return;
        }
        const magic = this.header.subarray(0, MAGIC.length);
        if (!magic.equals(MAGIC)) throw new Error('Not an LCP encrypted backup');
        const salt = this.header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
        const iv = this.header.subarray(MAGIC.length + SALT_BYTES, HEADER_BYTES);
        this.decipher = createDecipheriv('aes-256-gcm', keyFor(this.passphrase, salt), iv);
        body = this.header.subarray(HEADER_BYTES);
        this.header = Buffer.alloc(0);
      }

      const pending = Buffer.concat([this.tail, body]);
      if (pending.length <= TAG_BYTES) {
        this.tail = pending;
        callback();
        return;
      }
      const ciphertextEnd = pending.length - TAG_BYTES;
      this.push(this.decipher.update(pending.subarray(0, ciphertextEnd)));
      this.tail = pending.subarray(ciphertextEnd);
      callback();
    } catch (error) {
      callback(error);
    }
  }

  _flush(callback) {
    try {
      if (this.decipher === null || this.tail.length !== TAG_BYTES) {
        throw new Error('Encrypted backup is truncated');
      }
      this.decipher.setAuthTag(this.tail);
      this.push(this.decipher.final());
      callback();
    } catch (error) {
      callback(error);
    }
  }
}

export async function encryptToFile(readable, outputPath, passphrase) {
  await pipeline(
    readable,
    new EncryptBackup(passphrase),
    createWriteStream(outputPath, { mode: 0o600 }),
  );
}

export async function verifyEncryptedFile(inputPath, passphrase) {
  await pipeline(
    createReadStream(inputPath),
    new DecryptBackup(passphrase),
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  );
}

export async function decryptToWritable(inputPath, writable, passphrase) {
  await pipeline(createReadStream(inputPath), new DecryptBackup(passphrase), writable);
}
