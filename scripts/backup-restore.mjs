import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { decryptToWritable, verifyEncryptedFile } from './backup-format.mjs';
import { requiredEnv, waitForChild, withMongoToolConfig } from './mongo-tool.mjs';

async function main() {
  if (process.env.BACKUP_REHEARSAL !== 'true') {
    throw new Error(
      'BACKUP_REHEARSAL=true is required; this command is only for an isolated rehearsal database',
    );
  }

  const input = resolve(requiredEnv('BACKUP_FILE'));
  const passphrase = requiredEnv('BACKUP_PASSPHRASE');
  const uri = requiredEnv('MONGODB_RESTORE_URI');
  const sourceDatabase = requiredEnv('BACKUP_SOURCE_DB_NAME');
  const targetDatabase = requiredEnv('MONGODB_RESTORE_DB_NAME');
  const binary = process.env.MONGORESTORE_BIN || 'mongorestore';

  if (!targetDatabase.endsWith('_restore_rehearsal') || targetDatabase === sourceDatabase) {
    throw new Error(
      'MONGODB_RESTORE_DB_NAME must be a distinct database ending in _restore_rehearsal',
    );
  }

  // Authenticate the entire ciphertext before mongorestore receives one byte.
  // A wrong passphrase therefore cannot partially replace a rehearsal database.
  await verifyEncryptedFile(input, passphrase);

  await withMongoToolConfig(uri, async (configPath) => {
    const child = spawn(
      binary,
      [
        `--config=${configPath}`,
        '--archive',
        '--gzip',
        '--drop',
        `--nsFrom=${sourceDatabase}.*`,
        `--nsTo=${targetDatabase}.*`,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true },
    );
    if (child.stdin === null) throw new Error('mongorestore stdin is unavailable');
    await Promise.all([
      decryptToWritable(input, child.stdin, passphrase),
      waitForChild(child, 'mongorestore'),
    ]);
  });

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(targetDatabase);
    const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith('system.'));
    let documents = 0;
    for (const name of collections) documents += await db.collection(name).countDocuments();
    if (collections.length === 0 || documents === 0) {
      throw new Error(
        'Restore completed but the rehearsal database contains no application documents',
      );
    }
    console.log(
      `[restore] Restored ${String(collections.length)} collections and ${String(documents)} documents into the rehearsal database.`,
    );
  } finally {
    await client.close();
  }
}

main().catch(() => {
  console.error(
    '[restore] Failed; sensitive details suppressed. Check configuration, tool availability and service access.',
  );
  process.exitCode = 1;
});
