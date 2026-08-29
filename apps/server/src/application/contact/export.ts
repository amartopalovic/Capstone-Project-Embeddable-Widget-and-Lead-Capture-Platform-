import type { WithId } from 'mongodb';
import type { ContactRecord } from '@lcp/database';

/**
 * Streaming CSV and JSON export (blueprint 4.7).
 *
 * Both writers are async generators, so the route can hand them straight to
 * `stream.pipeline` and let Node apply backpressure: a row is formatted only
 * when the socket is ready for it. Building the whole file in memory first
 * would make a large workspace's export a memory spike proportional to its
 * lead count, on the one endpoint whose result set is unbounded by design.
 *
 * No CSV library is used. The escaping rule below is the whole of RFC 4180 that
 * applies to a flat row of strings, and a dependency here would be a larger
 * surface than the seven lines it replaces.
 */

/**
 * The exported columns.
 *
 * A fixed, explicit list - never a dump of the record. Blueprint 4.7 says the
 * export is of the inbox the caller is looking at, and the record carries
 * fields no export should include (the internal version counter, the purge
 * schedule, the merge pointer). Enumerating what goes OUT means a field added
 * to the record later is not silently published to every past export consumer.
 */
export const EXPORT_COLUMNS = [
  'id',
  'email',
  'name',
  'phone',
  'company',
  'status',
  'tags',
  'assigneeUserId',
  'firstSubmissionAt',
  'lastSubmissionAt',
  'submissionCount',
] as const;

export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

export type ExportRow = Readonly<Record<ExportColumn, string>>;

export function toExportRow(contact: WithId<ContactRecord>): ExportRow {
  return {
    id: contact._id.toHexString(),
    email: contact.email,
    name: contact.name ?? '',
    phone: contact.phone ?? '',
    company: contact.company ?? '',
    status: contact.status,
    tags: contact.tags.join('|'),
    assigneeUserId: contact.assigneeUserId?.toHexString() ?? '',
    firstSubmissionAt: contact.firstSubmissionAt.toISOString(),
    lastSubmissionAt: contact.lastSubmissionAt.toISOString(),
    submissionCount: String(contact.submissionCount),
  };
}

/**
 * Quote a CSV field (RFC 4180).
 *
 * A field is quoted when it contains a comma, a quote, or a newline, and an
 * embedded quote is doubled. The leading-character guard is separate and is
 * about a different problem: a value beginning with `=`, `+`, `-`, or `@` is
 * interpreted as a FORMULA by Excel and Google Sheets, so an exported lead
 * whose name field contains a crafted string could execute in a colleague's
 * spreadsheet. Prefixing a tab neutralises that without altering the value a
 * program reading the CSV sees as text.
 */
export function csvField(value: string): string {
  const needsGuard = /^[=+\-@\t\r]/.test(value);
  const guarded = needsGuard ? `\t${value}` : value;
  /**
   * A guarded value is ALWAYS quoted. A leading tab in a bare field is fragile:
   * several parsers strip leading whitespace, which would remove the guard and
   * hand the formula straight back to the spreadsheet.
   */
  if (needsGuard || /[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function csvLine(values: readonly string[]): string {
  return `${values.map(csvField).join(',')}\r\n`;
}

/** Header row plus one row per contact, yielded as the cursor produces them. */
export async function* csvExport(
  contacts: AsyncIterable<WithId<ContactRecord>>,
): AsyncGenerator<string> {
  yield csvLine(EXPORT_COLUMNS);
  for await (const contact of contacts) {
    const row = toExportRow(contact);
    yield csvLine(EXPORT_COLUMNS.map((column) => row[column]));
  }
}

/**
 * A JSON array, assembled incrementally rather than via JSON.stringify on a
 * materialised list - the whole point of streaming. Each row is still
 * serialised with JSON.stringify, so escaping is the runtime's job.
 */
export async function* jsonExport(
  contacts: AsyncIterable<WithId<ContactRecord>>,
): AsyncGenerator<string> {
  yield '{"contacts":[';
  let first = true;
  for await (const contact of contacts) {
    yield `${first ? '' : ','}${JSON.stringify(toExportRow(contact))}`;
    first = false;
  }
  yield ']}';
}
