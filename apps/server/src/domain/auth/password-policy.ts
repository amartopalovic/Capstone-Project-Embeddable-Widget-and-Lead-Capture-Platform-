import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type PasswordAssessment,
  type PasswordStrength,
} from '@lcp/contracts';

/**
 * Password policy (blueprint section 4.2): minimum 12 characters, strength
 * feedback, and common/breached-password blocking.
 *
 * This module holds the PURE half - length, composition, and obvious-pattern
 * checks. Breach checking needs I/O and lives behind the BreachChecker port.
 */

/**
 * A small embedded list of passwords that are both extremely common and long
 * enough to pass the 12-character rule, which is exactly the gap a length check
 * alone leaves open. The exhaustive breach check is the BreachChecker port; this
 * is a cheap first pass that needs no I/O.
 */
const COMMON_LONG_PASSWORDS: ReadonlySet<string> = new Set([
  'password1234',
  'password12345',
  'passw0rd1234',
  'qwertyuiop123',
  'qwerty12345678',
  '123456789012',
  '1234567890123',
  'iloveyou1234',
  'letmein12345',
  'welcome12345',
  'administrator',
  'trustno1trustno1',
  'baseball12345',
  'football12345',
  'dragon123456',
  'monkey123456',
  'abc123abc123',
  'passwordpassword',
  'zaq12wsxcde3',
  'qazwsxedcrfv',
]);

/** Reject a password that is one character repeated, such as `aaaaaaaaaaaa`. */
function isSingleRepeatedCharacter(password: string): boolean {
  return password.length > 0 && new Set(password).size === 1;
}

/** Reject straight keyboard or alphabet runs, such as `abcdefghijkl`. */
function isSequentialRun(password: string): boolean {
  if (password.length < PASSWORD_MIN_LENGTH) return false;
  const lower = password.toLowerCase();
  let ascending = true;
  let descending = true;
  for (let index = 1; index < lower.length; index += 1) {
    const delta = lower.charCodeAt(index) - lower.charCodeAt(index - 1);
    if (delta !== 1) ascending = false;
    if (delta !== -1) descending = false;
  }
  return ascending || descending;
}

function characterClasses(password: string): number {
  let classes = 0;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/[0-9]/.test(password)) classes += 1;
  if (/[^A-Za-z0-9]/.test(password)) classes += 1;
  return classes;
}

/**
 * Coarse strength band, shown as FEEDBACK only.
 *
 * Blueprint section 4.2 asks for strength feedback alongside the length and
 * breach rules; it does not make composition a gate. Requiring particular
 * character classes is known to push users toward predictable substitutions,
 * so length and breach status do the gating and this only informs.
 */
export function assessStrength(password: string): PasswordStrength {
  const length = password.length;
  const classes = characterClasses(password);
  const distinct = new Set(password).size;

  let score = 0;
  if (length >= 12) score += 1;
  if (length >= 16) score += 1;
  if (length >= 20) score += 1;
  if (classes >= 3) score += 1;
  if (distinct >= 10) score += 1;

  if (score >= 5) return 'strong';
  if (score >= 4) return 'good';
  if (score >= 2) return 'fair';
  return 'weak';
}

/**
 * Evaluate the offline rules. `acceptable` here means "passed everything that
 * can be checked without I/O"; the caller must still consult the BreachChecker.
 */
export function assessPassword(password: string, email?: string): PasswordAssessment {
  const problems: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Use at least ${String(PASSWORD_MIN_LENGTH)} characters`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`Use at most ${String(PASSWORD_MAX_LENGTH)} characters`);
  }
  if (COMMON_LONG_PASSWORDS.has(password.toLowerCase())) {
    problems.push('This password is too common');
  }
  if (isSingleRepeatedCharacter(password)) {
    problems.push('Do not repeat a single character');
  }
  if (isSequentialRun(password)) {
    problems.push('Do not use a sequential run of characters');
  }
  if (email !== undefined && email.length > 0) {
    const localPart = email.split('@')[0]?.toLowerCase() ?? '';
    if (localPart.length >= 4 && password.toLowerCase().includes(localPart)) {
      problems.push('Do not include your email address in your password');
    }
  }

  return {
    acceptable: problems.length === 0,
    strength: assessStrength(password),
    problems,
  };
}
