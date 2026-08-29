import type { ContactRecord } from '@lcp/database';

/**
 * What survives a merge (blueprint 9.3: "Contact merge selects a surviving
 * Contact, re-links events and activities, preserves an audit trail, and
 * retires the duplicate").
 *
 * The blueprint says the survivor is SELECTED, so this never guesses which of
 * two contacts is the real one - the caller names it. What is decided here is
 * narrower and purely mechanical: for each canonical field, does the survivor
 * keep its own value or inherit the duplicate's?
 *
 * The rule, in one sentence: a value only ever fills a gap.
 *
 * A merge must not be able to overwrite information. If the survivor has a
 * phone number and the duplicate has a different one, the survivor's wins and
 * the duplicate's is not lost either - it stays visible in the submission
 * events that are being re-linked, which is exactly the guarantee blueprint 4.6
 * makes about a later submission never overwriting an edited canonical value.
 * Merging two records is a bigger version of the same risk, so it gets the same
 * answer rather than a more permissive one.
 */

export interface MergeOutcome {
  /** Canonical fields to write onto the survivor. Empty when nothing filled. */
  readonly canonical: Partial<Pick<ContactRecord, 'name' | 'phone' | 'company'>>;
  /** The survivor's manual-edit list, plus any the duplicate contributed. */
  readonly manuallyEditedFields: readonly string[];
  /** Union of both tag sets, sorted for a stable stored order. */
  readonly tags: readonly string[];
  readonly firstSubmissionAt: Date;
  readonly lastSubmissionAt: Date;
  readonly submissionCount: number;
  /** Named for the audit entry: which fields the duplicate actually filled. */
  readonly filledFields: readonly string[];
}

const CANONICAL_FIELDS = ['name', 'phone', 'company'] as const;

function isEmpty(value: string | null): boolean {
  return value === null || value.trim() === '';
}

export function planMerge(
  survivor: Pick<
    ContactRecord,
    | 'name'
    | 'phone'
    | 'company'
    | 'tags'
    | 'manuallyEditedFields'
    | 'firstSubmissionAt'
    | 'lastSubmissionAt'
    | 'submissionCount'
  >,
  duplicate: Pick<
    ContactRecord,
    | 'name'
    | 'phone'
    | 'company'
    | 'tags'
    | 'manuallyEditedFields'
    | 'firstSubmissionAt'
    | 'lastSubmissionAt'
    | 'submissionCount'
  >,
): MergeOutcome {
  const canonical: Record<string, string> = {};
  const filledFields: string[] = [];

  for (const field of CANONICAL_FIELDS) {
    const mine = survivor[field];
    const theirs = duplicate[field];
    if (isEmpty(mine) && !isEmpty(theirs) && theirs !== null) {
      canonical[field] = theirs;
      filledFields.push(field);
    }
  }

  /**
   * A field the duplicate's owner edited by hand stays protected on the
   * survivor - but only if the value actually moved across. Marking a field as
   * manually edited when the survivor kept its own value would freeze a value
   * no human ever chose against future submissions.
   */
  const manual = new Set(survivor.manuallyEditedFields);
  for (const field of duplicate.manuallyEditedFields) {
    if (filledFields.includes(field)) manual.add(field);
  }

  const tags = [...new Set([...survivor.tags, ...duplicate.tags])].sort();

  return {
    canonical: canonical as Partial<Pick<ContactRecord, 'name' | 'phone' | 'company'>>,
    manuallyEditedFields: [...manual].sort(),
    tags,
    // The merged contact has genuinely been active since the earlier of the
    // two first-contacts, and as recently as the later of the two last ones.
    firstSubmissionAt: new Date(
      Math.min(survivor.firstSubmissionAt.getTime(), duplicate.firstSubmissionAt.getTime()),
    ),
    lastSubmissionAt: new Date(
      Math.max(survivor.lastSubmissionAt.getTime(), duplicate.lastSubmissionAt.getTime()),
    ),
    submissionCount: survivor.submissionCount + duplicate.submissionCount,
    filledFields,
  };
}
