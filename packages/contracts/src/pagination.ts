/**
 * Cursor pagination contract (blueprint sections 4.7 and 10.1).
 *
 * List endpoints use cursor pagination with an explicit sort/filter contract
 * and deterministic ordering. Offset pagination is deliberately not offered:
 * it drifts as rows are inserted and cannot give a stable inbox.
 *
 * Stage 2 establishes the shape. The first consumer is the contact inbox in
 * Stage 8, which must not invent its own paging rules.
 */

import * as z from 'zod';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export type SortDirection = 'asc' | 'desc';

export interface SortSpec {
  readonly field: string;
  readonly direction: SortDirection;
}

export interface CursorPageRequest {
  /** Opaque cursor from a previous page. Absent means start at the beginning. */
  readonly cursor?: string;
  readonly limit: number;
  /**
   * Ordering is always explicit. A tie-breaking unique field must be included
   * by the caller so ordering is total and the cursor is stable.
   */
  readonly sort: readonly SortSpec[];
}

export interface CursorPage<T> {
  readonly items: readonly T[];
  /** Null when there are no further pages. */
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export const sortDirectionSchema: z.ZodType<SortDirection> = z.enum(['asc', 'desc']);

export const cursorPageRequestSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: z.array(z.object({ field: z.string().min(1), direction: sortDirectionSchema })).min(1),
});

/**
 * Cursors are opaque to clients: base64url of a small JSON position document.
 *
 * Opaque means clients cannot depend on the shape, so the internal position can
 * change later without breaking them. It is NOT a security boundary and must
 * never carry a workspace ID or any other authorization input - the workspace
 * always comes from session context (blueprint section 9.1).
 */
export function encodeCursor(position: Readonly<Record<string, string | number>>): string {
  return Buffer.from(JSON.stringify(position), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): Record<string, string | number> | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, string | number>;
  } catch {
    return null;
  }
}

export function emptyPage<T>(): CursorPage<T> {
  return { items: [], nextCursor: null, hasMore: false };
}
