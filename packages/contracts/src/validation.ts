/**
 * Shared validation approach.
 *
 * Zod 4 is the validation library for every payload schema in the project.
 * It is re-exported here so no other workspace imports zod directly and the
 * version stays pinned in one place.
 *
 * `validate` converts a Zod failure into the shared field-error shape, so a
 * schema failure always becomes a clean 4xx payload rather than a 500.
 */

import * as z from 'zod';
import type { ApiFieldError } from './errors.js';

export { z };

export type ValidationResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly errors: readonly ApiFieldError[] };

/** Render a Zod issue path as a stable dotted/bracketed string. */
export function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  let rendered = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      rendered += `[${String(segment)}]`;
    } else if (rendered === '') {
      rendered = String(segment);
    } else {
      rendered += `.${String(segment)}`;
    }
  }
  return rendered;
}

export function toFieldErrors(error: z.ZodError): readonly ApiFieldError[] {
  return error.issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    message: issue.message,
  }));
}

export function validate<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): ValidationResult<z.infer<TSchema>> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, errors: toFieldErrors(result.error) };
}
