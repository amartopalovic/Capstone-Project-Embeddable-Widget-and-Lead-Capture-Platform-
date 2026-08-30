import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function requiredEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') throw new Error(`${name} is required`);
  return value;
}

export async function withMongoToolConfig(uri, run) {
  const directory = await mkdtemp(join(tmpdir(), 'lcp-mongo-tool-'));
  const path = join(directory, 'connection.yml');
  try {
    // JSON strings are valid YAML scalars and safely preserve URI punctuation.
    await writeFile(path, `uri: ${JSON.stringify(uri)}\n`, { encoding: 'utf8', mode: 0o600 });
    return await run(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function waitForChild(child, label) {
  // Drain the pipe without retaining driver text: it can echo connection data.
  child.stderr?.resume();
  return new Promise((resolve, reject) => {
    child.once('error', () =>
      reject(new Error(`${label} could not start; sensitive details suppressed`)),
    );
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${label} failed (${signal ?? `exit ${String(code)}`}): sensitive details suppressed`,
          ),
        );
    });
  });
}
