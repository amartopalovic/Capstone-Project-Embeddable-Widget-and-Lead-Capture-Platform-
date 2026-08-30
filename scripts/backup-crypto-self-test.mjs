import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { decryptToWritable, encryptToFile, verifyEncryptedFile } from './backup-format.mjs';

const directory = await mkdtemp(join(tmpdir(), 'lcp-backup-test-'));
const path = join(directory, 'round-trip.lcpbak');
const passphrase = 'self-test-passphrase-not-a-secret';
const plaintext = randomBytes(256 * 1024 + 17);

try {
  await encryptToFile(Readable.from(plaintext), path, passphrase);
  await verifyEncryptedFile(path, passphrase);

  const chunks = [];
  await decryptToWritable(
    path,
    new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }),
    passphrase,
  );
  if (!Buffer.concat(chunks).equals(plaintext)) throw new Error('backup round trip changed bytes');

  let rejected = false;
  try {
    await verifyEncryptedFile(path, 'wrong-passphrase-still-long-enough');
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('wrong passphrase was not rejected');
  console.log('[backup] AES-256-GCM streaming round trip passed; wrong passphrase was rejected.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
