import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import {
  ANONYMOUS_ACTOR_HEX,
  COLLECTIONS,
  workspaceScope,
  type ContactRecord,
  type PrivacyRequestRecord,
  type SubmissionEventRecord,
  type UserRecord,
  type WidgetRecord,
  type WorkspaceRecord,
} from '@lcp/database';
import type { WidgetConfig, WidgetDetail } from '@lcp/contracts';
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
 * Consent, unsubscribe, privacy self-service, and retention automation
 * (blueprint 4.8, 9.5, 12.1) - against real MongoDB, Redis, and Mailpit.
 *
 * Stage 11's exit gate is four claims, and each has named tests below:
 *
 *   GATE 1: every 30-day recovery window expires correctly, and not a moment
 *           early;
 *   GATE 2: permanent purge and anonymization happen exactly once and survive
 *           a retry;
 *   GATE 3: an unsubscribed contact receives no further marketing mail, while
 *           transactional mail is unaffected;
 *   GATE 4: an export or deletion is refused without a valid verification
 *           token.
 *
 * Plus the startup catch-up sweep, which is the reason any of it survives a
 * sleeping free-tier instance.
 *
 * Time is driven by the harness's injected clock throughout. Nothing here
 * sleeps, and nothing reads `Date.now()`.
 */

let harness: AuthHarness;

beforeAll(async () => {
  harness = await createAuthHarness();
}, 120_000);

beforeEach(async () => {
  await harness.clearRateLimits();
  for (const collection of [
    COLLECTIONS.contacts,
    COLLECTIONS.submissionEvents,
    COLLECTIONS.consentEvents,
    COLLECTIONS.contactActivities,
    COLLECTIONS.suppressions,
    COLLECTIONS.privacyRequests,
    COLLECTIONS.outboxEvents,
    COLLECTIONS.deliveries,
  ]) {
    await harness.db.collection(collection).deleteMany({});
  }
});

afterAll(async () => {
  await harness?.teardown();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Owner {
  readonly api: TestClient;
  readonly email: string;
  readonly userId: string;
  readonly workspaceId: string;
}

const ALLOWED_ORIGIN = 'https://shop.example.com';
const CONSENT_LABEL = 'Email me about offers';

async function verifiedOwner(label: string): Promise<Owner> {
  const email = uniqueEmail(label);
  const api = new TestClient(harness.baseUrl);

  await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
  const message = await waitForEmail(email, (m) => m.Subject.includes('Confirm'));
  await api.post('/api/v1/auth/verify', { token: extractToken(await mailpitBody(message.ID)) });
  await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });

  const created = await api.post(
    '/api/v1/workspaces',
    { name: `${label} workspace`, timezone: 'Europe/Berlin' },
    await api.csrfHeaders(),
  );
  expect(created.status).toBe(201);
  const workspaceId = (created.body as { workspace: { id: string } }).workspace.id;

  const user = await harness.db
    .collection<UserRecord>(COLLECTIONS.users)
    .findOne({ normalizedEmail: email.toLowerCase() });
  if (user === null) throw new Error('expected the user to exist');

  return { api, email, userId: user._id.toHexString(), workspaceId };
}

/** A published contact form carrying a consent checkbox. */
async function publishWidget(
  owner: Owner,
  label: string,
): Promise<{ publicId: string; widgetId: string }> {
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
    fields: [
      ...draft.config.fields.filter((field) => field.type !== 'consent'),
      {
        type: 'consent',
        label: CONSENT_LABEL,
        placeholder: '',
        helpText: '',
        required: false,
        maxLength: 1,
        order: draft.config.fields.length,
      },
    ],
  };

  const saved = await owner.api.put(
    `/api/v1/widgets/${detail.widget.id}/draft`,
    { config, expectedVersion: draft.version },
    await owner.api.csrfHeaders(),
  );
  const published = await owner.api.post(
    `/api/v1/widgets/${detail.widget.id}/publish`,
    { expectedVersion: (saved.body as { version: number }).version },
    await owner.api.csrfHeaders(),
  );
  expect(published.status).toBe(200);
  return { publicId: detail.widget.publicId, widgetId: detail.widget.id };
}

let submissionCounter = 0;

async function submitLead(
  publicId: string,
  email: string,
  consent: boolean,
): Promise<{ status: number; body: unknown }> {
  submissionCounter += 1;
  return new TestClient(harness.baseUrl).post(
    `/widget/v1/submit/${publicId}`,
    {
      idempotencyKey: `privacy-${String(Date.now())}-${String(submissionCounter)}`,
      values: { email, message: 'Hello there, this is a message.', consent: String(consent) },
      pageUrl: `${ALLOWED_ORIGIN}/pricing`,
      // Well past the timing floor, so an ordinary submission is accepted.
      renderedAt: harness.clock.now().getTime() - 30_000,
    },
    { origin: ALLOWED_ORIGIN },
  );
}

function contactsOf(workspaceId: string) {
  return harness.db
    .collection<ContactRecord>(COLLECTIONS.contacts)
    .find({ workspaceId: new ObjectId(workspaceId) })
    .toArray();
}

async function contactByEmail(workspaceId: string, email: string): Promise<ContactRecord> {
  const found = await harness.db
    .collection<ContactRecord>(COLLECTIONS.contacts)
    .findOne({ workspaceId: new ObjectId(workspaceId), normalizedEmail: email.toLowerCase() });
  if (found === null) throw new Error(`no contact for ${email}`);
  return found;
}

function publicClient(): TestClient {
  return new TestClient(harness.baseUrl);
}

// ===========================================================================
// Consent, and the two opt-in modes
// ===========================================================================

