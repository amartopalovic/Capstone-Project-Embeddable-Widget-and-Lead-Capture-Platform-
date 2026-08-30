import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { COLLECTIONS, type ContactRecord } from '@lcp/database';
import type {
  ContactDetail,
  ContactPage,
  ContactSummary,
  WidgetConfig,
  WidgetDetail,
} from '@lcp/contracts';
import {
  STRONG_PASSWORD,
  TestClient,
  createAuthHarness,
  extractToken,
  mailpitBody,
  uniqueEmail,
  waitForEmail,
  type AuthHarness,
} from './helpers/auth-harness.js';

/**
 * The contact inbox backend - against real MongoDB, real Redis, and real
 * Mailpit (blueprint 18.2).
 *
 * The Stage 8a exit gate is three claims, and each has a named test below:
 *
 *   GATE 1: role-aware access is enforced on every new endpoint (blueprint 11);
 *   GATE 2: export output matches the active filter exactly (blueprint 4.7);
 *   GATE 3: live contact.created arrival is workspace-isolated (13.1, 9.1).
 *
 * The cross-tenant sweep is separate and covers every path this stage adds,
 * because blueprint 9.1 requires coverage per path rather than one
 * representative case.
 */

let harness: AuthHarness;

beforeAll(async () => {
  harness = await createAuthHarness();
}, 120_000);

beforeEach(async () => {
  await harness.clearRateLimits();
  // The harness gives the whole FILE one database, so each test starts from a
  // known contact set rather than from every earlier test's leftovers.
  for (const collection of [
    COLLECTIONS.contacts,
    COLLECTIONS.contactActivities,
    COLLECTIONS.submissionEvents,
    COLLECTIONS.consentEvents,
    COLLECTIONS.auditEvents,
    COLLECTIONS.outboxEvents,
  ]) {
    await harness.db.collection(collection).deleteMany({});
  }
});

afterAll(async () => {
  await harness?.teardown();
});

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

interface Actor {
  readonly api: TestClient;
  readonly email: string;
  readonly userId: string;
}

async function verifiedUser(label: string): Promise<Actor> {
  const email = uniqueEmail(label);
  const api = new TestClient(harness.baseUrl);

  await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
  const message = await waitForEmail(email, (m) => m.Subject.includes('Confirm'));
  await api.post('/api/v1/auth/verify', { token: extractToken(await mailpitBody(message.ID)) });
  await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });

  const me = await api.get('/api/v1/auth/me');
  return { api, email, userId: (me.body as { user: { id: string } }).user.id };
}

async function onboard(actor: Actor, name: string): Promise<string> {
  const response = await actor.api.post(
    '/api/v1/workspaces',
    { name, timezone: 'Europe/Berlin' },
    await actor.api.csrfHeaders(),
  );
  expect(response.status).toBe(201);
  return (response.body as { workspace: { id: string } }).workspace.id;
}

async function inviteAndAccept(
  inviter: Actor,
  invitee: Actor,
  role: 'admin' | 'member',
): Promise<void> {
  const sent = await inviter.api.post(
    '/api/v1/invitations',
    { email: invitee.email, role },
    await inviter.api.csrfHeaders(),
  );
  expect(sent.status).toBe(202);

  const message = await waitForEmail(invitee.email, (m) => m.Subject.includes('Join'));
  const accepted = await invitee.api.post(
    '/api/v1/invitations/accept',
    { token: extractToken(await mailpitBody(message.ID)) },
    await invitee.api.csrfHeaders(),
  );
  expect(accepted.status).toBe(200);
}

/** An owner with a workspace, plus an admin and a member in the same one. */
interface Team {
  readonly owner: Actor;
  readonly admin: Actor;
  readonly member: Actor;
  readonly workspaceId: string;
}

