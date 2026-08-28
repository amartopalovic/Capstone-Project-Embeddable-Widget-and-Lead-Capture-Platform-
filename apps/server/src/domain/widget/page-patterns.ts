/**
 * Page include/exclude matching (blueprint 4.4).
 *
 * The blueprint is explicit that targeting uses "safe glob patterns rather than
 * executable regular expressions". This module is what makes that true.
 *
 * The translation escapes EVERY regular-expression metacharacter first, then
 * reintroduces exactly two wildcards. Two consequences follow, and both are the
 * point:
 *
 *  - a creator cannot smuggle regex syntax through a pattern field, because by
 *    the time anything is reintroduced the input is already inert text;
 *  - the generated expression contains no nested quantifier, alternation, or
 *    backreference, so it cannot backtrack catastrophically. A general glob
 *    library would have been the obvious shortcut, but the ones worth using
 *    bring brace expansion, extglobs, negation, and POSIX classes with them -
 *    far more surface than this needs, evaluated against patterns a tenant
 *    supplies. Picomatch's own documentation defaults `maxExtglobRecursion` to
 *    0 and treats "risky quantified extglobs" as literals, which is a fair
 *    signal about the size of that surface.
 *
 * Supported syntax, and nothing else:
 *
 *   *   matches any run of characters except `/`
 *   **  matches any run of characters, including `/`
 *
 * Stage 6 evaluates these against a real page URL. This stage owns the rule
 * and its validation only.
 */

/** Cap on compiled patterns, so a long allowlist cannot grow without bound. */
const MAX_PATTERN_LENGTH = 512;

/**
 * The path plus query of a URL, which is what patterns are written against.
 *
 * Returns null for input that is not a URL we will match, so a malformed page
 * URL becomes "no match" rather than an exception.
 */
export function pathFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/**
 * Compile one safe glob to an anchored regular expression.
 *
 * Exported for its unit tests: asserting the compiled source is how the
 * "no regex syntax survives" property is checked directly, rather than only
 * inferred from matching behaviour.
 */
export function compilePagePattern(pattern: string): RegExp | null {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) return null;

  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === undefined) return null;

    if (character === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }

    // Everything that is not a wildcard is escaped, including characters that
    // are harmless today, so the set never has to be revisited.
    source += character.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
  }

  try {
    return new RegExp(`^${source}$`);
  } catch {
    return null;
  }
}

/** Whether a path matches one pattern. */
export function matchesPattern(pattern: string, path: string): boolean {
  const compiled = compilePagePattern(pattern);
  if (compiled === null) return false;
  return compiled.test(path);
}

/** Whether a path matches at least one of the patterns. */
export function matchesAnyPattern(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => matchesPattern(pattern, path));
}

/**
 * The include/exclude decision (blueprint 4.4).
 *
 * An empty include list means "every page", which is what a creator who has
 * not narrowed their targeting expects. Exclude always wins over include: the
 * safer reading of a conflict is that the creator meant to keep the widget off
 * that page.
 */
export function isPageTargeted(
  targeting: {
    readonly includePatterns: readonly string[];
    readonly excludePatterns: readonly string[];
  },
  path: string,
): boolean {
  if (matchesAnyPattern(targeting.excludePatterns, path)) return false;
  if (targeting.includePatterns.length === 0) return true;
  return matchesAnyPattern(targeting.includePatterns, path);
}