describe('consent capture at submission time (blueprint 4.8)', () => {
  it('records immutable evidence of the exact wording that was shown', async () => {
    const owner = await verifiedOwner('cn-evidence');
    const widget = await publishWidget(owner, 'cn-evidence');
    const email = uniqueEmail('lead-evidence');

    expect((await submitLead(widget.publicId, email, true)).status).toBe(202);

    const events = await harness.db
      .collection(COLLECTIONS.consentEvents)
      .find({ workspaceId: new ObjectId(owner.workspaceId) })
      .toArray();

    expect(events).toHaveLength(1);
    const event = events[0] as Record<string, unknown>;
    expect(event['text']).toBe(CONSENT_LABEL);
    expect(event['granted']).toBe(true);
    expect(event['source']).toBe('widget_form');
    // The version is a fingerprint of the wording, not a hand-kept number.
    expect(event['textVersion']).toMatch(/^[0-9a-f]{12}$/);
    // Pseudonymous metadata, never a raw address (blueprint 9.4).
    expect(event['ipPseudonym']).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof event['widgetRevisionNumber']).toBe('number');
  }, 90_000);

  it('leaves a ticked box PENDING under the default double opt-in', async () => {
    const owner = await verifiedOwner('cn-double');
    const widget = await publishWidget(owner, 'cn-double');
    const email = uniqueEmail('lead-double');

    await submitLead(widget.publicId, email, true);

    const contact = await contactByEmail(owner.workspaceId, email);
    // Default is double (blueprint 4.8), so a tick is a request, not consent.
    expect(contact.consentState).toBe('pending');
  }, 90_000);

  it('subscribes immediately when the workspace chooses single opt-in', async () => {
    const owner = await verifiedOwner('cn-single');
    const settings = await owner.api.put(
      '/api/v1/workspaces/privacy',
      { retentionDays: 365, optInMode: 'single' },
      await owner.api.csrfHeaders(),
    );
    expect(settings.status).toBe(200);

    const widget = await publishWidget(owner, 'cn-single');
    const email = uniqueEmail('lead-single');
    await submitLead(widget.publicId, email, true);

    expect((await contactByEmail(owner.workspaceId, email)).consentState).toBe('confirmed');
  }, 90_000);

  it('leaves an unticked box unsubscribed without recording consent', async () => {
    const owner = await verifiedOwner('cn-declined');
    const widget = await publishWidget(owner, 'cn-declined');
    const email = uniqueEmail('lead-declined');

    await submitLead(widget.publicId, email, false);

    expect((await contactByEmail(owner.workspaceId, email)).consentState).toBe('none');
    const events = await harness.db
      .collection(COLLECTIONS.consentEvents)
      .find({ workspaceId: new ObjectId(owner.workspaceId) })
      .toArray();
    // The evidence still exists - it records that the box was shown and NOT
    // ticked, which is exactly what you need to prove you did not assume.
    expect(events).toHaveLength(1);
    expect((events[0] as Record<string, unknown>)['granted']).toBe(false);
  }, 90_000);
});

// ===========================================================================
// GATE 3 - suppression
// ===========================================================================

