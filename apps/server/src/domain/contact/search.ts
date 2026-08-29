import type { Filter } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { ContactRecord, SubmissionEventRecord } from '@lcp/database';
import type { ContactFilter } from '@lcp/contracts';

/**
 * Translating an inbox filter into two Mongo queries (blueprint 4.7).
 *
 * The filter spans two collections, because the blueprint puts the data in two
 * places. Status, assignee, and tags "live on the Contact" (4.6); the widget,
 * domain, page URL, geo, and the captured values themselves live on the
 * immutable SubmissionEvent. So a filter that touches the second has to be
 * resolved to a set of contact ids first, and intersected with the first.
 *
 * Everything here is pure. The service does the two round trips; this module
 * decides what to ask for, which is the part worth testing directly.
 */

/** Escape a user-supplied search term so it cannot act as a pattern. */
export function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Search is substring, case-insensitive, and deliberately not a text index.
 *
 * A MongoDB text index matches whole words with stemming, so searching "acme"
 * would not find "acmecorp.com" and searching "smit" would not find "Smith" -
 * both of which are exactly what someone typing into an inbox search box
 * expects to work. The regex is anchored to a single workspace by the scope
 * clause that every query carries, so the scan it implies is bounded by one
 * tenant's contacts rather than the collection.
 */
export function searchPattern(term: string): RegExp {
  return new RegExp(escapeRegex(term.trim()), 'i');
}

export interface ContactQueryPlan {
  /** The filter to run against `contacts`. */
  readonly contactFilter: Filter<ContactRecord>;
  /**
   * The filter to resolve to contact ids first, or null when the request does
   * not touch submission-event dimensions and the extra round trip is not
   * needed.
   */
  readonly submissionFilter: Filter<SubmissionEventRecord> | null;
  /** True when `search` must also be matched against captured values. */
  readonly searchesSubmissionValues: boolean;
}

/**
 * Whether a filter needs the submission-event collection consulted at all.
 *
 * Kept separate so the common case - an unfiltered inbox, or one filtered only
 * on status - stays a single indexed query.
 */
export function touchesSubmissions(filter: ContactFilter): boolean {
  return (
    filter.widgetId !== undefined ||
    filter.domain !== undefined ||
    filter.pageUrl !== undefined ||
    filter.country !== undefined ||
    filter.city !== undefined ||
    filter.submittedAfter !== undefined ||
    filter.submittedBefore !== undefined ||
    filter.search !== undefined
  );
}

/**
 * Build both halves of the query.
 *
 * `recordStatus` is supplied by the caller rather than hardcoded, because the
 * same builder serves the active inbox and the 30-day trash view - and having
 * one builder is what makes it impossible for the trash to accidentally use
 * looser filtering than the inbox.
 */