async function team(label: string): Promise<Team> {
  const owner = await verifiedUser(`${label}-owner`);
  const workspaceId = await onboard(owner, `${label} workspace`);
  const admin = await verifiedUser(`${label}-admin`);
  const member = await verifiedUser(`${label}-member`);
  await inviteAndAccept(owner, admin, 'admin');
  await inviteAndAccept(owner, member, 'member');
  return { owner, admin, member, workspaceId };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

let seedCounter = 0;

/**
 * Insert a contact directly.
 *
 * The list, filter, pagination, and export tests need many contacts with
 * controlled timestamps and geo values, and driving each through registration,
 * publishing, and a public submission would spend minutes producing data whose
 * exact shape those tests then have to work around. The tests that assert on
 * how a contact is CREATED use the real submission path instead.
 */
async function seedContact(
  workspaceId: string,
  overrides: Partial<ContactRecord> & { readonly submission?: Record<string, unknown> } = {},
): Promise<ObjectId> {
  seedCounter += 1;
  const id = new ObjectId();
  const now = new Date(`2026-06-${String((seedCounter % 27) + 1).padStart(2, '0')}T10:00:00.000Z`);
  const { submission, ...contactOverrides } = overrides;

  const record: ContactRecord = {
    _id: id,
    workspaceId: new ObjectId(workspaceId),
    email: `lead-${String(seedCounter)}@example.invalid`,
    normalizedEmail: `lead-${String(seedCounter)}@example.invalid`,
    name: `Lead ${String(seedCounter)}`,
    phone: null,
    company: null,
    manuallyEditedFields: [],
    status: 'new',
    assigneeUserId: null,
    tags: [],
    firstSubmissionAt: now,
    lastSubmissionAt: now,
    submissionCount: 1,
    consentState: 'none',
    consentUpdatedAt: null,
    retentionAnchorAt: now,
    version: 0,
    recordStatus: 'active',
    deletedAt: null,
    purgeAfter: null,
    mergedIntoContactId: null,
    createdAt: now,
    updatedAt: now,
    ...contactOverrides,
  };
  await harness.db.collection<ContactRecord>(COLLECTIONS.contacts).insertOne(record);

  if (submission !== undefined) {
    await harness.db.collection(COLLECTIONS.submissionEvents).insertOne({
      _id: new ObjectId(),
      workspaceId: new ObjectId(workspaceId),
      contactId: id,
      widgetId: new ObjectId(),
      widgetRevisionNumber: 1,
      values: { email: record.email },
      source: {
        origin: 'https://shop.example.com',
        domain: 'shop.example.com',
        pageUrl: null,
        referrer: null,
      },
      geo: null,
      ipPseudonym: 'a'.repeat(64),
      ipPseudonymPeriod: '2026-06',
      idempotencyKey: `seed-${id.toHexString()}`,
      submittedAt: record.lastSubmissionAt,
      ...submission,
    });
  }

  return id;
}

async function listContacts(actor: Actor, query = ''): Promise<ContactPage> {
  const response = await actor.api.get(`/api/v1/contacts${query}`);
  expect(response.status).toBe(200);
  return response.body as ContactPage;
}

// ---------------------------------------------------------------------------
// A real published widget, for the tests that need a genuine submission
// ---------------------------------------------------------------------------

const ALLOWED_ORIGIN = 'https://shop.example.com';
let idempotencyCounter = 0;

async function publishedWidget(owner: Actor, label: string): Promise<string> {
  const created = await owner.api.post(
    '/api/v1/widgets',
    { type: 'contact_form', name: `${label} widget` },
    await owner.api.csrfHeaders(),
  );
  const detail = created.body as WidgetDetail;
  const draft = detail.draft;
  if (draft === null) throw new Error('expected a draft');

  const config: WidgetConfig = {
    ...draft.config,
    targeting: { ...draft.config.targeting, allowedDomains: ['shop.example.com'] },
  };
  const saved = await owner.api.put(
    `/api/v1/widgets/${detail.widget.id}/draft`,
    { config, expectedVersion: draft.version },
    await owner.api.csrfHeaders(),
  );
  expect(saved.status).toBe(200);
  const published = await owner.api.post(
    `/api/v1/widgets/${detail.widget.id}/publish`,
    { expectedVersion: (saved.body as { version: number }).version },
    await owner.api.csrfHeaders(),
  );
  expect(published.status).toBe(200);
  return detail.widget.publicId;
}

async function submitLead(
  publicId: string,
  values: Record<string, string>,
): Promise<{ status: number }> {
  idempotencyCounter += 1;
  const response = await new TestClient(harness.baseUrl).post(
    `/widget/v1/submit/${publicId}`,
    {
      idempotencyKey: `contact-it-${String(Date.now())}-${String(idempotencyCounter)}`,
      values,
      pageUrl: 'https://shop.example.com/pricing',
      renderedAt: harness.clock.now().getTime() - 30_000,
    },
    { origin: ALLOWED_ORIGIN },
  );
  expect(response.status).toBe(202);
  return response;
}

// ---------------------------------------------------------------------------
// SSE client
// ---------------------------------------------------------------------------

interface SseFrame {
  readonly event: string;
  readonly data: string;
  readonly id: string | null;
}

/**
 * Open the stream and collect frames until a predicate is satisfied.
 *
 * Written by hand rather than with EventSource because the test needs the
 * session COOKIE on the request, and it needs to be able to assert that a
 * frame did NOT arrive - which means controlling the timeout rather than
 * waiting on an event that never fires.
 */
async function openStream(
  actor: Actor,
  options: { until: (frames: SseFrame[]) => boolean; timeoutMs?: number },
): Promise<{ frames: SseFrame[]; close: () => void; done: Promise<SseFrame[]> }> {
  const controller = new AbortController();
  const frames: SseFrame[] = [];

  const response = await fetch(`${harness.baseUrl}/api/v1/events`, {
    headers: { cookie: actor.api.cookieHeader, accept: 'text/event-stream' },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');

  const body = response.body;
  if (body === null) throw new Error('no stream body');

  const done = (async (): Promise<SseFrame[]> => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const deadline = Date.now() + (options.timeoutMs ?? 8_000);

    try {
      while (Date.now() < deadline) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value: undefined }>((resolve) =>
            setTimeout(() => resolve({ done: true, value: undefined }), 500),
          ),
        ]);
        if (chunk.value !== undefined) {
          buffer += decoder.decode(chunk.value, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const raw = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const lines = raw.split('\n');
            const data = lines.find((l) => l.startsWith('data: '))?.slice(6);
            /**
             * Only frames carrying data count as events. The stream also sends
             * a `retry:` preamble and `:` heartbeat comments, and counting
             * those made a test that waited for "any frame" finish before the
             * real event arrived.
             */
            if (data !== undefined && !raw.startsWith(':')) {
              frames.push({
                event: lines.find((l) => l.startsWith('event: '))?.slice(7) ?? 'message',
                data,
                id: lines.find((l) => l.startsWith('id: '))?.slice(4) ?? null,
              });
            }
            boundary = buffer.indexOf('\n\n');
          }
        }
        if (options.until(frames)) break;
      }
    } catch {
      // An aborted read is the expected way this ends.
    }
    return frames;
  })();

  return { frames, close: () => controller.abort(), done };
}

// ===========================================================================
// Listing, search, filters, pagination
// ===========================================================================

