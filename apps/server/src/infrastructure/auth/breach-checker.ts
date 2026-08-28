import { createHash } from 'node:crypto';
import type { BreachChecker } from '../../ports/breach-checker.js';

/**
 * Breached-password checking (blueprint section 4.2).
 *
 * Two implementations and a composite:
 *
 *  - `LocalListBreachChecker` is the always-on offline baseline. Blueprint
 *    section 15.1 requires local development to need no external service, and
 *    CI must not depend on a third-party API being reachable.
 *  - `HibpBreachChecker` is opt-in and consults the Have I Been Pwned range
 *    API using k-anonymity: only the first five characters of the SHA-1 hash
 *    leave this process, so the password itself is never transmitted.
 *  - `CompositeBreachChecker` runs the offline list first and only then the
 *    optional remote one, so the guarantee never gets weaker than offline.
 */

/**
 * Compact offline list. Deliberately small and focused on entries that already
 * satisfy the 12-character minimum, because shorter ones are rejected by length
 * before they reach here. The remote checker is what provides breadth.
 */
const KNOWN_BREACHED: ReadonlySet<string> = new Set(
  [
    'password1234',
    'password123456',
    'qwerty123456',
    '123456789012',
    'iloveyou1234',
    'sunshine1234',
    'princess1234',
    'welcome123456',
    'admin1234567',
    'letmein123456',
    'football1234',
    'baseball1234',
    'superman1234',
    'michael12345',
    'shadow123456',
    'master123456',
    'jennifer1234',
    'jordan123456',
    'hunter123456',
    'thomas123456',
  ].map((entry) => entry.toLowerCase()),
);

export class LocalListBreachChecker implements BreachChecker {
  readonly name = 'local-list';

  async isBreached(plaintext: string): Promise<boolean> {
    return KNOWN_BREACHED.has(plaintext.toLowerCase());
  }
}

export interface HibpOptions {
  readonly endpoint?: string;
  readonly timeoutMs?: number;
}

export class HibpBreachChecker implements BreachChecker {
  readonly name = 'hibp';
  readonly #endpoint: string;
  readonly #timeoutMs: number;

  constructor(options: HibpOptions = {}) {
    this.#endpoint = options.endpoint ?? 'https://api.pwnedpasswords.com/range';
    this.#timeoutMs = options.timeoutMs ?? 2000;
  }

  async isBreached(plaintext: string): Promise<boolean> {
    const digest = createHash('sha1').update(plaintext, 'utf8').digest('hex').toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);

    try {
      const response = await fetch(`${this.#endpoint}/${prefix}`, {
        signal: AbortSignal.timeout(this.#timeoutMs),
        headers: { 'Add-Padding': 'true' },
      });
      if (!response.ok) return false;

      const body = await response.text();
      for (const line of body.split('\n')) {
        const [candidate, count] = line.trim().split(':');
        if (candidate === suffix && Number(count) > 0) return true;
      }
      return false;
    } catch {
      // Fail open: an unreachable provider must not block a password change.
      // The offline list in the composite has already run.
      return false;
    }
  }
}

export class CompositeBreachChecker implements BreachChecker {
  readonly name = 'composite';
  readonly #checkers: readonly BreachChecker[];

  constructor(checkers: readonly BreachChecker[]) {
    this.#checkers = checkers;
  }

  async isBreached(plaintext: string): Promise<boolean> {
    for (const checker of this.#checkers) {
      if (await checker.isBreached(plaintext)) return true;
    }
    return false;
  }
}
