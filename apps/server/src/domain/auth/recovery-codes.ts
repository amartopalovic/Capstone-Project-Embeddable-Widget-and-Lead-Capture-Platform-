import { randomBytes } from 'node:crypto';
import { RECOVERY_CODE_COUNT } from '@lcp/contracts';
import { hashToken } from './tokens.js';

/**
 * Recovery codes (blueprint 17: hashed recovery codes).
 *
 * Formatted as three groups of four from an unambiguous alphabet, so a code
 * read off paper cannot be mistyped as a different valid code. The alphabet
 * omits characters that look alike in most fonts.
 *
 * Only hashes are stored, using the same helper as verification and reset
 * tokens rather than a second convention.
 */

/** Excludes 0/o, 1/l/i, and similar look-alikes. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const GROUPS = 3;
const GROUP_LENGTH = 4;

function randomGroup(): string {
  const bytes = randomBytes(GROUP_LENGTH);
  let group = '';
  for (let index = 0; index < GROUP_LENGTH; index += 1) {
    // Modulo bias is negligible here: 256 % 31 skews the last few symbols by
    // well under a percent, against codes with ~59 bits of entropy.
    group += ALPHABET[(bytes[index] ?? 0) % ALPHABET.length];
  }
  return group;
}

export function generateRecoveryCode(): string {
  return Array.from({ length: GROUPS }, randomGroup).join('-');
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): readonly string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateRecoveryCode());
  return [...codes];
}

/** Normalise user input before hashing, so spacing and case do not matter. */
export function normaliseRecoveryCode(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '');
}

export function hashRecoveryCode(code: string): string {
  return hashToken(normaliseRecoveryCode(code));
}