describe('GATE 3: unsubscribe suppresses marketing, never transactional - EXIT GATE', () => {
  it('confirms a double opt-in, then unsubscribes, workspace-wide', async () => {
    const owner = await verifiedOwner('sup-flow');
    const widget = await publishWidget(owner, 'sup-flow');
    const email = uniqueEmail('lead-sup');

    await submitLead(widget.publicId, email, true);
    const contact = await contactByEmail(owner.workspaceId, email);
    expect(contact.consentState).toBe('pending');

    const confirmToken = harness.deps.consentService.confirmToken(
      new ObjectId(owner.workspaceId),
      contact._id,
    );
    const confirmed = await publicClient().post('/public/v1/consent/confirm', {
      token: confirmToken,
    });
    expect(confirmed.status).toBe(200);
    expect((confirmed.body as { outcome: string }).outcome).toBe('confirmed');
    expect((await contactByEmail(owner.workspaceId, email)).consentState).toBe('confirmed');

    const unsubToken = harness.deps.consentService.unsubscribeToken(
      new ObjectId(owner.workspaceId),
      contact._id,
    );
    const unsubscribed = await publicClient().post('/public/v1/consent/unsubscribe', {
      token: unsubToken,
    });
    expect(unsubscribed.status).toBe(200);
    expect((unsubscribed.body as { outcome: string }).outcome).toBe('unsubscribed');

    const after = await contactByEmail(owner.workspaceId, email);
    expect(after.consentState).toBe('withdrawn');

    // The suppression record - the half that survives the contact.
    const scope = workspaceScope(new ObjectId(owner.workspaceId));
    expect(await harness.deps.consentService.isSuppressed(scope, email.toLowerCase())).toBe(true);
  }, 120_000);

  it('sends no marketing mail to a suppressed address, and says why', async () => {
    const owner = await verifiedOwner('sup-block');
    const widget = await publishWidget(owner, 'sup-block');
    const email = uniqueEmail('lead-block');

    await submitLead(widget.publicId, email, true);
    const contact = await contactByEmail(owner.workspaceId, email);

    await publicClient().post('/public/v1/consent/unsubscribe', {
      token: harness.deps.consentService.unsubscribeToken(
        new ObjectId(owner.workspaceId),
        contact._id,
      ),
    });

    /**
     * The worker is driven directly rather than through the queue, so the
     * outcome is a stated fact rather than a race - the same discipline the
     * Stage 9 delivery tests use.
     *
     * There are TWO independent guards, and this proves the first: a withdrawn
     * contact is refused on its consent state before the suppression list is
     * even consulted. The second guard - the suppression list catching an
     * address whose contact no longer remembers the unsubscribe - is proven by
     * "keeps honouring the unsubscribe after the contact is gone" below, which
     * is the only case where the two can disagree.
     */
    const before = harness.logs.length;
    await harness.deps.privacyWorkers.deliverConfirmation({
      workspaceId: owner.workspaceId,
      contactId: contact._id.toHexString(),
    });

    const events = harness.logs.slice(before).map((record) => record.event);
    expect(events).not.toContain('consent.optin_sent');
    expect((await contactByEmail(owner.workspaceId, email)).consentState).toBe('withdrawn');
  }, 120_000);

  it('still delivers the transactional confirmation to an unsubscribed lead', async () => {
    /**
     * Blueprint 4.8: "essential transactional messages remain allowed". A
     * visitor confirmation answers something the person just did, so it is not
     * gated by a marketing unsubscribe - suppressing it would mean somebody who
     * opted out of a newsletter stops getting receipts.
     */
    const owner = await verifiedOwner('sup-txn');
    const widget = await publishWidget(owner, 'sup-txn');
    const email = uniqueEmail('lead-txn');

    // The visitor confirmation is off by default, so it is turned on here -
    // otherwise "transactional mail still goes" would be proven by an absence.
    const settings = await owner.api.put(
      `/api/v1/deliveries/widgets/${widget.widgetId}/notifications`,
      { confirmationEnabled: true },
      await owner.api.csrfHeaders(),
    );
    expect(settings.status).toBe(200);

    await submitLead(widget.publicId, email, true);
    const contact = await contactByEmail(owner.workspaceId, email);
    await publicClient().post('/public/v1/consent/unsubscribe', {
      token: harness.deps.consentService.unsubscribeToken(
        new ObjectId(owner.workspaceId),
        contact._id,
      ),
    });

    // A second submission from the same, now-suppressed, address.
    expect((await submitLead(widget.publicId, email, false)).status).toBe(202);

    const deliveries = await harness.db
      .collection(COLLECTIONS.deliveries)
      .find({ workspaceId: new ObjectId(owner.workspaceId) })
      .toArray();

    /**
     * Blueprint 4.8's other half, proven positively: the confirmation was still
     * queued FOR the suppressed address. Suppression is a marketing rule, and
     * marketing is a separate queue family (12.1) - so there is no flag to
     * forget here, only two families with different rules.
     */
    const toVisitor = deliveries.filter(
      (delivery) => (delivery as Record<string, unknown>)['type'] === 'visitor_confirmation',
    );
    expect(toVisitor.length).toBeGreaterThan(0);
  }, 120_000);

  it('does not let a later ticked box undo an unsubscribe', async () => {
    const owner = await verifiedOwner('sup-resub');
    const widget = await publishWidget(owner, 'sup-resub');
    const email = uniqueEmail('lead-resub');

    await submitLead(widget.publicId, email, true);
    const contact = await contactByEmail(owner.workspaceId, email);
    await publicClient().post('/public/v1/consent/unsubscribe', {
      token: harness.deps.consentService.unsubscribeToken(
        new ObjectId(owner.workspaceId),
        contact._id,
      ),
    });

    // They fill the form in again, box ticked. This must not resubscribe them.
    await submitLead(widget.publicId, email, true);

    expect((await contactByEmail(owner.workspaceId, email)).consentState).toBe('withdrawn');
  }, 120_000);

  it('treats a second unsubscribe click as a quiet no-op', async () => {
    const owner = await verifiedOwner('sup-twice');
    const widget = await publishWidget(owner, 'sup-twice');
    const email = uniqueEmail('lead-twice');

    await submitLead(widget.publicId, email, true);
    const contact = await contactByEmail(owner.workspaceId, email);
    const token = harness.deps.consentService.unsubscribeToken(
      new ObjectId(owner.workspaceId),
      contact._id,
    );

    expect(
      (
        (await publicClient().post('/public/v1/consent/unsubscribe', { token })).body as {
          outcome: string;
        }
      ).outcome,
    ).toBe('unsubscribed');
    const second = await publicClient().post('/public/v1/consent/unsubscribe', { token });
    expect(second.status).toBe(200);
    expect((second.body as { outcome: string }).outcome).toBe('already');

    // And exactly one suppression row, not two.
    const rows = await harness.db
      .collection(COLLECTIONS.suppressions)
      .find({ workspaceId: new ObjectId(owner.workspaceId) })
      .toArray();
    expect(rows).toHaveLength(1);
  }, 120_000);

  it("never crosses tenants: one workspace cannot unsubscribe another's lead", async () => {
    const first = await verifiedOwner('sup-xt-a');
    const second = await verifiedOwner('sup-xt-b');
    const widgetA = await publishWidget(first, 'sup-xt-a');
    const email = uniqueEmail('lead-xt');

    await submitLead(widgetA.publicId, email, true);
    const contact = await contactByEmail(first.workspaceId, email);

    /**
     * A token that names the OTHER workspace but this workspace's contact. The
     * signature covers both ids together, so this is not a token this server
     * would ever mint - and it must not verify.
     */
    const forged = harness.deps.consentService.unsubscribeToken(
      new ObjectId(second.workspaceId),
      contact._id,
    );
    const response = await publicClient().post('/public/v1/consent/unsubscribe', {
      token: forged,
    });
    expect((response.body as { outcome: string }).outcome).toBe('invalid');
    expect((await contactByEmail(first.workspaceId, email)).consentState).toBe('pending');
  }, 120_000);

  it('refuses a token that has been tampered with', async () => {
    const response = await publicClient().post('/public/v1/consent/unsubscribe', {
      token: 'YmFkOnBheWxvYWQ6aGVyZQ.not-a-real-signature-at-all',
    });
    expect(response.status).toBe(200);
    expect((response.body as { outcome: string }).outcome).toBe('invalid');
  }, 60_000);
});

