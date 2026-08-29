import type { Filter, Sort } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { ContactRecord } from '@lcp/database';
import { decodeCursor, encodeCursor, type ContactSortField } from '@lcp/contracts';

/**
 * Keyset (cursor) pagination for the inbox (blueprint 4.7, 10.1).
 *
 * Offset pagination is not offered, and the reason is specific to this product:
 * the inbox is sorted by last submission, and new submissions arrive while
 * someone is reading it. With `skip`, every arrival shifts the whole list down
 * by one, so page 2 re-shows a row the reader already saw on page 1 and hides
 * another entirely. A keyset cursor resumes from a POSITION rather than a
 * count, so an arrival cannot move the boundary underneath the reader.
 *
 * The position is (sort value, _id). MongoDB's own documentation is explicit
 * that `$sort` is not a stable sort and that a unique field must be included
 * for deterministic order - which is the same property a resumable cursor
 * needs, so the tiebreaker is doing two jobs at once.
 */

export interface CursorPosition {
  readonly value: string;
  readonly id: string;
}

/** The cursor is opaque base64url, and carries NO authorization input. */
export function encodeContactCursor(position: CursorPosition): string {
  return encodeCursor({ v: position.value, id: position.id });
}

/**
 * Decode a cursor, returning null for anything malformed.
 *
 * A bad cursor is treated as "start from the beginning" by the caller rather
 * than as an error: cursors end up in bookmarks and shared links, and a stale
 * one should show the inbox, not a 400.
 */
export function decodeContactCursor(cursor: string): CursorPosition | null {
  const decoded = decodeCursor(cursor);
  if (decoded === null) return null;
  const value = decoded['v'];
  const id = decoded['id'];
  if (typeof value !== 'string' || typeof id !== 'string') return null;
  if (!ObjectId.isValid(id)) return null;
  return { value, id };
}

/** Read the sort field off a record and render it as a cursor value. */
export function positionOf(
  record: Pick<ContactRecord, 'lastSubmissionAt' | 'createdAt' | 'normalizedEmail'> & {
    readonly _id: ObjectId;
  },
  field: ContactSortField,
): CursorPosition {
  // Written as a switch rather than an index expression so a new sort field
  // added to the contract is a compile error here rather than a silent
  // `undefined` in a cursor.
  let raw: string;
  switch (field) {
    case 'normalizedEmail':
      raw = record.normalizedEmail;
      break;
    case 'createdAt':
      raw = record.createdAt.toISOString();
      break;
    case 'lastSubmissionAt':
      raw = record.lastSubmissionAt.toISOString();
      break;
  }
  return { value: raw, id: record._id.toHexString() };
}

export function contactSort(field: ContactSortField, direction: 'asc' | 'desc'): Sort {
  const order = direction === 'asc' ? 1 : -1;
  // The tiebreaker follows the primary direction so the total order is
  // consistent with the keyset comparison below.
  return { [field]: order, _id: order };
}

function parseValue(field: ContactSortField, value: string): string | Date | null {
  if (field === 'normalizedEmail') return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The keyset comparison: everything strictly after the cursor position.
 *
 * Written as the standard two-clause form rather than a single compound
 * comparison, because Mongo compares documents field by field and `$gt` on a
 * compound value is not the same operation:
 *
 *   (sortField > v) OR (sortField == v AND _id > id)
 *
 * The second clause is what makes ties resumable. Without it, a page boundary
 * that lands in the middle of a group of contacts sharing a timestamp would
 * either repeat them or skip them.
 */
export function keysetFilter(
  field: ContactSortField,
  direction: 'asc' | 'desc',
  position: CursorPosition,
): Filter<ContactRecord> | null {
  const value = parseValue(field, position.value);
  if (value === null) return null;

  const comparator = direction === 'asc' ? '$gt' : '$lt';
  const id = new ObjectId(position.id);

  return {
    $or: [{ [field]: { [comparator]: value } }, { [field]: value, _id: { [comparator]: id } }],
  } as unknown as Filter<ContactRecord>;
}

/**
 * Merge the keyset clause into an existing filter without letting either
 * clobber the other.
 *
 * Both halves can contain `$or` - the search filter uses one - so they are
 * combined under `$and` rather than spread into one object, where the second
 * `$or` would silently replace the first.
 */
export function withKeyset(
  filter: Filter<ContactRecord>,
  keyset: Filter<ContactRecord> | null,
): Filter<ContactRecord> {
  if (keyset === null) return filter;
  const existing = filter as Record<string, unknown>;
  const and = (existing['$and'] as unknown[] | undefined) ?? [];
  const rest = { ...existing };
  delete rest['$and'];
  return { $and: [...and, rest, keyset] } as unknown as Filter<ContactRecord>;
}
