import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import {
  applyResolvedIds,
  escapeRegex,
  planContactQuery,
  searchPattern,
  touchesSubmissions,
} from '../src/domain/contact/search.js';
import {
  contactSort,
  decodeContactCursor,
  encodeContactCursor,
  keysetFilter,
  positionOf,
  withKeyset,
} from '../src/domain/contact/cursor.js';
import {
  allowedBulkActions,
  canPerformBulkAction,
  capabilityForBulkAction,
} from '../src/domain/contact/bulk.js';
import { planMerge } from '../src/domain/contact/merge.js';

/**
 * Pure inbox rules (blueprint 18.1: "search/filter matching logic, cursor
 * pagination correctness, merge re-linking logic, bulk permission
 * resolution").
 *
 * These decide whether a lead is findable, whether a page of the inbox is
 * correct, and whether a merge loses information - so they are tested as
 * behaviour rather than inferred from the integration suite passing.
 */

const verifiedOwner = { role: 'owner', emailVerified: true } as const;
const verifiedAdmin = { role: 'admin', emailVerified: true } as const;
const verifiedMember = { role: 'member', emailVerified: true } as const;

describe('search filter construction (blueprint 4.7)', () => {
  it('escapes a search term so it cannot act as a pattern', () => {
    expect(escapeRegex('a.b*c')).toBe('a\\.b\\*c');
    // A term of pure metacharacters matches only itself, not everything.
    expect(searchPattern('.*').test('anything')).toBe(false);
    expect(searchPattern('.*').test('literally .* here')).toBe(true);
  });

  it('matches a substring, which a word-based text index would not', () => {
    expect(searchPattern('acme').test('acmecorp.com')).toBe(true);
    expect(searchPattern('SMIT').test('Alice Smith')).toBe(true);
  });

  it('always constrains to the requested record status', () => {
    const plan = planContactQuery({}, 'active');
    expect(plan.contactFilter).toEqual({ recordStatus: 'active' });
    expect(planContactQuery({}, 'deleted').contactFilter).toEqual({ recordStatus: 'deleted' });
  });

  it('puts contact-owned dimensions on the contact query', () => {
    const assignee = new ObjectId();
    const plan = planContactQuery(
      { status: ['new', 'contacted'], tag: 'vip', assigneeUserId: assignee.toHexString() },
      'active',
    );
    expect(plan.contactFilter).toMatchObject({
      status: { $in: ['new', 'contacted'] },
      tags: 'vip',
    });
    expect(plan.submissionFilter).toBeNull();
  });

  it('treats "unassigned" as a real filter rather than an id', () => {
    const plan = planContactQuery({ assigneeUserId: 'unassigned' }, 'active');
    expect(plan.contactFilter).toMatchObject({ assigneeUserId: null });
  });

  it('puts event-owned dimensions on the submission query', () => {
    const widgetId = new ObjectId();
    const plan = planContactQuery(
      { widgetId: widgetId.toHexString(), domain: 'Shop.Example.com', country: 'DE' },
      'active',
    );
    expect(plan.submissionFilter).toMatchObject({
      widgetId,
      // Hosts are compared lowercased, the way they are stored.
      'source.domain': 'shop.example.com',
      'geo.countryCode': 'DE',
    });
  });

  it('applies the date filter to the submission, not to the contact', () => {
    /**
     * Blueprint 4.7 filters on "submission date". Applying that to the
     * contact's lastSubmissionAt would hide a contact whose first submission
     * landed in the range but whose latest did not.
     */
    const after = new Date('2026-01-01T00:00:00.000Z');
    const plan = planContactQuery({ submittedAfter: after }, 'active');
    expect(plan.submissionFilter).toMatchObject({ submittedAt: { $gte: after } });
    expect(plan.contactFilter).not.toHaveProperty('submittedAt');
  });

  it('skips the second round trip when nothing needs the event collection', () => {
    expect(touchesSubmissions({ status: ['new'] })).toBe(false);
    expect(touchesSubmissions({ tag: 'vip' })).toBe(false);
    expect(touchesSubmissions({ search: 'alice' })).toBe(true);
    expect(touchesSubmissions({ country: 'DE' })).toBe(true);
  });

  it('searches canonical fields and flags that values must be searched too', () => {
    const plan = planContactQuery({ search: 'alice' }, 'active');
    const or = (plan.contactFilter as Record<string, unknown>)['$or'] as unknown[];
    expect(or).toHaveLength(5);
    expect(plan.searchesSubmissionValues).toBe(true);
  });
});