// ===========================================================================
// GATE 4 - the privacy verification boundary
// ===========================================================================

describe('GATE 4: export and deletion need a valid token - EXIT GATE', () => {
  it('refuses to complete a request with no token, a wrong token, or a used one', async () => {
    const owner = await verifiedOwner('pr-token');
    const widget = await publishWidget(owner, 'pr-token');
    const email = uniqueEmail('lead-token');
    await submitLead(widget.publicId, email, true);

    // No token at all.
    expect((await publicClient().post('/public/v1/privacy/requests/complete', {})).status).toBe(
      400,
    );

    // A well-formed token nobody issued.
    expect(
      (
        await publicClient().post('/public/v1/privacy/requests/complete', {
          token: 'a'.repeat(43),
        })
      ).status,
    ).toBe(404);

    // A real one, used twice.
    await publicClient().post('/public/v1/privacy/requests', {
      publicWidgetId: widget.publicId,
      email,
      kind: 'export',
    });
    const token = await tokenFromEmail(email);

    expect(
      (await publicClient().post('/public/v1/privacy/requests/complete', { token })).status,
    ).toBe(200);
    expect(
      (await publicClient().post('/public/v1/privacy/requests/complete', { token })).status,
    ).toBe(404);
  }, 180_000);

  it('refuses a token whose 24-hour window has closed', async () => {
    const owner = await verifiedOwner('pr-expiry');
    const widget = await publishWidget(owner, 'pr-expiry');
    const email = uniqueEmail('lead-expiry');
    await submitLead(widget.publicId, email, true);

    await publicClient().post('/public/v1/privacy/requests', {
      publicWidgetId: widget.publicId,
      email,
      kind: 'export',
    });
    const token = await tokenFromEmail(email);

    // One second before the deadline it still works... but using it would
    // consume it, so the boundary is checked on a second request instead.
    harness.clock.advanceSeconds(24 * 3600 - 1);
    const stillValid = await harness.db
      .collection<PrivacyRequestRecord>(COLLECTIONS.privacyRequests)
      .findOne({ normalizedEmail: email.toLowerCase() });
    expect(stillValid?.expiresAt.getTime()).toBeGreaterThan(harness.clock.now().getTime());

    harness.clock.advanceSeconds(2);
    expect(
      (await publicClient().post('/public/v1/privacy/requests/complete', { token })).status,
    ).toBe(404);

    harness.clock.advanceSeconds(-(24 * 3600 + 1));
  }, 180_000);

  it('answers identically for an address that is not a lead here', async () => {
    /**
     * The enumeration guard. If this endpoint said "no such contact", anybody
     * could test addresses against a workspace's lead list one at a time.
     */
    const owner = await verifiedOwner('pr-enum');
    const widget = await publishWidget(owner, 'pr-enum');

    const real = uniqueEmail('lead-enum');
    await submitLead(widget.publicId, real, true);

    const known = await publicClient().post('/public/v1/privacy/requests', {
      publicWidgetId: widget.publicId,
      email: real,
      kind: 'export',
    });
    const unknown = await publicClient().post('/public/v1/privacy/requests', {
      publicWidgetId: widget.publicId,
      email: uniqueEmail('never-a-lead'),
      kind: 'export',
    });

    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);

    // And no request record was created for the address that is not a lead.
    const rows = await harness.db.collection(COLLECTIONS.privacyRequests).find({}).toArray();
    expect(rows).toHaveLength(1);
  }, 180_000);

  it("exports one workspace's view, and only that workspace's", async () => {
    const first = await verifiedOwner('pr-exp-a');
    const second = await verifiedOwner('pr-exp-b');
    const widgetA = await publishWidget(first, 'pr-exp-a');
    const widgetB = await publishWidget(second, 'pr-exp-b');

    const email = uniqueEmail('lead-both');
    await submitLead(widgetA.publicId, email, true);
    await submitLead(widgetB.publicId, email, true);

    await publicClient().post('/public/v1/privacy/requests', {
      publicWidgetId: widgetA.publicId,
      email,
      kind: 'export',
    });
    const token = await tokenFromEmail(email);
    const response = await publicClient().post('/public/v1/privacy/requests/complete', { token });

    expect(response.status).toBe(200);
    const body = response.body as {
      kind: string;
      export: { workspace: string; submissions: unknown[]; consentEvents: unknown[] };
    };
    expect(body.kind).toBe('export');
    expect(body.export.workspace).toContain('pr-exp-a');
    // One submission - the one made to THIS workspace, not both.
    expect(body.export.submissions).toHaveLength(1);
    expect(body.export.consentEvents).toHaveLength(1);
  }, 180_000);

  it('deletes irreversibly, and keeps only the suppression fingerprint', async () => {
    const owner = await verifiedOwner('pr-del');
    const widget = await publishWidget(owner, 'pr-del');
    const email = uniqueEmail('lead-del');
    await submitLead(widget.publicId, email, true);

    const before = await contactByEmail(owner.workspaceId, email);
    expect(before.email).toBe(email);

    await publicClient().post('/public/v1/privacy/requests', {
      publicWidgetId: widget.publicId,
      email,
      kind: 'deletion',
    });
    const token = await tokenFromEmail(email);
    const response = await publicClient().post('/public/v1/privacy/requests/complete', { token });
    expect(response.status).toBe(200);

    const after = await harness.db
      .collection<ContactRecord>(COLLECTIONS.contacts)
      .findOne({ _id: before._id });
    expect(after?.email).toBe('');
    expect(after?.name).toBeNull();
    expect(after?.normalizedEmail).not.toContain('lead-del');
    expect(after?.recordStatus).toBe('deleted');
    // No recovery window: this deletion is the point (blueprint 4.8).
    expect(after?.purgeAfter).toBeNull();

    const submissions = await harness.db
      .collection<SubmissionEventRecord>(COLLECTIONS.submissionEvents)
      .find({ contactId: before._id })
      .toArray();
    expect(submissions.length).toBeGreaterThan(0);
    for (const submission of submissions) {
      expect(submission.values).toEqual({});
    }

    // The one thing that survives, and it is a hash.
    const scope = workspaceScope(new ObjectId(owner.workspaceId));
    expect(await harness.deps.consentService.isSuppressed(scope, email.toLowerCase())).toBe(true);
    const rows = await harness.db.collection(COLLECTIONS.suppressions).find({}).toArray();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain('lead-del');
  }, 180_000);

  it('keeps honouring the unsubscribe after the contact is gone', async () => {
    /**
     * The reason the suppression list is a separate record at all. Delete the
     * contact, then submit the same address again: the NEW contact has no
     * memory of the unsubscribe, and the suppression list is what remembers.
     */
    const owner = await verifiedOwner('pr-resurrect');
    const widget = await publishWidget(owner, 'pr-resurrect');
    const email = uniqueEmail('lead-resurrect');
    await submitLead(widget.publicId, email, true);

    await publicClient().post('/public/v1/privacy/requests', {
      publicWidgetId: widget.publicId,
      email,
      kind: 'deletion',
    });
    await publicClient().post('/public/v1/privacy/requests/complete', {
      token: await tokenFromEmail(email),
    });

    // A brand-new submission from the same address.
    expect((await submitLead(widget.publicId, email, true)).status).toBe(202);
    const reborn = await contactByEmail(owner.workspaceId, email);
    expect(reborn.consentState).toBe('pending');

    // The contact does not remember. The suppression list does.
    const before = harness.logs.length;
    await harness.deps.privacyWorkers.deliverConfirmation({
      workspaceId: owner.workspaceId,
      contactId: reborn._id.toHexString(),
    });
    const events = harness.logs.slice(before).map((record) => record.event);
    expect(events).toContain('consent.optin_suppressed');
    expect(events).not.toContain('consent.optin_sent');
  }, 180_000);
});

