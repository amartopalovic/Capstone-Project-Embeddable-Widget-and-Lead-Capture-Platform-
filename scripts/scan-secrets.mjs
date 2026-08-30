#!/usr/bin/env node
/**
 * Secret scanning (blueprint 15.3, 17).
 *
 * Section 17 requires "dependency review, lockfile integrity, automated
 * vulnerability checks, and secret scanning in CI". CI also runs TruffleHog,
 * which is better than this at finding a credential that was committed and then
 * removed, because it walks history.
 *
 * This exists beside it for two reasons TruffleHog does not cover:
 *
 *  1. It runs LOCALLY, in one command, with no network and no action runner. A
 *     check that can only be observed by pushing is a check whose result nobody
 *     sees until after the mistake is public.
 *  2. It knows this repository's own conventions - that every fixture address
 *     ends in `.invalid`, that development fallbacks are spelled
 *     `development-only-insecure-…`, and that `.env.example` holds
 *     `replace-me-…` placeholders. A generic scanner either misses a real
 *     credential among those or drowns the signal in them.
 *
 * Scans tracked files only, so `node_modules` and build output are out of scope
 * by construction rather than by an ignore list that could drift.
 *
 * Exit code 1 on any finding. Prints the file, the line, and a redacted excerpt
 * - never the matched value, because a scanner that echoes secrets into CI logs
 * has moved the problem rather than solved it.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

/**
 * Patterns worth failing a build over.
 *
 * Each one is a credential SHAPE that no legitimate file in this repository has
 * a reason to contain. Deliberately not "anything that looks high-entropy":
 * this codebase is full of base64 test fixtures, content hashes, and public
 * widget ids, and a scanner that cries wolf is a scanner that gets disabled.
 */
const RULES = [
  { name: 'private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Brevo API key', pattern: /\bxkeysib-[A-Za-z0-9]{20,}\b/ },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Stripe key', pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b/ },
  {
    name: 'JSON web token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    name: 'Sentry DSN with a real project',
    // A DSN is not a high-value secret, but a real one committed here would
    // point error reports at somebody's actual project.
    pattern: /https:\/\/[0-9a-f]{16,}@[A-Za-z0-9.-]*ingest\.[A-Za-z0-9.-]*sentry\.io\//,
  },
  {
    name: 'connection string with a password',
    pattern: /\b(?:mongodb(?:\+srv)?|redis|rediss|postgres(?:ql)?|amqps?):\/\/[^\s:/@]+:[^\s:/@]+@/,
  },
];

/**
 * Values this repository legitimately contains that look like the above.
 *
 * Each entry is a promise about a convention, so a new fixture that does not
 * follow one of them is a finding rather than a silent addition here.
 */
const ALLOWED = [
  // Development fallbacks in `config/env.ts`, which production refuses to start with.
  /development-only-insecure-/,
  /integration-test-[a-z-]+-not-a-real-credential/,
  /test-only-insecure-key/,
  // `.env.example` placeholders.
  /replace-me-with-/,
  // Every address in every fixture, per RFC 2606.
  /@example\.invalid\b/,
  // Documented example shapes in the runbook and the API reference.
  /<the key that is currently/,
  /base64key/,
];

/** Files whose contents are never source and are noisy to scan. */
const SKIP_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.pdf',
  '.zip',
]);

/**
 * The lockfile is skipped for the RESOLVED-URL rules only.
 *
 * It legitimately contains thousands of registry URLs and integrity hashes.
 * It is still scanned for private keys and vendor tokens, which have no reason
 * to be in it at all.
 */
const LOCKFILE = 'package-lock.json';

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return output.split('\0').filter((path) => path !== '');
}

function redact(line) {
  const trimmed = line.trim();
  const head = trimmed.slice(0, 24);
  return trimmed.length > 24 ? `${head}… (${String(trimmed.length)} chars)` : head;
}

function main() {
  const findings = [];

  for (const file of trackedFiles()) {
    if (SKIP_EXTENSIONS.has(extname(file).toLowerCase())) continue;

    let contents;
    try {
      contents = readFileSync(file, 'utf8');
    } catch {
      continue; // Unreadable or binary; nothing to scan.
    }
    if (contents.includes('\u0000')) continue;

    const lines = contents.split('\n');
    for (const [index, line] of lines.entries()) {
      if (ALLOWED.some((allowed) => allowed.test(line))) continue;

      for (const rule of RULES) {
        if (file === LOCKFILE && rule.name === 'connection string with a password') continue;
        if (rule.pattern.test(line)) {
          findings.push({ file, line: index + 1, rule: rule.name, excerpt: redact(line) });
        }
      }
    }
  }

  if (findings.length === 0) {
    console.log('secret scan: clean');
    return;
  }

  console.error(`secret scan: ${String(findings.length)} finding(s)`);
  for (const finding of findings) {
    console.error(`  ${finding.file}:${String(finding.line)}  ${finding.rule}  ${finding.excerpt}`);
  }
  process.exitCode = 1;
}

main();