export function planContactQuery(
  filter: ContactFilter,
  recordStatus: ContactRecord['recordStatus'],
): ContactQueryPlan {
  const contactFilter: Record<string, unknown> = { recordStatus };

  if (filter.status !== undefined) {
    contactFilter['status'] = { $in: [...filter.status] };
  }

  if (filter.assigneeUserId !== undefined) {
    contactFilter['assigneeUserId'] =
      filter.assigneeUserId === 'unassigned' ? null : new ObjectId(filter.assigneeUserId);
  }

  if (filter.tag !== undefined) {
    contactFilter['tags'] = filter.tag;
  }

  const submissionFilter: Record<string, unknown> = {};

  if (filter.widgetId !== undefined) {
    submissionFilter['widgetId'] = new ObjectId(filter.widgetId);
  }
  if (filter.domain !== undefined) {
    submissionFilter['source.domain'] = filter.domain.toLowerCase();
  }
  if (filter.pageUrl !== undefined) {
    submissionFilter['source.pageUrl'] = filter.pageUrl;
  }
  if (filter.country !== undefined) {
    submissionFilter['geo.countryCode'] = filter.country;
  }
  if (filter.city !== undefined) {
    submissionFilter['geo.city'] = searchPattern(filter.city);
  }

  /**
   * The date filter reads "submission date" (blueprint 4.7), which is a
   * property of the event, not of the contact. Applying it to the contact's
   * `lastSubmissionAt` would give a subtly different answer: a contact whose
   * FIRST submission is inside the range but whose latest is outside it would
   * vanish, even though a submission genuinely arrived in that window.
   */
  if (filter.submittedAfter !== undefined || filter.submittedBefore !== undefined) {
    const range: Record<string, Date> = {};
    if (filter.submittedAfter !== undefined) range['$gte'] = filter.submittedAfter;
    if (filter.submittedBefore !== undefined) range['$lte'] = filter.submittedBefore;
    submissionFilter['submittedAt'] = range;
  }

  let searchesSubmissionValues = false;
  if (filter.search !== undefined) {
    const pattern = searchPattern(filter.search);
    /**
     * Blueprint 4.7: "search across name, email, and captured field values".
     * The first two are canonical fields; the third is a map on the event whose
     * keys are field types the widget chose, so it is matched with a $expr over
     * the object's values rather than by guessing key names.
     */
    contactFilter['$or'] = [
      { name: pattern },
      { email: pattern },
      { normalizedEmail: pattern },
      { company: pattern },
      { phone: pattern },
    ];
    searchesSubmissionValues = true;
  }

  return {
    contactFilter: contactFilter as Filter<ContactRecord>,
    submissionFilter:
      Object.keys(submissionFilter).length === 0
        ? null
        : (submissionFilter as Filter<SubmissionEventRecord>),
    searchesSubmissionValues,
  };
}

/**
 * The event-side half of a free-text search: any captured value containing the
 * term.
 *
 * `$expr` over `$objectToArray` is used because the value map's keys are chosen
 * by the widget's field list, so there is no fixed path to index on. This runs
 * only when a search term is present and always inside one workspace.
 */
export function submissionValueSearch(term: string): Filter<SubmissionEventRecord> {
  const pattern = escapeRegex(term.trim());
  return {
    $expr: {
      $anyElementTrue: {
        $map: {
          input: { $objectToArray: '$values' },
          as: 'entry',
          in: { $regexMatch: { input: '$$entry.v', regex: pattern, options: 'i' } },
        },
      },
    },
  } as unknown as Filter<SubmissionEventRecord>;
}

/**
 * Combine the contact-side filter with the ids resolved from submissions.
 *
 * Two different combinations, and the difference matters:
 *
 *  - a submission-dimension FILTER (widget, domain, country...) narrows the
 *    result, so its ids are intersected with an `_id: { $in }` clause;
 *  - a SEARCH term widens it, because a contact matches if their name matches
 *    OR one of their submitted values does. Intersecting there would silently
 *    drop every contact whose name matched but whose values did not.
 */
export function applyResolvedIds(
  plan: ContactQueryPlan,
  narrowingIds: readonly ObjectId[] | null,
  searchMatchIds: readonly ObjectId[] | null,
): Filter<ContactRecord> {
  const filter: Record<string, unknown> = { ...plan.contactFilter };

  if (searchMatchIds !== null && searchMatchIds.length > 0) {
    const existing = filter['$or'] as unknown[] | undefined;
    filter['$or'] = [...(existing ?? []), { _id: { $in: [...searchMatchIds] } }];
  }

  if (narrowingIds !== null) {
    /**
     * An empty resolved set is a real answer, not a missing one: no submission
     * matched, so no contact can. Encoding it as `$in: []` returns nothing,
     * which is correct - skipping the clause would return everything.
     */
    const clauses: unknown[] = [{ _id: { $in: [...narrowingIds] } }];
    if (filter['$or'] !== undefined) {
      clauses.push({ $or: filter['$or'] });
      delete filter['$or'];
    }
    filter['$and'] = clauses;
  }

  return filter as Filter<ContactRecord>;
}