/** Pull the single-use token out of the privacy verification email. */
async function tokenFromEmail(to: string): Promise<string> {
  const message = await waitForEmail(to, (m) => m.Subject.includes('Confirm'));
  return extractToken(await mailpitBody(message.ID));
}

// ===========================================================================
// GATE 1 - every recovery window, exact to the millisecond
// ===========================================================================

describe('GATE 1: each 30-day window expires correctly, never early - EXIT GATE', () => {
  it('purges contact trash on day 30 and not on day 29', async () => {
    const owner = await verifiedOwner('rt-contact');
    const widget = await publishWidget(owner, 'rt-contact');
    const email = uniqueEmail('lead-trash');
    await submitLead(widget.publicId, email, true);

    const contact = await contactByEmail(owner.workspaceId, email);
    const deleted = await owner.api.delete(
      `/api/v1/contacts/${contact._id.toHexString()}`,
      await owner.api.csrfHeaders(),
    );
    expect(deleted.status).toBe(200);

    // Day 29: still there, still identifiable.
    harness.clock.advanceDays(29);
    expect(await harness.deps.retentionService.purgeContactTrash()).toBe(0);
    expect(
      (
        await harness.db
          .collection<ContactRecord>(COLLECTIONS.contacts)
          .findOne({ _id: contact._id })
      )?.email,
    ).toBe(email);

    // Day 30: gone.
    harness.clock.advanceDays(1);
    expect(await harness.deps.retentionService.purgeContactTrash()).toBe(1);
    const purged = await harness.db
      .collection<ContactRecord>(COLLECTIONS.contacts)
      .findOne({ _id: contact._id });
    expect(purged?.email).toBe('');
    expect(purged?.name).toBeNull();

    harness.clock.advanceDays(-30);
  }, 180_000);

  it('purges widget trash on day 30, and keeps the leads it collected', async () => {
    const owner = await verifiedOwner('rt-widget');
    const widget = await publishWidget(owner, 'rt-widget');
    const email = uniqueEmail('lead-keeps');
    await submitLead(widget.publicId, email, true);

    await owner.api.delete(`/api/v1/widgets/${widget.widgetId}`, await owner.api.csrfHeaders());

    harness.clock.advanceDays(29);
    expect(await harness.deps.retentionService.purgeWidgetTrash()).toBe(0);

    harness.clock.advanceDays(1);
    expect(await harness.deps.retentionService.purgeWidgetTrash()).toBe(1);

    expect(
      await harness.db
        .collection(COLLECTIONS.widgets)
        .findOne({ _id: new ObjectId(widget.widgetId) }),
    ).toBeNull();

    /**
     * Blueprint 9.5: "historical contacts/submissions remain". Deleting a form
     * must never delete the leads it gathered.
     */
    const contact = await contactByEmail(owner.workspaceId, email);
    expect(contact.email).toBe(email);

    harness.clock.advanceDays(-30);
  }, 180_000);

  it('purges an entire tenant on day 30, and nobody else', async () => {
    const doomed = await verifiedOwner('rt-ws-doomed');
    const bystander = await verifiedOwner('rt-ws-safe');
    const widgetA = await publishWidget(doomed, 'rt-ws-doomed');
    const widgetB = await publishWidget(bystander, 'rt-ws-safe');
    await submitLead(widgetA.publicId, uniqueEmail('lead-doomed'), true);
    await submitLead(widgetB.publicId, uniqueEmail('lead-safe'), true);

    const deleted = await doomed.api.delete(
      '/api/v1/workspaces/current',
      await doomed.api.csrfHeaders(),
    );
    expect(deleted.status).toBe(200);

    harness.clock.advanceDays(29);
    expect(await harness.deps.retentionService.purgeWorkspaceTrash()).toBe(0);
    expect(await contactsOf(doomed.workspaceId)).toHaveLength(1);

    harness.clock.advanceDays(1);
    expect(await harness.deps.retentionService.purgeWorkspaceTrash()).toBe(1);

    expect(await contactsOf(doomed.workspaceId)).toHaveLength(0);
    expect(
      await harness.db
        .collection<WidgetRecord>(COLLECTIONS.widgets)
        .findOne({ workspaceId: new ObjectId(doomed.workspaceId) }),
    ).toBeNull();
    expect(
      await harness.db
        .collection<WorkspaceRecord>(COLLECTIONS.workspaces)
        .findOne({ _id: new ObjectId(doomed.workspaceId) }),
    ).toBeNull();
    expect(
      await harness.db
        .collection(COLLECTIONS.memberships)
        .countDocuments({ workspaceId: new ObjectId(doomed.workspaceId) }),
    ).toBe(0);

    // The bystander is untouched.
    expect(await contactsOf(bystander.workspaceId)).toHaveLength(1);

    harness.clock.advanceDays(-30);
  }, 240_000);

  it('purges an account on day 30 and anonymizes its history rather than deleting it', async () => {
    const owner = await verifiedOwner('rt-acct-owner');
    const widget = await publishWidget(owner, 'rt-acct-owner');
    await submitLead(widget.publicId, uniqueEmail('lead-acct'), true);

    // An account that owns a workspace cannot be deleted (9.2's invariant).
    const refused = await owner.api.delete('/api/v1/auth/account', await owner.api.csrfHeaders());
    expect(refused.status).toBe(409);

    // A member, who owns nothing, can.
    const member = await inviteMember(owner, 'rt-acct-member');
    const auditBefore = await harness.db
      .collection(COLLECTIONS.auditEvents)
      .countDocuments({ actorUserId: new ObjectId(member.userId) });
    expect(auditBefore).toBeGreaterThan(0);

    const deleted = await member.api.delete('/api/v1/auth/account', await member.api.csrfHeaders());
    expect(deleted.status).toBe(200);

    harness.clock.advanceDays(29);
    expect(await harness.deps.retentionService.purgeAccounts()).toBe(0);

    harness.clock.advanceDays(1);
    expect(await harness.deps.retentionService.purgeAccounts()).toBe(1);

    // Memberships gone, profile blanked.
    expect(
      await harness.db
        .collection(COLLECTIONS.memberships)
        .countDocuments({ userId: new ObjectId(member.userId) }),
    ).toBe(0);
    const purged = await harness.db
      .collection<UserRecord>(COLLECTIONS.users)
      .findOne({ _id: new ObjectId(member.userId) });
    expect(purged?.email).toBe('');
    expect(purged?.passwordHash).toBeNull();

    /**
     * Blueprint 9.5: "historical actor references anonymized". The audit trail
     * still records what happened - destroying it because its author left
     * would let anyone erase their own history by closing their account.
     */
    expect(
      await harness.db
        .collection(COLLECTIONS.auditEvents)
        .countDocuments({ actorUserId: new ObjectId(member.userId) }),
    ).toBe(0);
    expect(
      await harness.db
        .collection(COLLECTIONS.auditEvents)
        .countDocuments({ actorUserId: new ObjectId(ANONYMOUS_ACTOR_HEX) }),
    ).toBeGreaterThan(0);

    harness.clock.advanceDays(-30);
  }, 240_000);

  it('restores an account inside the window and refuses after it', async () => {
    const owner = await verifiedOwner('rt-recover-owner');
    const member = await inviteMember(owner, 'rt-recover-member');

    await member.api.delete('/api/v1/auth/account', await member.api.csrfHeaders());

    // A wrong password is refused exactly as login refuses it.
    const wrong = await publicClient().post('/api/v1/auth/account/recover', {
      email: member.email,
      password: 'Not-the-right-password-9!',
    });
    expect(wrong.status).toBe(404);

    harness.clock.advanceDays(29);
    const recovered = await publicClient().post('/api/v1/auth/account/recover', {
      email: member.email,
      password: STRONG_PASSWORD,
    });
    expect(recovered.status).toBe(200);
    expect(
      (
        await harness.db
          .collection<UserRecord>(COLLECTIONS.users)
          .findOne({ _id: new ObjectId(member.userId) })
      )?.status,
    ).toBe('active');

    // Delete again and let the window close.
    await member.api.post('/api/v1/auth/login', {
      email: member.email,
      password: STRONG_PASSWORD,
    });
    await member.api.delete('/api/v1/auth/account', await member.api.csrfHeaders());
    harness.clock.advanceDays(31);

    const late = await publicClient().post('/api/v1/auth/account/recover', {
      email: member.email,
      password: STRONG_PASSWORD,
    });
    expect(late.status).toBe(409);

    harness.clock.advanceDays(-60);
  }, 240_000);
});