describe('inbox listing and filters (blueprint 4.7)', () => {
  it('lists a workspace contacts newest-first by default', async () => {
    const owner = await verifiedUser('list-basic');
    const workspaceId = await onboard(owner, 'List Co');

    await seedContact(workspaceId, {
      name: 'Older',
      lastSubmissionAt: new Date('2026-05-01T00:00:00.000Z'),
    });
    await seedContact(workspaceId, {
      name: 'Newer',
      lastSubmissionAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    const page = await listContacts(owner);
    expect(page.contacts.map((c) => c.name)).toEqual(['Newer', 'Older']);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('searches names, emails, and captured submission values', async () => {
    const owner = await verifiedUser('list-search');
    const workspaceId = await onboard(owner, 'Search Co');

    await seedContact(workspaceId, { name: 'Alice Anderson', email: 'aa@example.invalid' });
    await seedContact(workspaceId, { name: 'Bob Brown', email: 'bb@example.invalid' });
    /**
     * Blueprint 4.7 requires search across "captured field values", which live
     * on the immutable event rather than on the contact - so this one is only
     * findable if the event collection is consulted.
     */
    await seedContact(workspaceId, {
      name: 'Carol Clark',
      email: 'cc@example.invalid',
      submission: { values: { email: 'cc@example.invalid', message: 'Interested in ACME plan' } },
    });

    expect((await listContacts(owner, '?search=alice')).contacts.map((c) => c.name)).toEqual([
      'Alice Anderson',
    ]);
    expect((await listContacts(owner, '?search=bb@')).contacts.map((c) => c.name)).toEqual([
      'Bob Brown',
    ]);

    const byValue = await listContacts(owner, '?search=ACME');
    expect(byValue.contacts.map((c) => c.name)).toEqual(['Carol Clark']);
  });

  it('treats a search term as literal text, not as a pattern', async () => {
    const owner = await verifiedUser('list-regex');
    const workspaceId = await onboard(owner, 'Regex Co');
    await seedContact(workspaceId, { name: 'Dave' });

    // A crafted term must not match everything.
    expect((await listContacts(owner, '?search=.%2A')).contacts).toHaveLength(0);
  });

  it('filters by status, tag, assignee, and country', async () => {
    const team1 = await team('filters');
    const { workspaceId, owner, member } = team1;

    await seedContact(workspaceId, { name: 'New one', status: 'new' });
    await seedContact(workspaceId, { name: 'Qualified one', status: 'qualified', tags: ['vip'] });
    await seedContact(workspaceId, {
      name: 'Assigned one',
      assigneeUserId: new ObjectId(member.userId),
    });
    await seedContact(workspaceId, {
      name: 'German one',
      submission: {
        geo: {
          countryCode: 'DE',
          countryName: 'Germany',
          region: 'Berlin',
          city: 'Berlin',
          timezone: 'Europe/Berlin',
          provider: 'ip-api',
          usedFallback: false,
        },
      },
    });

    expect((await listContacts(owner, '?status=qualified')).contacts.map((c) => c.name)).toEqual([
      'Qualified one',
    ]);
    expect((await listContacts(owner, '?tag=vip')).contacts.map((c) => c.name)).toEqual([
      'Qualified one',
    ]);
    expect(
      (await listContacts(owner, `?assigneeUserId=${member.userId}`)).contacts.map((c) => c.name),
    ).toEqual(['Assigned one']);
    expect((await listContacts(owner, '?country=DE')).contacts.map((c) => c.name)).toEqual([
      'German one',
    ]);

    const unassigned = await listContacts(owner, '?assigneeUserId=unassigned');
    expect(unassigned.contacts.map((c) => c.name)).not.toContain('Assigned one');
  });

  it('returns nothing when a filter matches no submission, rather than everything', async () => {
    /**
     * The failure this guards is the dangerous direction: a filter that
     * resolves to no contact ids must EXCLUDE everything, not fall back to an
     * unfiltered list of the workspace's leads.
     */
    const owner = await verifiedUser('list-empty');
    const workspaceId = await onboard(owner, 'Empty Co');
    await seedContact(workspaceId, { name: 'Present' });
    await seedContact(workspaceId, { name: 'Also present' });

    const page = await listContacts(owner, '?country=ZZ');
    expect(page.contacts).toHaveLength(0);
  });

  it('paginates with a stable cursor that neither repeats nor skips a row', async () => {
    const owner = await verifiedUser('list-page');
    const workspaceId = await onboard(owner, 'Paging Co');

    /**
     * All five share ONE timestamp, which is the case a naive cursor gets
     * wrong: without the _id tiebreaker, the page boundary inside a tie either
     * repeats rows or drops them.
     */
    const sameMoment = new Date('2026-06-15T12:00:00.000Z');
    for (let index = 0; index < 5; index += 1) {
      await seedContact(workspaceId, {
        name: `Tied ${String(index)}`,
        lastSubmissionAt: sameMoment,
      });
    }

    const first = await listContacts(owner, '?limit=2');
    expect(first.contacts).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    const second = await listContacts(
      owner,
      `?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
    );
    const third = await listContacts(
      owner,
      `?limit=2&cursor=${encodeURIComponent(second.nextCursor ?? '')}`,
    );

    const seen = [...first.contacts, ...second.contacts, ...third.contacts].map((c) => c.id);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(third.hasMore).toBe(false);
  });

  it('ignores a malformed cursor instead of failing the request', async () => {
    const owner = await verifiedUser('list-badcursor');
    const workspaceId = await onboard(owner, 'Bad Cursor Co');
    await seedContact(workspaceId, { name: 'Still here' });

    const page = await listContacts(owner, '?cursor=not-a-real-cursor');
    expect(page.contacts.map((c) => c.name)).toEqual(['Still here']);
  });
});

// ===========================================================================
// Detail and timeline
// ===========================================================================

describe('contact detail and timeline (blueprint 4.6)', () => {
  it('returns canonical values plus the immutable submission history', async () => {
    const owner = await verifiedUser('detail');
    await onboard(owner, 'Detail Co');
    const publicId = await publishedWidget(owner, 'detail');

    await submitLead(publicId, {
      email: 'timeline@example.invalid',
      name: 'Timeline Person',
      message: 'First enquiry',
    });
    await submitLead(publicId, {
      email: 'timeline@example.invalid',
      name: 'Timeline Person',
      message: 'Second enquiry',
    });

    const page = await listContacts(owner);
    expect(page.contacts).toHaveLength(1);
    const contactId = page.contacts[0]?.id ?? '';

    const response = await owner.api.get(`/api/v1/contacts/${contactId}`);
    expect(response.status).toBe(200);
    const detail = response.body as ContactDetail;

    expect(detail.contact.submissionCount).toBe(2);
    // Two submissions, one contact - the distinction blueprint 4.6 draws.
    expect(detail.submissions).toHaveLength(2);
    expect(detail.submissions.map((s) => s.values['message'])).toContain('Second enquiry');
    expect(detail.submissions[0]?.pageUrl).toBe('https://shop.example.com/pricing');
  });

  it('tells the caller which actions their role allows, derived server-side', async () => {
    const { owner, member } = await team('detail-caps');
    const contactId = (await seedContact(await ownerWorkspace(owner))).toHexString();

    const asOwner = (await owner.api.get(`/api/v1/contacts/${contactId}`)).body as ContactDetail;
    expect(asOwner.canEditCanonical).toBe(true);
    expect(asOwner.canExport).toBe(true);
    expect(asOwner.allowedActions).toContain('delete');

    const asMember = (await member.api.get(`/api/v1/contacts/${contactId}`)).body as ContactDetail;
    expect(asMember.canEditCanonical).toBe(false);
    expect(asMember.canExport).toBe(false);
    expect(asMember.allowedActions).not.toContain('delete');
    expect(asMember.allowedActions).toContain('status');
  });

  it('answers 404 for an invalid id, the same as for another tenant', async () => {
    const owner = await verifiedUser('detail-404');
    await onboard(owner, 'NotFound Co');
    expect((await owner.api.get('/api/v1/contacts/not-an-id')).status).toBe(404);
    expect((await owner.api.get(`/api/v1/contacts/${new ObjectId().toHexString()}`)).status).toBe(
      404,
    );
  });
});

/** The workspace id of an actor's active workspace, read from the API. */
async function ownerWorkspace(actor: Actor): Promise<string> {
  const response = await actor.api.get('/api/v1/workspaces/current');
  const body = response.body as { workspace: { id: string } };
  return body.workspace.id;
}

// ===========================================================================
// GATE 1 - role-aware access on every new endpoint
// ===========================================================================

describe('GATE 1: role-aware access (blueprint 11)', () => {
  it('lets every role change status, assignee, and tags', async () => {
    const t = await team('gate1-workflow');
    const contactId = (await seedContact(t.workspaceId)).toHexString();

    for (const actor of [t.owner, t.admin, t.member]) {
      const response = await actor.api.patch(
        `/api/v1/contacts/${contactId}/workflow`,
        { status: 'contacted' },
        await actor.api.csrfHeaders(),
      );
      expect(response.status, `role write for ${actor.email}`).toBe(200);
    }

    const tagged = await t.member.api.patch(
      `/api/v1/contacts/${contactId}/workflow`,
      { tags: ['vip', 'de'] },
      await t.member.api.csrfHeaders(),
    );
    expect(tagged.status).toBe(200);
    expect((tagged.body as { contact: ContactSummary }).contact.tags).toEqual(['de', 'vip']);
  });

  it('lets every role add a note, and records who wrote it', async () => {
    const t = await team('gate1-note');
    const contactId = (await seedContact(t.workspaceId)).toHexString();

    const response = await t.member.api.post(
      `/api/v1/contacts/${contactId}/notes`,
      { note: 'Called, left a voicemail.' },
      await t.member.api.csrfHeaders(),
    );
    expect(response.status).toBe(200);

    const detail = (await t.owner.api.get(`/api/v1/contacts/${contactId}`)).body as ContactDetail;
    const note = detail.activities.find((a) => a.type === 'note_added');
    expect(note?.note).toBe('Called, left a voicemail.');
    // Blueprint 9.3: the actor is recorded, so a note is attributable.
    expect(note?.actorUserId).toBe(t.member.userId);
  });

  it('refuses a Member a canonical edit, a merge, an export, and a delete', async () => {
    const t = await team('gate1-deny');
    const contactId = (await seedContact(t.workspaceId)).toHexString();
    const headers = await t.member.api.csrfHeaders();

    expect(
      (
        await t.member.api.patch(
          `/api/v1/contacts/${contactId}`,
          { expectedVersion: 0, name: 'X' },
          headers,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await t.member.api.post(
          '/api/v1/contacts/merge',
          { survivorId: contactId, duplicateId: new ObjectId().toHexString() },
          headers,
        )
      ).status,
    ).toBe(403);
    expect((await t.member.api.get('/api/v1/contacts/export')).status).toBe(403);
    expect((await t.member.api.get('/api/v1/contacts/trash')).status).toBe(403);
    expect((await t.member.api.delete(`/api/v1/contacts/${contactId}`, headers)).status).toBe(403);
    expect(
      (await t.member.api.post(`/api/v1/contacts/${contactId}/recover`, undefined, headers)).status,
    ).toBe(403);
  });

  it('allows an Admin everything a Member is refused', async () => {
    const t = await team('gate1-admin');
    const contactId = (await seedContact(t.workspaceId)).toHexString();
    const headers = await t.admin.api.csrfHeaders();

    expect(
      (
        await t.admin.api.patch(
          `/api/v1/contacts/${contactId}`,
          { expectedVersion: 0, name: 'Edited' },
          headers,
        )
      ).status,
    ).toBe(200);
    expect((await t.admin.api.get('/api/v1/contacts/export')).status).toBe(200);
    expect((await t.admin.api.get('/api/v1/contacts/trash')).status).toBe(200);
    expect((await t.admin.api.delete(`/api/v1/contacts/${contactId}`, headers)).status).toBe(200);
  });

  it('refuses an unauthenticated caller on every endpoint', async () => {
    const anonymous = new TestClient(harness.baseUrl);
    for (const path of [
      '/api/v1/contacts',
      '/api/v1/contacts/trash',
      '/api/v1/contacts/export',
      '/api/v1/events',
    ]) {
      expect((await anonymous.get(path)).status, path).toBe(401);
    }
  });
});

// ===========================================================================
// Optimistic concurrency
// ===========================================================================

describe('canonical edits and optimistic concurrency (blueprint 9.3)', () => {
  it('accepts an edit against the current version and marks the field as edited', async () => {
    const owner = await verifiedUser('conc-ok');
    const workspaceId = await onboard(owner, 'Concurrency Co');
    const contactId = (await seedContact(workspaceId, { name: 'Original' })).toHexString();

    const response = await owner.api.patch(
      `/api/v1/contacts/${contactId}`,
      { expectedVersion: 0, name: 'Corrected Name' },
      await owner.api.csrfHeaders(),
    );
    expect(response.status).toBe(200);
    const contact = (response.body as { contact: ContactSummary }).contact;
    expect(contact.name).toBe('Corrected Name');
    expect(contact.version).toBe(1);
    expect(contact.manuallyEditedFields).toContain('name');
  });

  it('REFUSES a stale write rather than silently overwriting a teammate', async () => {
    const t = await team('conc-stale');
    const contactId = (await seedContact(t.workspaceId, { name: 'Original' })).toHexString();

    // Both read version 0.
    const firstEdit = await t.owner.api.patch(
      `/api/v1/contacts/${contactId}`,
      { expectedVersion: 0, name: 'Owner version' },
      await t.owner.api.csrfHeaders(),
    );
    expect(firstEdit.status).toBe(200);

    const secondEdit = await t.admin.api.patch(
      `/api/v1/contacts/${contactId}`,
      { expectedVersion: 0, name: 'Admin version' },
      await t.admin.api.csrfHeaders(),
    );
    expect(secondEdit.status).toBe(409);
    expect((secondEdit.body as { error: { code: string } }).error.code).toBe('stale_revision');

    // The first writer's value survived; nothing was silently lost.
    const detail = (await t.owner.api.get(`/api/v1/contacts/${contactId}`)).body as ContactDetail;
    expect(detail.contact.name).toBe('Owner version');
  });

  it('a later submission never overwrites an edited canonical value', async () => {
    /**
     * Blueprint 4.6: "Manually edited canonical values are not silently
     * overwritten by a later submission; the new raw values remain visible in
     * its immutable event." Both halves are asserted.
     */
    const owner = await verifiedUser('conc-submission');
    await onboard(owner, 'Overwrite Co');
    const publicId = await publishedWidget(owner, 'overwrite');

    await submitLead(publicId, {
      email: 'repeat@example.invalid',
      name: 'Typo Nmae',
      message: 'First',
    });

    const page = await listContacts(owner);
    const contactId = page.contacts[0]?.id ?? '';
    const version = page.contacts[0]?.version ?? 0;

    const edited = await owner.api.patch(
      `/api/v1/contacts/${contactId}`,
      { expectedVersion: version, name: 'Correct Name' },
      await owner.api.csrfHeaders(),
    );
    expect(edited.status).toBe(200);

    // The visitor submits again, with the original (wrong) spelling.
    await submitLead(publicId, {
      email: 'repeat@example.invalid',
      name: 'Typo Nmae',
      message: 'Second',
    });

    const detail = (await owner.api.get(`/api/v1/contacts/${contactId}`)).body as ContactDetail;
    expect(detail.contact.name).toBe('Correct Name');
    expect(detail.contact.submissionCount).toBe(2);
    // The raw value is still visible in the event, exactly as 4.6 requires.
    expect(detail.submissions.map((s) => s.values['name'])).toContain('Typo Nmae');
  });

  it('refuses an email edit that would collide with another contact', async () => {
    const owner = await verifiedUser('conc-clash');
    const workspaceId = await onboard(owner, 'Clash Co');
    await seedContact(workspaceId, {
      email: 'taken@example.invalid',
      normalizedEmail: 'taken@example.invalid',
    });
    const second = (await seedContact(workspaceId)).toHexString();

    const response = await owner.api.patch(
      `/api/v1/contacts/${second}`,
      { expectedVersion: 0, email: 'taken@example.invalid' },
      await owner.api.csrfHeaders(),
    );
    // A conflict, not an implicit merge - merging is a deliberate action with
    // its own audit trail.
    expect(response.status).toBe(409);
    expect((response.body as { error: { code: string } }).error.code).toBe('conflict');
  });
});

// ===========================================================================
// Merge
// ===========================================================================

describe('contact merge (blueprint 9.3)', () => {
  it('re-links events and activities, retires the duplicate, and audits it', async () => {
    const owner = await verifiedUser('merge-ok');
    const workspaceId = await onboard(owner, 'Merge Co');

    const survivor = await seedContact(workspaceId, {
      name: 'Alice Anderson',
      email: 'alice@example.invalid',
      normalizedEmail: 'alice@example.invalid',
      tags: ['vip'],
      submission: {},
    });
    const duplicate = await seedContact(workspaceId, {
      name: null,
      phone: '+49 30 111',
      email: 'a.anderson@example.invalid',
      normalizedEmail: 'a.anderson@example.invalid',
      tags: ['de'],
      submission: {},
    });

    // A note on the duplicate, so activity re-linking is observable.
    await owner.api.post(
      `/api/v1/contacts/${duplicate.toHexString()}/notes`,
      { note: 'Duplicate note' },
      await owner.api.csrfHeaders(),
    );

    const response = await owner.api.post(
      '/api/v1/contacts/merge',
      { survivorId: survivor.toHexString(), duplicateId: duplicate.toHexString() },
      await owner.api.csrfHeaders(),
    );
    expect(response.status).toBe(200);
    const body = response.body as { contact: ContactSummary; movedSubmissions: number };
    expect(body.movedSubmissions).toBe(1);

    // The gap was filled; the survivor's own name was not touched.
    expect(body.contact.name).toBe('Alice Anderson');
    expect(body.contact.phone).toBe('+49 30 111');
    expect(body.contact.tags).toEqual(['de', 'vip']);
    expect(body.contact.submissionCount).toBe(2);

    const detail = (await owner.api.get(`/api/v1/contacts/${survivor.toHexString()}`))
      .body as ContactDetail;
    expect(detail.submissions).toHaveLength(2);
    expect(detail.activities.some((a) => a.note === 'Duplicate note')).toBe(true);
    expect(detail.activities.some((a) => a.type === 'merged_from')).toBe(true);

    // The duplicate is retired: gone from the inbox AND from the trash.
    const page = await listContacts(owner);
    expect(page.contacts.map((c) => c.id)).toEqual([survivor.toHexString()]);
    const trash = (await owner.api.get('/api/v1/contacts/trash')).body as ContactPage;
    expect(trash.contacts.map((c) => c.id)).not.toContain(duplicate.toHexString());

    // Blueprint 9.3 requires the actor and correlation id on a merge.
    const audit = await harness.db
      .collection(COLLECTIONS.auditEvents)
      .findOne({ type: 'contact.merged' });
    expect(audit).not.toBeNull();
    expect((audit as unknown as { correlationId: string }).correlationId).toBeTruthy();
  });

  it('refuses to merge a contact into itself', async () => {
    const owner = await verifiedUser('merge-self');
    const workspaceId = await onboard(owner, 'Self Co');
    const id = (await seedContact(workspaceId)).toHexString();

    const response = await owner.api.post(
      '/api/v1/contacts/merge',
      { survivorId: id, duplicateId: id },
      await owner.api.csrfHeaders(),
    );
    expect(response.status).toBe(409);
  });
});

// ===========================================================================
// Bulk
// ===========================================================================

describe('bulk actions and the role split (blueprint 4.7)', () => {
  it('lets a Member bulk-change status, assign, and tag', async () => {
    const t = await team('bulk-member');
    const ids = [
      (await seedContact(t.workspaceId)).toHexString(),
      (await seedContact(t.workspaceId)).toHexString(),
    ];
    const headers = await t.member.api.csrfHeaders();

    const status = await t.member.api.post(
      '/api/v1/contacts/bulk',
      { action: 'status', contactIds: ids, status: 'qualified' },
      headers,
    );
    expect(status.status).toBe(200);
    expect((status.body as { changed: number }).changed).toBe(2);

    const tagged = await t.member.api.post(
      '/api/v1/contacts/bulk',
      { action: 'tag', contactIds: ids, tag: 'batch' },
      headers,
    );
    expect(tagged.status).toBe(200);

    const page = await listContacts(t.member, '?tag=batch');
    expect(page.contacts).toHaveLength(2);
    expect(page.contacts.every((c) => c.status === 'qualified')).toBe(true);
  });

  it('REFUSES a Member a bulk soft-delete while allowing an Admin', async () => {
    const t = await team('bulk-delete');
    const ids = [(await seedContact(t.workspaceId)).toHexString()];

    const refused = await t.member.api.post(
      '/api/v1/contacts/bulk',
      { action: 'delete', contactIds: ids },
      await t.member.api.csrfHeaders(),
    );
    expect(refused.status).toBe(403);
    // Nothing was written before the refusal.
    expect((await listContacts(t.owner)).contacts).toHaveLength(1);

    const allowed = await t.admin.api.post(
      '/api/v1/contacts/bulk',
      { action: 'delete', contactIds: ids },
      await t.admin.api.csrfHeaders(),
    );
    expect(allowed.status).toBe(200);
    expect((await listContacts(t.owner)).contacts).toHaveLength(0);
  });

  it('records an activity entry per affected contact, not one for the batch', async () => {
    const t = await team('bulk-activity');
    const ids = [
      (await seedContact(t.workspaceId)).toHexString(),
      (await seedContact(t.workspaceId)).toHexString(),
    ];
    await t.owner.api.post(
      '/api/v1/contacts/bulk',
      { action: 'archive', contactIds: ids },
      await t.owner.api.csrfHeaders(),
    );

    for (const id of ids) {
      const detail = (await t.owner.api.get(`/api/v1/contacts/${id}`)).body as ContactDetail;
      expect(detail.contact.status).toBe('archived');
      // "Someone bulk-archived 40 leads" has to be answerable per lead.
      expect(detail.activities.some((a) => a.type === 'status_changed')).toBe(true);
    }
  });
});

// ===========================================================================
// Trash and recovery
// ===========================================================================

describe('30-day contact trash (blueprint 9.5)', () => {
  it('soft-deletes with a purge date, hides from the inbox, and recovers', async () => {
    const owner = await verifiedUser('trash');
    const workspaceId = await onboard(owner, 'Trash Co');
    const id = (await seedContact(workspaceId, { name: 'Deletable' })).toHexString();

    const deleted = await owner.api.delete(`/api/v1/contacts/${id}`, await owner.api.csrfHeaders());
    expect(deleted.status).toBe(200);

    expect((await listContacts(owner)).contacts).toHaveLength(0);
    const trash = (await owner.api.get('/api/v1/contacts/trash')).body as ContactPage;
    expect(trash.contacts.map((c) => c.name)).toEqual(['Deletable']);

    const record = await harness.db
      .collection<ContactRecord>(COLLECTIONS.contacts)
      .findOne({ _id: new ObjectId(id) });
    const purgeAfter = record?.purgeAfter?.getTime() ?? 0;
    const deletedAt = record?.deletedAt?.getTime() ?? 0;
    expect(Math.round((purgeAfter - deletedAt) / 86_400_000)).toBe(30);

    const recovered = await owner.api.post(
      `/api/v1/contacts/${id}/recover`,
      undefined,
      await owner.api.csrfHeaders(),
    );
    expect(recovered.status).toBe(200);
    expect((await listContacts(owner)).contacts.map((c) => c.name)).toEqual(['Deletable']);
  });

  it('refuses to recover a contact whose address was taken meanwhile', async () => {
    const owner = await verifiedUser('trash-clash');
    const workspaceId = await onboard(owner, 'Trash Clash Co');
    const id = (
      await seedContact(workspaceId, {
        email: 'reused@example.invalid',
        normalizedEmail: 'reused@example.invalid',
      })
    ).toHexString();

    await owner.api.delete(`/api/v1/contacts/${id}`, await owner.api.csrfHeaders());
    await seedContact(workspaceId, {
      email: 'reused@example.invalid',
      normalizedEmail: 'reused@example.invalid',
    });

    const recovered = await owner.api.post(
      `/api/v1/contacts/${id}/recover`,
      undefined,
      await owner.api.csrfHeaders(),
    );
    expect(recovered.status).toBe(409);
  });
});

// ===========================================================================
// GATE 2 - export matches the active filter
// ===========================================================================

describe('GATE 2: export matches the active filter (blueprint 4.7)', () => {
  it('exports exactly the rows the same filter lists, and nothing else', async () => {
    const owner = await verifiedUser('export-filter');
    const workspaceId = await onboard(owner, 'Export Co');

    await seedContact(workspaceId, { name: 'Keep One', status: 'qualified' });
    await seedContact(workspaceId, { name: 'Keep Two', status: 'qualified' });
    await seedContact(workspaceId, { name: 'Drop One', status: 'new' });
    await seedContact(workspaceId, { name: 'Drop Two', status: 'archived' });

    const listed = await listContacts(owner, '?status=qualified');
    expect(listed.contacts.map((c) => c.name).sort()).toEqual(['Keep One', 'Keep Two']);

    const response = await owner.api.get('/api/v1/contacts/export?status=qualified&format=csv');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('attachment');

    const csv = response.body as string;
    const rows = csv.trim().split('\r\n');
    // Header plus exactly the two listed rows.
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('email');
    expect(csv).toContain('Keep One');
    expect(csv).toContain('Keep Two');
    expect(csv).not.toContain('Drop One');
    expect(csv).not.toContain('Drop Two');
  });

  it('exports the same set as JSON', async () => {
    const owner = await verifiedUser('export-json');
    const workspaceId = await onboard(owner, 'Export JSON Co');
    await seedContact(workspaceId, { name: 'Included', tags: ['vip'] });
    await seedContact(workspaceId, { name: 'Excluded' });

    const response = await owner.api.get('/api/v1/contacts/export?tag=vip&format=json');
    expect(response.status).toBe(200);
    const body = response.body as { contacts: { name: string }[] };
    expect(body.contacts.map((c) => c.name)).toEqual(['Included']);
  });

  it('never dumps internal record fields', async () => {
    const owner = await verifiedUser('export-fields');
    const workspaceId = await onboard(owner, 'Export Fields Co');
    await seedContact(workspaceId, { name: 'Row' });

    const csv = (await owner.api.get('/api/v1/contacts/export?format=csv')).body as string;
    const header = csv.split('\r\n')[0] ?? '';
    // The allowlist, not the record: no version counter, no purge schedule, no
    // merge pointer, no workspace id.
    expect(header).not.toContain('version');
    expect(header).not.toContain('purgeAfter');
    expect(header).not.toContain('mergedIntoContactId');
    expect(header).not.toContain('workspaceId');
  });

  it('neutralises a spreadsheet formula in an exported value', async () => {
    const owner = await verifiedUser('export-formula');
    const workspaceId = await onboard(owner, 'Formula Co');
    await seedContact(workspaceId, { name: '=1+1' });

    const csv = (await owner.api.get('/api/v1/contacts/export?format=csv')).body as string;
    // Prefixed with a tab, so a colleague opening the file does not execute it.
    expect(csv).toContain('"\t=1+1"');
  });

  it('records an audit entry naming the actor, the format, and the row count', async () => {
    const owner = await verifiedUser('export-audit');
    const workspaceId = await onboard(owner, 'Export Audit Co');
    await seedContact(workspaceId);
    await seedContact(workspaceId);

    await owner.api.get('/api/v1/contacts/export?format=csv');

    const audit = (await harness.db
      .collection(COLLECTIONS.auditEvents)
      .findOne({ type: 'contact.exported' })) as {
      actorUserId: ObjectId;
      correlationId: string;
      metadata: { rowCount: number; format: string };
    } | null;

    expect(audit).not.toBeNull();
    expect(audit?.metadata.rowCount).toBe(2);
    expect(audit?.metadata.format).toBe('csv');
    expect(audit?.actorUserId.toHexString()).toBe(owner.userId);
    expect(audit?.correlationId).toBeTruthy();
    // The filter is recorded, never the exported rows themselves.
    expect(JSON.stringify(audit?.metadata)).not.toContain('@example.invalid');
  });
});

// ===========================================================================
// GATE 3 - live arrival, workspace-isolated
// ===========================================================================

describe('GATE 3: live contact.created is workspace-isolated (blueprint 13.1, 9.1)', () => {
  it('delivers contact.created to the owning workspace stream only', async () => {
    const owner = await verifiedUser('sse-owner');
    await onboard(owner, 'Live Co');
    const publicId = await publishedWidget(owner, 'sse');

    const outsider = await verifiedUser('sse-outsider');
    await onboard(outsider, 'Other Live Co');

    const mine = await openStream(owner, {
      until: (frames) => frames.some((f) => f.event === 'contact.created'),
    });
    const theirs = await openStream(outsider, {
      until: (frames) => frames.some((f) => f.event === 'contact.created'),
      timeoutMs: 4_000,
    });

    await submitLead(publicId, { email: 'live@example.invalid', message: 'Live one' });

    const received = await mine.done;
    const created = received.find((f) => f.event === 'contact.created');
    expect(created).toBeDefined();

    const payload = JSON.parse(created?.data ?? '{}') as {
      type: string;
      data: { contactId: string };
    };
    expect(payload.type).toBe('contact.created');
    expect(payload.data.contactId).toBeTruthy();
    // Structural only: an SSE frame is not the place to broadcast a lead's PII.
    expect(created?.data).not.toContain('live@example.invalid');
    // The `id:` field is what a reconnecting client sends back.
    expect(created?.id).toBeTruthy();

    mine.close();

    // The other tenant's stream saw nothing at all.
    const otherFrames = await theirs.done;
    expect(otherFrames.filter((f) => f.event === 'contact.created')).toHaveLength(0);
    theirs.close();
  }, 40_000);

  it('raises contact.updated rather than contact.created for a repeat submission', async () => {
    const owner = await verifiedUser('sse-repeat');
    await onboard(owner, 'Repeat Live Co');
    const publicId = await publishedWidget(owner, 'sse-repeat');

    await submitLead(publicId, { email: 'again@example.invalid', message: 'First' });

    const stream = await openStream(owner, {
      until: (frames) => frames.length > 0,
    });
    await submitLead(publicId, { email: 'again@example.invalid', message: 'Second' });

    const frames = await stream.done;
    stream.close();
    // Telling the UI a contact was created would make it insert a duplicate row.
    expect(frames.map((f) => f.event)).toContain('contact.updated');
    expect(frames.map((f) => f.event)).not.toContain('contact.created');
  }, 40_000);

  it('refuses a stream to a caller with no membership in the workspace', async () => {
    /**
     * Blueprint 13.1: "Authorization is rechecked when the stream begins."
     * A removed member cannot open a stream at all - not merely stop receiving
     * on the next heartbeat.
     */
    const t = await team('sse-revoke');

    const removed = await t.owner.api.delete(
      `/api/v1/members/${t.member.userId}`,
      await t.owner.api.csrfHeaders(),
    );
    // The members endpoint answers 204 on a successful removal.
    expect(removed.status).toBe(204);

    const response = await fetch(`${harness.baseUrl}/api/v1/events`, {
      headers: { cookie: t.member.api.cookieHeader, accept: 'text/event-stream' },
    });
    expect(response.status).toBe(404);
    await response.body?.cancel();
  }, 40_000);
});

// ===========================================================================
// Cross-tenant sweep (blueprint 9.1)
// ===========================================================================

describe('cross-tenant denial on every new path (blueprint 9.1)', () => {
  it('refuses read, edit, merge, delete, and recover across tenants', async () => {
    const insider = await verifiedUser('xt-insider');
    const insiderWorkspace = await onboard(insider, 'Insider Co');
    const contactId = (await seedContact(insiderWorkspace, { name: 'Private Lead' })).toHexString();

    const outsider = await verifiedUser('xt-outsider');
    await onboard(outsider, 'Outsider Co');
    const headers = await outsider.api.csrfHeaders();

    // Read
    expect((await outsider.api.get(`/api/v1/contacts/${contactId}`)).status).toBe(404);
    // List - the other tenant's lead is simply not there.
    const page = await listContacts(outsider);
    expect(page.contacts).toHaveLength(0);
    // Workflow write
    expect(
      (
        await outsider.api.patch(
          `/api/v1/contacts/${contactId}/workflow`,
          { status: 'converted' },
          headers,
        )
      ).status,
    ).toBe(404);
    // Note
    expect(
      (await outsider.api.post(`/api/v1/contacts/${contactId}/notes`, { note: 'x' }, headers))
        .status,
    ).toBe(404);
    // Canonical edit
    expect(
      (
        await outsider.api.patch(
          `/api/v1/contacts/${contactId}`,
          { expectedVersion: 0, name: 'X' },
          headers,
        )
      ).status,
    ).toBe(404);
    // Merge
    expect(
      (
        await outsider.api.post(
          '/api/v1/contacts/merge',
          { survivorId: contactId, duplicateId: new ObjectId().toHexString() },
          headers,
        )
      ).status,
    ).toBe(404);
    // Soft-delete and recover
    expect((await outsider.api.delete(`/api/v1/contacts/${contactId}`, headers)).status).toBe(404);
    expect(
      (await outsider.api.post(`/api/v1/contacts/${contactId}/recover`, undefined, headers)).status,
    ).toBe(404);

    // Nothing was actually changed in the other tenant.
    const untouched = (await insider.api.get(`/api/v1/contacts/${contactId}`))
      .body as ContactDetail;
    expect(untouched.contact.name).toBe('Private Lead');
    expect(untouched.contact.status).toBe('new');
  });

  it('refuses a bulk action naming another tenant contacts', async () => {
    const insider = await verifiedUser('xt-bulk-in');
    const insiderWorkspace = await onboard(insider, 'Bulk Insider Co');
    const contactId = (await seedContact(insiderWorkspace, { status: 'new' })).toHexString();

    const outsider = await verifiedUser('xt-bulk-out');
    await onboard(outsider, 'Bulk Outsider Co');

    const response = await outsider.api.post(
      '/api/v1/contacts/bulk',
      { action: 'status', contactIds: [contactId], status: 'converted' },
      await outsider.api.csrfHeaders(),
    );
    // The request is well-formed and the caller may bulk-edit - in THEIR
    // workspace. It changes nothing, which is the answer that proves the scope
    // is applied to the write rather than only to the read.
    expect(response.status).toBe(200);
    expect((response.body as { changed: number }).changed).toBe(0);

    const detail = (await insider.api.get(`/api/v1/contacts/${contactId}`)).body as ContactDetail;
    expect(detail.contact.status).toBe('new');
  });

  it('never exports another tenant contacts', async () => {
    const insider = await verifiedUser('xt-export-in');
    const insiderWorkspace = await onboard(insider, 'Export Insider Co');
    await seedContact(insiderWorkspace, { name: 'Confidential Lead' });

    const outsider = await verifiedUser('xt-export-out');
    const outsiderWorkspace = await onboard(outsider, 'Export Outsider Co');
    await seedContact(outsiderWorkspace, { name: 'Own Lead' });

    const csv = (await outsider.api.get('/api/v1/contacts/export?format=csv')).body as string;
    expect(csv).toContain('Own Lead');
    expect(csv).not.toContain('Confidential Lead');
  });

  it('keeps activity history inside its own tenant', async () => {
    const insider = await verifiedUser('xt-activity-in');
    const insiderWorkspace = await onboard(insider, 'Activity Insider Co');
    const contactId = (await seedContact(insiderWorkspace)).toHexString();
    await insider.api.post(
      `/api/v1/contacts/${contactId}/notes`,
      { note: 'Internal only' },
      await insider.api.csrfHeaders(),
    );

    const stored = await harness.db.collection(COLLECTIONS.contactActivities).find({}).toArray();
    expect(stored).toHaveLength(1);
    expect((stored[0] as unknown as { workspaceId: ObjectId }).workspaceId.toHexString()).toBe(
      insiderWorkspace,
    );
  });
});
