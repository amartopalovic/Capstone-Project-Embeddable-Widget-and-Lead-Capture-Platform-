import { spawn } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { encryptToFile, verifyEncryptedFile } from './backup-format.mjs';
import { requiredEnv, waitForChild, withMongoToolConfig } from './mongo-tool.mjs';

async function main() {
  const uri = requiredEnv('MONGODB_URI');
  const database = requiredEnv('MONGODB_DB_NAME');
  const passphrase = requiredEnv('BACKUP_PASSPHRASE');
  const output = resolve(requiredEnv('BACKUP_FILE'));
  const binary = process.env.MONGODUMP_BIN || 'mongodump';

  await mkdir(dirname(output), { recursive: true });

  try {
    await withMongoToolConfig(uri, async (configPath) => {
      const child = spawn(
        binary,
        [`--config=${configPath}`, `--db=${database}`, '--archive', '--gzip'],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      );
      if (child.stdout === null) throw new Error('mongodump stdout is unavailable');
      await Promise.all([
        encryptToFile(child.stdout, output, passphrase),
        waitForChild(child, 'mongodump'),
      ]);
    });
    await verifyEncryptedFile(output, passphrase);
    const details = await stat(output);
    console.log(`[backup] Encrypted and authenticated backup (${String(details.size)} bytes).`);
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  }
}

main().catch(() => {
  console.error(
    '[backup] Failed; sensitive details suppressed. Check configuration, tool availability and service access.',
  );
  process.exitCode = 1;
});