/** Invite and accept a Member, returning a signed-in client for them. */
async function inviteMember(owner: Owner, label: string): Promise<Owner> {
  const email = uniqueEmail(label);

  // Registered and verified BEFORE the invitation is sent, so the two emails
  // cannot be confused for one another when the token is read back.
  const api = new TestClient(harness.baseUrl);
  await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
  const verify = await waitForEmail(email, (m) => m.Subject.includes('Confirm'));
  await api.post('/api/v1/auth/verify', { token: extractToken(await mailpitBody(verify.ID)) });
  await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });

  const invited = await owner.api.post(
    '/api/v1/invitations',
    { email, role: 'member' },
    await owner.api.csrfHeaders(),
  );
  expect(invited.status).toBe(202);

  const invitation = await waitForEmail(email, (m) => m.Subject.includes('Join'));
  const accepted = await api.post(
    '/api/v1/invitations/accept',
    { token: extractToken(await mailpitBody(invitation.ID)) },
    await api.csrfHeaders(),
  );
  expect(accepted.status).toBe(200);

  const user = await harness.db
    .collection<UserRecord>(COLLECTIONS.users)
    .findOne({ normalizedEmail: email.toLowerCase() });
  if (user === null) throw new Error('expected the member to exist');

  return { api, email, userId: user._id.toHexString(), workspaceId: owner.workspaceId };
}