describe('combining resolved contact ids', () => {
  const plan = planContactQuery({ status: ['new'] }, 'active');

  it('WIDENS on a search match, because a name match alone must still count', () => {
    const id = new ObjectId();
    const filter = applyResolvedIds(planContactQuery({ search: 'alice' }, 'active'), null, [id]);
    const or = (filter as Record<string, unknown>)['$or'] as unknown[];
    // The five canonical clauses plus the id clause.
    expect(or).toHaveLength(6);
  });

  it('NARROWS on a dimension filter, because it must exclude non-matches', () => {
    const id = new ObjectId();
    const filter = applyResolvedIds(plan, [id], null) as Record<string, unknown>;
    expect(filter['$and']).toEqual([{ _id: { $in: [id] } }]);
  });

  it('treats "no submission matched" as an empty result, not as no filter', () => {
    /**
     * The bug this guards: skipping an empty `$in` would silently return the
     * whole workspace for a filter that matched nothing.
     */
    const filter = applyResolvedIds(plan, [], null) as Record<string, unknown>;
    expect(filter['$and']).toEqual([{ _id: { $in: [] } }]);
  });

  it('keeps both halves when a search and a dimension filter are combined', () => {
    const narrow = new ObjectId();
    const match = new ObjectId();
    const filter = applyResolvedIds(
      planContactQuery({ search: 'alice', country: 'DE' }, 'active'),
      [narrow],
      [match],
    ) as Record<string, unknown>;
    const and = filter['$and'] as Record<string, unknown>[];
    expect(and).toHaveLength(2);
    expect(and[0]).toEqual({ _id: { $in: [narrow] } });
    // The search half survives as a nested $or rather than being overwritten.
    expect(and[1]).toHaveProperty('$or');
    expect(filter['$or']).toBeUndefined();
  });
});

describe('cursor pagination (blueprint 4.7, 10.1)', () => {
  const id = new ObjectId();
  const record = {
    _id: id,
    lastSubmissionAt: new Date('2026-05-01T10:00:00.000Z'),
    createdAt: new Date('2026-04-01T10:00:00.000Z'),
    normalizedEmail: 'alice@example.invalid',
  };

  it('round-trips a position', () => {
    const position = positionOf(record, 'lastSubmissionAt');
    expect(decodeContactCursor(encodeContactCursor(position))).toEqual(position);
  });

  it('reads the position from whichever field is being sorted', () => {
    expect(positionOf(record, 'createdAt').value).toBe('2026-04-01T10:00:00.000Z');
    expect(positionOf(record, 'normalizedEmail').value).toBe('alice@example.invalid');
  });

  it('carries no workspace id, because a cursor is not an authorization input', () => {
    const encoded = encodeContactCursor(positionOf(record, 'lastSubmissionAt'));
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    expect(decoded).toBe(`{"v":"2026-05-01T10:00:00.000Z","id":"${id.toHexString()}"}`);
    expect(decoded).not.toContain('workspace');
  });

  it('rejects a malformed cursor instead of throwing', () => {
    expect(decodeContactCursor('not-base64!!')).toBeNull();
    expect(decodeContactCursor(Buffer.from('{}').toString('base64url'))).toBeNull();
    expect(
      decodeContactCursor(Buffer.from('{"v":"x","id":"nope"}').toString('base64url')),
    ).toBeNull();
  });

  it('sorts with _id as a tiebreaker, in the same direction', () => {
    expect(contactSort('lastSubmissionAt', 'desc')).toEqual({ lastSubmissionAt: -1, _id: -1 });
    expect(contactSort('createdAt', 'asc')).toEqual({ createdAt: 1, _id: 1 });
  });

  it('builds the two-clause keyset comparison, so ties are resumable', () => {
    const position = positionOf(record, 'lastSubmissionAt');
    const filter = keysetFilter('lastSubmissionAt', 'desc', position) as Record<string, unknown>;
    const or = filter['$or'] as Record<string, unknown>[];
    expect(or).toHaveLength(2);
    expect(or[0]).toEqual({ lastSubmissionAt: { $lt: record.lastSubmissionAt } });
    // The clause without which a page boundary inside a group of equal
    // timestamps would repeat or skip rows.
    expect(or[1]).toEqual({ lastSubmissionAt: record.lastSubmissionAt, _id: { $lt: id } });
  });

  it('flips the comparator for ascending order', () => {
    const filter = keysetFilter(
      'normalizedEmail',
      'asc',
      positionOf(record, 'normalizedEmail'),
    ) as Record<string, unknown>;
    const or = filter['$or'] as Record<string, unknown>[];
    expect(or[0]).toEqual({ normalizedEmail: { $gt: 'alice@example.invalid' } });
  });

  it('refuses a cursor whose value does not parse as the sort field', () => {
    expect(
      keysetFilter('lastSubmissionAt', 'desc', { value: 'not-a-date', id: id.toHexString() }),
    ).toBeNull();
  });

  it('combines with a search filter without either $or clobbering the other', () => {
    const base = planContactQuery({ search: 'alice' }, 'active').contactFilter;
    const keyset = keysetFilter('lastSubmissionAt', 'desc', positionOf(record, 'lastSubmissionAt'));
    const combined = withKeyset(base, keyset) as Record<string, unknown>;
    const and = combined['$and'] as Record<string, unknown>[];
    expect(and).toHaveLength(2);
    // Both survive: the search's $or and the keyset's $or.
    expect(and[0]).toHaveProperty('$or');
    expect(and[1]).toHaveProperty('$or');
    expect(and[0]).toHaveProperty('recordStatus', 'active');
  });

  it('is a no-op without a cursor', () => {
    const base = planContactQuery({}, 'active').contactFilter;
    expect(withKeyset(base, null)).toBe(base);
  });
});

