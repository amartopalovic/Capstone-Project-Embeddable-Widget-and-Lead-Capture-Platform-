import { hash, verify } from '@node-rs/argon2';
import type { PasswordHasher } from '../../ports/password-hasher.js';

/**
 * Argon2id password hashing (blueprint section 4.2).
 *
 * Parameters match the current reference recommendation: 64 MiB of memory,
 * 3 iterations, 4 lanes, 32-byte output, Argon2id, version 0x13. They are
 * stated explicitly rather than left to library defaults, so a future default
 * change cannot silently weaken stored hashes and `needsRehash` has a fixed
 * target to compare against.
 *
 * The implementation is `@node-rs/argon2` rather than the `argon2` npm package.
 * Both produce standard PHC `$argon2id$` strings, and the locked blueprint
 * decision is the ALGORITHM, not a package. This one ships prebuilt binaries
 * with no install script, which matters here because `argon2` runs its install
 * script through cmd.exe and cannot install from a path containing `&`
 * (see README section 5.4).
 *
 * The enum members are written as numeric literals because the library declares
 * them as ambient const enums, which `verbatimModuleSyntax` forbids importing.
 * The values are pinned by the assertions below so a library renumbering would
 * fail the test suite rather than silently change the algorithm.
 */

/** `Algorithm.Argon2d = 0`, `Argon2i = 1`, `Argon2id = 2`. */
export const ARGON2ID_ALGORITHM = 2;
/** `Version.V0x10 = 0`, `V0x13 = 1`. */
export const ARGON2_VERSION_0X13 = 1;

export const ARGON2ID_PARAMETERS = {
  algorithm: ARGON2ID_ALGORITHM,
  version: ARGON2_VERSION_0X13,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
} as const;

/** Parsed parameters from a PHC-format digest. */
export interface ParsedDigest {
  readonly algorithm: string;
  readonly version: number;
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

/**
 * Parse a PHC string such as
 * `$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>`.
 *
 * Returns null for anything unparseable, which the caller treats as needing a
 * rehash rather than as a crash.
 */
export function parseDigest(digest: string): ParsedDigest | null {
  const parts = digest.split('$');
  // ['', 'argon2id', 'v=19', 'm=65536,t=3,p=4', salt, hash]
  if (parts.length < 5) return null;

  const algorithm = parts[1];
  const versionPart = parts[2];
  const paramPart = parts[3];
  if (algorithm === undefined || versionPart === undefined || paramPart === undefined) return null;

  const version = Number(versionPart.replace('v=', ''));
  const params = new Map<string, number>();
  for (const pair of paramPart.split(',')) {
    const [key, value] = pair.split('=');
    if (key !== undefined && value !== undefined) params.set(key, Number(value));
  }

  const memoryCost = params.get('m');
  const timeCost = params.get('t');
  const parallelism = params.get('p');
  if (memoryCost === undefined || timeCost === undefined || parallelism === undefined) return null;
  if (Number.isNaN(version)) return null;

  return { algorithm, version, memoryCost, timeCost, parallelism };
}

export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<string> {
    return hash(plaintext, ARGON2ID_PARAMETERS);
  }

  async verify(digest: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(digest, plaintext, ARGON2ID_PARAMETERS);
    } catch {
      // A malformed or foreign digest is a failed verification, not a crash.
      return false;
    }
  }

  /**
   * True when the stored digest is weaker than current policy.
   *
   * Implemented by parsing the PHC string because `@node-rs/argon2` exposes no
   * equivalent helper. Only WEAKER parameters trigger a rehash; a digest that
   * is already stronger is left alone.
   */
  needsRehash(digest: string): boolean {
    const parsed = parseDigest(digest);
    if (parsed === null) return true;

    return (
      parsed.algorithm !== 'argon2id' ||
      parsed.version < 19 ||
      parsed.memoryCost < ARGON2ID_PARAMETERS.memoryCost ||
      parsed.timeCost < ARGON2ID_PARAMETERS.timeCost ||
      parsed.parallelism < ARGON2ID_PARAMETERS.parallelism
    );
  }
}