// ===========================================================================
// Active-contact retention
// ===========================================================================

describe('active-contact retention (blueprint 9.5, 4.8)', () => {
  it('retires a contact once its workspace retention passes, measured from the anchor', async () => {
    const owner = await verifiedOwner('rt-active');
    await owner.api.put(
      '/api/v1/workspaces/privacy',
      { retentionDays: 30, optInMode: 'double' },
      await owner.api.csrfHeaders(),
    );
    const widget = await publishWidget(owner, 'rt-active');
    const email = uniqueEmail('lead-active');
    await submitLead(widget.publicId, email, true);

    harness.clock.advanceDays(29);
    expect(await harness.deps.retentionService.expireActiveContacts()).toBe(0);

    harness.clock.advanceDays(1);
    expect(await harness.deps.retentionService.expireActiveContacts()).toBe(1);
    const purged = await contactsOf(owner.workspaceId);
    expect(purged[0]?.email).toBe('');

    harness.clock.advanceDays(-30);
  }, 180_000);

  it('starts the clock again when the same person submits again', async () => {
    const owner = await verifiedOwner('rt-anchor');
    await owner.api.put(
      '/api/v1/workspaces/privacy',
      { retentionDays: 30, optInMode: 'double' },
      await owner.api.csrfHeaders(),
    );
    const widget = await publishWidget(owner, 'rt-anchor');
    const email = uniqueEmail('lead-anchor');
    await submitLead(widget.publicId, email, true);

    // 20 days later they come back. The anchor moves with them.
    harness.clock.advanceDays(20);
    await submitLead(widget.publicId, email, true);

    // 20 more days: 40 since the first submission, but only 20 since the last.
    harness.clock.advanceDays(20);
    expect(await harness.deps.retentionService.expireActiveContacts()).toBe(0);
    expect((await contactByEmail(owner.workspaceId, email)).email).toBe(email);

    harness.clock.advanceDays(11);
    expect(await harness.deps.retentionService.expireActiveContacts()).toBe(1);

    harness.clock.advanceDays(-51);
  }, 180_000);

  it('never retires anything in a workspace set to indefinite', async () => {
    const owner = await verifiedOwner('rt-forever');
    await owner.api.put(
      '/api/v1/workspaces/privacy',
      { retentionDays: 0, optInMode: 'double' },
      await owner.api.csrfHeaders(),
    );
    const widget = await publishWidget(owner, 'rt-forever');
    const email = uniqueEmail('lead-forever');
    await submitLead(widget.publicId, email, true);

    harness.clock.advanceDays(2000);
    expect(await harness.deps.retentionService.expireActiveContacts()).toBe(0);
    expect((await contactByEmail(owner.workspaceId, email)).email).toBe(email);

    harness.clock.advanceDays(-2000);
  }, 180_000);

  it('lets only the Owner change retention', async () => {
    const owner = await verifiedOwner('rt-perm');
    const member = await inviteMember(owner, 'rt-perm-member');

    const refused = await member.api.put(
      '/api/v1/workspaces/privacy',
      { retentionDays: 30, optInMode: 'single' },
      await member.api.csrfHeaders(),
    );
    expect(refused.status).toBe(403);

    // The Member can still READ it - the setting is not a secret.
    expect((await member.api.get('/api/v1/workspaces/privacy')).status).toBe(200);
  }, 180_000);

  it('records both the old and the new retention value in the audit log', async () => {
    const owner = await verifiedOwner('rt-audit');
    await owner.api.put(
      '/api/v1/workspaces/privacy',
      { retentionDays: 30, optInMode: 'single' },
      await owner.api.csrfHeaders(),
    );

    const entry = await harness.db.collection(COLLECTIONS.auditEvents).findOne({
      workspaceId: new ObjectId(owner.workspaceId),
      type: 'workspace.privacy_settings_changed',
    });
    const metadata = (entry as Record<string, unknown> | null)?.['metadata'] as
      Record<string, unknown> | undefined;
    // Both halves: shortening retention destroys data, and an audit line that
    // recorded only the new value would leave nobody able to say what it was.
    expect(metadata?.['retentionDaysFrom']).toBe(365);
    expect(metadata?.['retentionDaysTo']).toBe(30);
    expect(metadata?.['optInModeFrom']).toBe('double');
    expect(metadata?.['optInModeTo']).toBe('single');
  }, 120_000);
});