describe('bulk permission resolution (blueprint 4.7, 11)', () => {
  it('maps each action to an EXISTING section 11 capability', () => {
    expect(capabilityForBulkAction('status')).toBe('contact.workflow.write');
    expect(capabilityForBulkAction('assign')).toBe('contact.workflow.write');
    expect(capabilityForBulkAction('tag')).toBe('contact.workflow.write');
    expect(capabilityForBulkAction('delete')).toBe('contact.delete');
  });

  it('gives Owner and Admin every action, including soft-delete', () => {
    for (const subject of [verifiedOwner, verifiedAdmin]) {
      expect(allowedBulkActions(subject)).toEqual([
        'status',
        'assign',
        'tag',
        'untag',
        'archive',
        'delete',
      ]);
    }
  });

  it('gives a Member status, assign, and tag but never soft-delete', () => {
    /** The asymmetry blueprint 4.7 states, resolved through the matrix. */
    expect(canPerformBulkAction(verifiedMember, 'status')).toBe(true);
    expect(canPerformBulkAction(verifiedMember, 'assign')).toBe(true);
    expect(canPerformBulkAction(verifiedMember, 'tag')).toBe(true);
    expect(canPerformBulkAction(verifiedMember, 'delete')).toBe(false);
    expect(allowedBulkActions(verifiedMember)).not.toContain('delete');
  });

  it('does not gate contact actions on email verification', () => {
    // Only publishing and inviting carry the verified qualifier (blueprint 11).
    const unverified = { role: 'admin', emailVerified: false } as const;
    expect(canPerformBulkAction(unverified, 'delete')).toBe(true);
  });
});

describe('merge planning (blueprint 9.3)', () => {
  const base = {
    name: null as string | null,
    phone: null as string | null,
    company: null as string | null,
    tags: [] as readonly string[],
    manuallyEditedFields: [] as readonly string[],
    firstSubmissionAt: new Date('2026-03-01T00:00:00.000Z'),
    lastSubmissionAt: new Date('2026-03-05T00:00:00.000Z'),
    submissionCount: 1,
  };

  it('fills a gap on the survivor from the duplicate', () => {
    const plan = planMerge({ ...base }, { ...base, phone: '+49 30 111' });
    expect(plan.canonical).toEqual({ phone: '+49 30 111' });
    expect(plan.filledFields).toEqual(['phone']);
  });

  it('never overwrites a value the survivor already has', () => {
    /**
     * The guarantee that makes merge safe: a merge can add information and can
     * never destroy it. The duplicate's value stays visible in the submission
     * events being re-linked.
     */
    const plan = planMerge({ ...base, name: 'Alice Smith' }, { ...base, name: 'A. Smith' });
    expect(plan.canonical).toEqual({});
    expect(plan.filledFields).toEqual([]);
  });

  it('treats an empty string on the survivor as a gap', () => {
    const plan = planMerge({ ...base, company: '  ' }, { ...base, company: 'Acme' });
    expect(plan.canonical).toEqual({ company: 'Acme' });
  });

  it('carries a manual-edit marker only for a field that actually moved', () => {
    const plan = planMerge(
      { ...base, name: 'Kept' },
      { ...base, name: 'Ignored', phone: '+49 30 111', manuallyEditedFields: ['name', 'phone'] },
    );
    // `phone` moved across, so its protection moves with it; `name` did not, so
    // marking it would freeze a value no human ever chose.
    expect(plan.manuallyEditedFields).toEqual(['phone']);
  });

  it('keeps manual edits the survivor already had', () => {
    const plan = planMerge({ ...base, manuallyEditedFields: ['email'] }, { ...base });
    expect(plan.manuallyEditedFields).toEqual(['email']);
  });

  it('unions the tags', () => {
    const plan = planMerge({ ...base, tags: ['vip', 'de'] }, { ...base, tags: ['de', 'trial'] });
    expect(plan.tags).toEqual(['de', 'trial', 'vip']);
  });

  it('widens the activity window and adds the submission counts', () => {
    const plan = planMerge(
      { ...base, firstSubmissionAt: new Date('2026-03-01T00:00:00.000Z'), submissionCount: 2 },
      {
        ...base,
        firstSubmissionAt: new Date('2026-01-01T00:00:00.000Z'),
        lastSubmissionAt: new Date('2026-06-01T00:00:00.000Z'),
        submissionCount: 3,
      },
    );
    expect(plan.firstSubmissionAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(plan.lastSubmissionAt.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(plan.submissionCount).toBe(5);
  });
});
