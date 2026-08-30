#!/usr/bin/env node
// Read-only audit: values are fingerprinted, never printed. Includes ignored
// first-party files and all reachable historical blobs, not node_modules.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const excluded = new Set(['.git', 'node_modules', '.agents', '.codex', 'tmp']);
const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g],
  ['aws-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  [
    'vendor-token',
    /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{30,}|xox[abposr]-[A-Za-z0-9-]{10,}|xkeysib-[A-Za-z0-9_-]{20,}|AIza[\w-]{35})\b/g,
  ],
  ['jwt', /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/g],
  [
    'credential-uri',
    /\b(?:mongodb(?:\+srv)?|rediss?|postgres(?:ql)?|amqps?):\/\/[^\s"'<>]+:[^\s"'<>]+@[^\s"'<>]+/g,
  ],
  ['sentry-dsn', /https:\/\/[a-f0-9]{16,}@[\w.-]*sentry\.io\/\d+/g],
];
const emailPattern = /\b[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}\b/g;
const reservedEmail = /@(?:[^@]*\.)?(?:invalid|example\.com|example\.org|example\.net|test)$/i;
const findings = [];
const literalCandidates = new Map();
const emails = new Map();
const localPaths = [];
let treeFiles = 0;
let historyBlobs = 0;

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function inspect(buffer, location) {
  if (buffer.includes(0)) return;
  const contents = buffer.toString('utf8');
  const lines = contents.split('\n');
  for (const [index, line] of lines.entries()) {
    const assignments =
      /\b(?:[A-Z_]*(?:PASSWORD|SECRET|TOKEN|API_KEY|MASTER_KEY|PREVIOUS_KEYS|DSN)[A-Z_]*|password|passwordHash|sessionSecret|ipHmacSecret|encryptionMasterKey|apiKey|webhookSecret|totpSecret|passphrase)\s*[:=]\s*(?:'([^']+)'|"([^"]+)")/g;
    for (const match of line.matchAll(assignments)) {
      const value = match[1] ?? match[2];
      const id = fingerprint(value);
      const entry = literalCandidates.get(id) ?? { fingerprint: id, locations: [] };
      entry.locations.push(`${location}:${String(index + 1)}`);
      literalCandidates.set(id, entry);
    }
    if (location.endsWith('.env') || location.endsWith('.env.example')) {
      const assignment = /^([A-Z_]*(?:PASSWORD|SECRET|TOKEN|KEY|DSN)[A-Z_]*)=(.+)$/.exec(line);
      if (assignment) {
        const id = fingerprint(assignment[2]);
        const entry = literalCandidates.get(id) ?? { fingerprint: id, locations: [] };
        entry.locations.push(`${location}:${String(index + 1)}`);
        literalCandidates.set(id, entry);
      }
    }
    for (const [rule, pattern] of rules) {
      for (const match of line.matchAll(pattern)) {
        findings.push({ location, line: index + 1, rule, fingerprint: fingerprint(match[0]) });
      }
    }
    for (const match of line.matchAll(emailPattern)) {
      if (reservedEmail.test(match[0])) continue;
      const id = fingerprint(match[0].toLowerCase());
      const entry = emails.get(id) ?? { fingerprint: id, locations: [] };
      entry.locations.push(`${location}:${String(index + 1)}`);
      emails.set(id, entry);
    }
    if (/(?:[A-Z]:[\\/]+Users[\\/]+[^\\/\s]+|\/home\/[^/\s]+)/i.test(line)) {
      localPaths.push(`${location}:${String(index + 1)}`);
    }
  }
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) {
      treeFiles += 1;
      if (statSync(path).size <= 16 * 1024 * 1024)
        inspect(readFileSync(path), relative(root, path).replaceAll('\\', '/'));
    }
  }
}

walk(root);
const objects = execFileSync('git', ['rev-list', '--objects', '--all'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => ({ id: line.slice(0, 40), path: line.slice(41) }));
const batch = spawnSync('git', ['cat-file', '--batch'], {
  input: objects.map((object) => object.id).join('\n') + '\n',
  maxBuffer: 256 * 1024 * 1024,
});
if (batch.status !== 0) throw new Error('git cat-file failed');
let cursor = 0;
for (const object of objects) {
  const newline = batch.stdout.indexOf(10, cursor);
  const header = batch.stdout.subarray(cursor, newline).toString('ascii').split(' ');
  const size = Number(header[2]);
  const body = batch.stdout.subarray(newline + 1, newline + 1 + size);
  if (header[1] === 'blob') {
    historyBlobs += 1;
    inspect(body, `history:${object.id}:${object.path}`);
  }
  if (header[1] === 'commit' || header[1] === 'tag') {
    // Identity metadata is reported separately without exposing its values.
    const message = body.toString('utf8').split('\n\n').slice(1).join('\n\n');
    inspect(Buffer.from(message), `history-message:${object.id}`);
  }
  cursor = newline + 1 + size + 1;
}

const commits = execFileSync('git', ['rev-list', '--all', '--count'], { encoding: 'utf8' }).trim();
const metadata = execFileSync('git', ['log', '--all', '--format=%H%x09%an%x09%ae%x09%cn%x09%ce'], {
  encoding: 'utf8',
});
const identities = new Map();
for (const row of metadata.trim().split('\n')) {
  const [commit, author, authorEmail, committer, committerEmail] = row.split('\t');
  for (const [name, email] of [
    [author, authorEmail],
    [committer, committerEmail],
  ]) {
    const id = fingerprint(`${name}|${email}`);
    const item = identities.get(id) ?? {
      fingerprint: id,
      reservedEmail: reservedEmail.test(email),
      commits: [],
    };
    if (!item.commits.includes(commit)) item.commits.push(commit);
    identities.set(id, item);
  }
}

console.log(
  JSON.stringify(
    {
      scope: {
        currentFirstPartyFiles: treeFiles,
        reachableCommits: Number(commits),
        uniqueHistoricalBlobs: historyBlobs,
        excludedDirectories: [...excluded],
      },
      credentialCandidates: findings,
      literalCandidates: [...literalCandidates.values()],
      nonReservedEmailCandidates: [...emails.values()],
      userSpecificPathLocations: localPaths,
      gitIdentityCandidates: [...identities.values()],
    },
    null,
    2,
  ),
);