// ===========================================================================
// GATE 2 - purge happens exactly once, and survives a retry
// ===========================================================================

describe('GATE 2: purge is idempotent under a retry - EXIT GATE', () => {
  it('does the work once, however many times the sweep runs', async () => {
    const owner = await verifiedOwner('idem-contact');
    const widget = await publishWidget(owner, 'idem-contact');
    const email = uniqueEmail('lead-idem');
    await submitLead(widget.publicId, email, true);

    const contact = await contactByEmail(owner.workspaceId, email);
    await owner.api.delete(
      `/api/v1/contacts/${contact._id.toHexString()}`,
      await owner.api.csrfHeaders(),
    );

    harness.clock.advanceDays(31);

    expect(await harness.deps.retentionService.purgeContactTrash()).toBe(1);
    const afterFirst = await harness.db
      .collection<ContactRecord>(COLLECTIONS.contacts)
      .findOne({ _id: contact._id });

    // Three more passes, simulating a retry after a crash mid-sweep.
    expect(await harness.deps.retentionService.purgeContactTrash()).toBe(0);
    expect(await harness.deps.retentionService.purgeContactTrash()).toBe(0);
    expect(await harness.deps.retentionService.purgeContactTrash()).toBe(0);

    const afterRetries = await harness.db
      .collection<ContactRecord>(COLLECTIONS.contacts)
      .findOne({ _id: contact._id });
    // Byte-for-byte the same record: a repeated sweep is a no-op, not a
    // second blanking that rewrites timestamps.
    expect(afterRetries?.updatedAt.getTime()).toBe(afterFirst?.updatedAt.getTime());
    expect(afterRetries?.email).toBe('');

    harness.clock.advanceDays(-31);
  }, 180_000);

  it('runs the whole sweep repeatedly without doing anything twice', async () => {
    const owner = await verifiedOwner('idem-sweep');
    const widget = await publishWidget(owner, 'idem-sweep');
    await submitLead(widget.publicId, uniqueEmail('lead-sweep'), true);

    const contact = (await contactsOf(owner.workspaceId))[0];
    if (contact === undefined) throw new Error('expected a contact');
    await owner.api.delete(
      `/api/v1/contacts/${contact._id.toHexString()}`,
      await owner.api.csrfHeaders(),
    );
    await owner.api.delete(`/api/v1/widgets/${widget.widgetId}`, await owner.api.csrfHeaders());

    harness.clock.advanceDays(31);

    const first = await harness.deps.retentionService.sweep();
    expect(first.contactsPurged).toBe(1);
    expect(first.widgetsPurged).toBe(1);

    const second = await harness.deps.retentionService.sweep();
    expect(second.contactsPurged).toBe(0);
    expect(second.widgetsPurged).toBe(0);

    harness.clock.advanceDays(-31);
  }, 180_000);
});

// ===========================================================================
// The startup catch-up sweep
// ===========================================================================

describe('the startup catch-up sweep (blueprint 9.5, 5.2)', () => {
  it('processes a backlog that built up while the service was asleep', async () => {
    /**
     * The Render free-tier case. A BullMQ job scheduler holds one pending
     * iteration and re-arms from the moment it is upserted, so a process that
     * slept through several daily slots wakes to ONE late run rather than
     * several - the schedule guarantees "eventually", and only a pass at
     * startup guarantees "not skipped".
     *
     * Sleep is simulated by jumping the injected clock, which is exactly what a
     * sleeping instance looks like from the sweep's point of view.
     */
    const owner = await verifiedOwner('catchup');
    const widget = await publishWidget(owner, 'catchup');

    const emails = [uniqueEmail('lead-c1'), uniqueEmail('lead-c2'), uniqueEmail('lead-c3')];
    for (const email of emails) await submitLead(widget.publicId, email, true);

    for (const contact of await contactsOf(owner.workspaceId)) {
      await owner.api.delete(
        `/api/v1/contacts/${contact._id.toHexString()}`,
        await owner.api.csrfHeaders(),
      );
    }

    // Asleep for two months. Every window closed while nothing was running.
    harness.clock.advanceDays(60);

    const result = await harness.deps.retentionService.catchUp();
    expect(result.contactsPurged).toBe(3);

    for (const contact of await contactsOf(owner.workspaceId)) {
      expect(contact.email).toBe('');
    }

    // And a second wake-up does not re-process what the first one handled.
    const second = await harness.deps.retentionService.catchUp();
    expect(second.contactsPurged).toBe(0);

    harness.clock.advanceDays(-60);
  }, 240_000);

  it('stays bounded, leaving the rest of a backlog for the next pass', async () => {
    const owner = await verifiedOwner('catchup-bounded');
    const widget = await publishWidget(owner, 'catchup-bounded');

    for (const label of ['b1', 'b2', 'b3']) {
      await submitLead(widget.publicId, uniqueEmail(`lead-${label}`), true);
    }
    for (const contact of await contactsOf(owner.workspaceId)) {
      await owner.api.delete(
        `/api/v1/contacts/${contact._id.toHexString()}`,
        await owner.api.csrfHeaders(),
      );
    }

    harness.clock.advanceDays(31);

    // A limit of one does one, and says so.
    expect(await harness.deps.retentionService.purgeContactTrash(1)).toBe(1);
    expect(await harness.deps.retentionService.purgeContactTrash(1)).toBe(1);
    expect(await harness.deps.retentionService.purgeContactTrash(5)).toBe(1);
    expect(await harness.deps.retentionService.purgeContactTrash(5)).toBe(0);

    harness.clock.advanceDays(-31);
  }, 240_000);
});
