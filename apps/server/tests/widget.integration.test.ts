import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { COLLECTIONS } from '@lcp/database';
import type { WidgetConfig, WidgetDetail, WidgetSummary, WorkspaceUsage } from '@lcp/contracts';
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
 * Widget domain model, drafts, and publishing - against real MongoDB, Redis,
 * and Mailpit (blueprint 18.2).
 *
 * The Stage 5 exit gate is three claims, and each has a named test below:
 *
 *   1. a Member edits a draft without changing live state;
 *   2. a verified Admin publishes;
 *   3. another tenant cannot read, modify, or publish it.
 *
 * The third is not one test but a sweep over every endpoint this stage adds,
 * because blueprint 9.1 requires cross-tenant coverage per path rather than a
 * single representative case.
 */

let harness: AuthHarness;

beforeAll(async () => {
  harness = await createAuthHarness();
}, 120_000);

beforeEach(async () => {
  await harness.clearRateLimits();
});

afterAll(async () => {
  await harness?.teardown();
});

function client(): TestClient {
  return new TestClient(harness.baseUrl);
}

interface Actor {
  readonly api: TestClient;
  readonly email: string;
  readonly userId: string;
}

async function verifiedUser(label: string): Promise<Actor> {
  const email = uniqueEmail(label);
  const api = client();

  await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
  const message = await waitForEmail(email, (m) => m.Subject.includes('Confirm'));
  const token = extractToken(await mailpitBody(message.ID));
  expect((await api.post('/api/v1/auth/verify', { token })).status).toBe(200);

  const login = await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
  expect(login.status).toBe(200);

  const me = await api.get('/api/v1/auth/me');
  const userId = (me.body as { user: { id: string } }).user.id;
  return { api, email, userId };
}

async function unverifiedUser(label: string): Promise<Actor> {
  const email = uniqueEmail(label);
  const api = client();
  await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
  const login = await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
  expect(login.status).toBe(200);
  const me = await api.get('/api/v1/auth/me');
  const userId = (me.body as { user: { id: string } }).user.id;
  return { api, email, userId };
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
  const token = extractToken(await mailpitBody(message.ID));
  const accepted = await invitee.api.post(
    '/api/v1/invitations/accept',
    { token },
    await invitee.api.csrfHeaders(),
  );
  expect(accepted.status).toBe(200);
}

// --- widget helpers --------------------------------------------------------

async function createWidget(
  actor: Actor,
  type = 'contact_form',
  name = 'Contact us',
): Promise<WidgetDetail> {
  const response = await actor.api.post(
    '/api/v1/widgets',
    { type, name },
    await actor.api.csrfHeaders(),
  );
  expect(response.status).toBe(201);
  return response.body as WidgetDetail;
}

async function getDetail(actor: Actor, widgetId: string): Promise<WidgetDetail> {
  const response = await actor.api.get(`/api/v1/widgets/${widgetId}`);
  expect(response.status).toBe(200);
  return response.body as WidgetDetail;
}

/** A draft config that is complete enough to publish. */
function publishableConfig(base: WidgetConfig): WidgetConfig {
  return {
    ...base,
    targeting: { ...base.targeting, allowedDomains: ['example.com', '*.example.com'] },
  };
}

async function saveDraft(
  actor: Actor,
  widgetId: string,
  config: WidgetConfig,
  expectedVersion: number,
): Promise<{ status: number; body: unknown }> {
  return actor.api.put(
    `/api/v1/widgets/${widgetId}/draft`,
    { config, expectedVersion },
    await actor.api.csrfHeaders(),
  );
}

/** An owner with a workspace and one widget whose draft is publishable. */
async function ownerWithPublishableWidget(label: string): Promise<{
  readonly owner: Actor;
  readonly widgetId: string;
  readonly version: number;
}> {
  const owner = await verifiedUser(label);
  await onboard(owner, `${label} workspace`);
  const created = await createWidget(owner);

  const draft = created.draft;
  if (draft === null) throw new Error('a new widget must have a draft');

  const saved = await saveDraft(
    owner,
    created.widget.id,
    publishableConfig(draft.config),
    draft.version,
  );
  expect(saved.status).toBe(200);

  return {
    owner,
    widgetId: created.widget.id,
    version: (saved.body as { version: number }).version,
  };
}

// ---------------------------------------------------------------------------

describe('widget creation (blueprint 4.3, 4.10)', () => {
  it('creates a widget with its first draft, a public id, and an embed snippet', async () => {
    const owner = await verifiedUser('w-create');
    await onboard(owner, 'Creation Co');

    const detail = await createWidget(owner, 'contact_form', 'Front page form');

    expect(detail.widget.name).toBe('Front page form');
    expect(detail.widget.type).toBe('contact_form');
    expect(detail.widget.state).toBe('draft');
    expect(detail.widget.publishedRevisionNumber).toBeNull();

    // Blueprint 10.1: public widget APIs use opaque identifiers, so the public
    // id must not be the Mongo _id.
    expect(detail.widget.publicId).toMatch(/^w_[a-z2-9]{16}$/);
    expect(detail.widget.publicId).not.toBe(detail.widget.id);

    // Blueprint 7.2: one line, carrying the public identifier.
    expect(detail.snippet).toContain('<script async');
    expect(detail.snippet).toContain(`data-widget="${detail.widget.publicId}"`);
    expect(detail.snippet).not.toContain(detail.widget.id);

    expect(detail.draft?.revisionNumber).toBe(1);
    expect(detail.draft?.status).toBe('draft');
    expect(detail.published).toBeNull();
  });

  it('starts each type with its locked mandatory fields', async () => {
    const owner = await verifiedUser('w-types');
    await onboard(owner, 'Types Co');

    const contact = await createWidget(owner, 'contact_form', 'Contact');
    const signup = await createWidget(owner, 'email_signup', 'Signup');

    const contactFields = (contact.draft?.config.fields ?? []).map((f) => f.type);
    expect(contactFields).toEqual(expect.arrayContaining(['email', 'message']));

    const signupFields = (signup.draft?.config.fields ?? []).map((f) => f.type);
    expect(signupFields).toContain('email');
  });

  it('enforces the 10-active-widget cap and reports usage honestly', async () => {
    const owner = await verifiedUser('w-quota');
    await onboard(owner, 'Quota Co');

    for (let index = 0; index < 10; index += 1) {
      await createWidget(owner, 'email_signup', `Widget ${String(index)}`);
    }

    const eleventh = await owner.api.post(
      '/api/v1/widgets',
      { type: 'email_signup', name: 'One too many' },
      await owner.api.csrfHeaders(),
    );
    expect(eleventh.status).toBe(429);
    expect((eleventh.body as { error: { code: string } }).error.code).toBe('quota_exceeded');

    // The meter that was hard-coded null through Stage 4b now reports a real
    // count (blueprint 4.10).
    const usage = await owner.api.get('/api/v1/workspaces/usage');
    const meters = usage.body as WorkspaceUsage;
    expect(meters.activeWidgets.used).toBe(10);
    expect(meters.activeWidgets.limit).toBe(10);

    // Deleting one frees a slot, because trash is not "active".
    const list = await owner.api.get('/api/v1/widgets');
    const first = (list.body as { widgets: WidgetSummary[] }).widgets[0];
    expect(first).toBeDefined();
    const deleted = await owner.api.delete(
      `/api/v1/widgets/${first?.id ?? ''}`,
      await owner.api.csrfHeaders(),
    );
    expect(deleted.status).toBe(200);

    const after = await owner.api.get('/api/v1/workspaces/usage');
    expect((after.body as WorkspaceUsage).activeWidgets.used).toBe(9);
  });

  it('refuses a widget type that is not one of the three', async () => {
    const owner = await verifiedUser('w-badtype');
    await onboard(owner, 'Bad Type Co');

    const response = await owner.api.post(
      '/api/v1/widgets',
      { type: 'carousel', name: 'Nope' },
      await owner.api.csrfHeaders(),
    );
    expect(response.status).toBe(400);
  });
});

describe('draft editing (blueprint 4.5) - EXIT GATE part 1', () => {
  it('a Member edits a draft without changing live state', async () => {
    const owner = await verifiedUser('w-owner-draft');
    await onboard(owner, 'Draft Co');
    const member = await verifiedUser('w-member-draft');
    await inviteAndAccept(owner, member, 'member');

    // The owner publishes a first live revision.
    const created = await createWidget(owner, 'contact_form', 'Live form');
    const draft = created.draft;
    if (draft === null) throw new Error('expected a draft');

    const prepared = await saveDraft(
      owner,
      created.widget.id,
      { ...publishableConfig(draft.config), headline: 'Original headline' },
      draft.version,
    );
    expect(prepared.status).toBe(200);

    const published = await owner.api.post(
      `/api/v1/widgets/${created.widget.id}/publish`,
      { expectedVersion: (prepared.body as { version: number }).version },
      await owner.api.csrfHeaders(),
    );
    expect(published.status).toBe(200);

    const live = await getDetail(owner, created.widget.id);
    expect(live.published?.config.headline).toBe('Original headline');
    expect(live.widget.state).toBe('published');

    /**
     * Publishing promoted the draft, so there is no draft to reopen: blueprint
     * 4.5 says editing a published widget CREATES one. A first write therefore
     * carries version 0, which is what a client sees when `draft` is null.
     */
    const memberView = await getDetail(member, created.widget.id);
    expect(memberView.draft).toBeNull();

    const memberSave = await saveDraft(
      member,
      created.widget.id,
      { ...(memberView.published?.config ?? draft.config), headline: 'Member edit' },
      0,
    );
    expect(memberSave.status).toBe(200);

    // The live revision is untouched: same headline, same revision number.
    const afterEdit = await getDetail(owner, created.widget.id);
    expect(afterEdit.published?.config.headline).toBe('Original headline');
    expect(afterEdit.published?.revisionNumber).toBe(live.published?.revisionNumber);
    expect(afterEdit.draft?.config.headline).toBe('Member edit');
    expect(afterEdit.widget.hasUnpublishedChanges).toBe(true);

    // And the Member cannot make their edit live.
    const memberPublish = await member.api.post(
      `/api/v1/widgets/${created.widget.id}/publish`,
      { expectedVersion: afterEdit.draft?.version ?? 0 },
      await member.api.csrfHeaders(),
    );
    expect(memberPublish.status).toBe(403);
    expect((memberPublish.body as { error: { code: string } }).error.code).toBe('forbidden');
  });

  it('editing a published widget opens a NEW draft rather than rewriting the live revision', async () => {
    const { owner, widgetId, version } = await ownerWithPublishableWidget('w-newdraft');

    const published = await owner.api.post(
      `/api/v1/widgets/${widgetId}/publish`,
      { expectedVersion: version },
      await owner.api.csrfHeaders(),
    );
    expect(published.status).toBe(200);

    const afterPublish = await getDetail(owner, widgetId);
    // Publishing promoted the draft, so there is no draft left.
    expect(afterPublish.draft).toBeNull();
    const liveRevision = afterPublish.published?.revisionNumber ?? 0;

    // The next edit allocates the next revision number for a fresh draft.
    const edited = await saveDraft(
      owner,
      widgetId,
      {
        ...(afterPublish.published?.config ?? publishableConfig(defaultsOf(afterPublish))),
        headline: 'Second pass',
      },
      0,
    );
    expect(edited.status).toBe(200);

    const afterEdit = await getDetail(owner, widgetId);
    expect(afterEdit.draft?.revisionNumber).toBe(liveRevision + 1);
    expect(afterEdit.published?.revisionNumber).toBe(liveRevision);
    expect(afterEdit.published?.config.headline).not.toBe('Second pass');
  });

  it('refuses a stale draft write with 409 instead of losing a teammate edit', async () => {
    const owner = await verifiedUser('w-conflict-owner');
    await onboard(owner, 'Conflict Co');
    const member = await verifiedUser('w-conflict-member');
    await inviteAndAccept(owner, member, 'member');

    const created = await createWidget(owner, 'contact_form', 'Shared form');
    const draft = created.draft;
    if (draft === null) throw new Error('expected a draft');

    // Both read the same version.
    const sharedVersion = draft.version;

    const first = await saveDraft(
      owner,
      created.widget.id,
      { ...draft.config, headline: 'Owner wins the race' },
      sharedVersion,
    );
    expect(first.status).toBe(200);

    const second = await saveDraft(
      member,
      created.widget.id,
      { ...draft.config, headline: 'Member would have overwritten' },
      sharedVersion,
    );

    // Blueprint 10.1: a conflicting update returns 409, not a silent overwrite.
    expect(second.status).toBe(409);
    expect((second.body as { error: { code: string } }).error.code).toBe('stale_revision');

    const detail = await getDetail(owner, created.widget.id);
    expect(detail.draft?.config.headline).toBe('Owner wins the race');

    // Rebasing onto the current version succeeds.
    const rebased = await saveDraft(
      member,
      created.widget.id,
      { ...draft.config, headline: 'Member rebased' },
      detail.draft?.version ?? 0,
    );
    expect(rebased.status).toBe(200);
  });

  it('rejects a configuration that breaks its type rules, listing the fields', async () => {
    const owner = await verifiedUser('w-invalid');
    await onboard(owner, 'Invalid Co');
    const created = await createWidget(owner, 'contact_form', 'Broken form');
    const draft = created.draft;
    if (draft === null) throw new Error('expected a draft');

    const withoutMessage: WidgetConfig = {
      ...draft.config,
      fields: draft.config.fields.filter((field) => field.type !== 'message'),
    };
    const response = await saveDraft(owner, created.widget.id, withoutMessage, draft.version);
    expect(response.status).toBe(400);
    const body = response.body as { error: { code: string; details: { message: string }[] } };
    expect(body.error.code).toBe('validation_failed');
    expect(JSON.stringify(body.error.details)).toContain('message');
  });

  it('refuses a javascript: CTA destination and a javascript: redirect', async () => {
    const owner = await verifiedUser('w-xss');
    await onboard(owner, 'XSS Co');
    const created = await createWidget(owner, 'cta_popover', 'Popover');
    const draft = created.draft;
    if (draft === null) throw new Error('expected a draft');

    const evilCta: WidgetConfig = {
      ...draft.config,
      ctaAction: { kind: 'external_url', url: 'javascript:alert(document.cookie)' },
    };
    expect((await saveDraft(owner, created.widget.id, evilCta, draft.version)).status).toBe(400);

    const evilRedirect: WidgetConfig = {
      ...draft.config,
      success: { kind: 'redirect', url: 'javascript:alert(1)' },
    };
    expect((await saveDraft(owner, created.widget.id, evilRedirect, draft.version)).status).toBe(
      400,
    );
  });
});

describe('publishing (blueprint 4.5, 11) - EXIT GATE part 2', () => {
  it('a verified Admin publishes, creating an immutable live revision', async () => {
    const owner = await verifiedUser('w-pub-owner');
    await onboard(owner, 'Publish Co');
    const admin = await verifiedUser('w-pub-admin');
    await inviteAndAccept(owner, admin, 'admin');

    const created = await createWidget(owner, 'contact_form', 'Admin publishes this');
    const draft = created.draft;
    if (draft === null) throw new Error('expected a draft');

    const prepared = await saveDraft(
      admin,
      created.widget.id,
      { ...publishableConfig(draft.config), headline: 'Published by admin' },
      draft.version,
    );
    expect(prepared.status).toBe(200);

    const response = await admin.api.post(
      `/api/v1/widgets/${created.widget.id}/publish`,
      { expectedVersion: (prepared.body as { version: number }).version },
      await admin.api.csrfHeaders(),
    );
    expect(response.status).toBe(200);
    expect((response.body as { status: string }).status).toBe('published');

    const detail = await getDetail(owner, created.widget.id);
    expect(detail.widget.state).toBe('published');
    expect(detail.published?.config.headline).toBe('Published by admin');
    expect(detail.published?.publishedByUserId).toBe(admin.userId);
    expect(detail.published?.publishedAt).not.toBeNull();

    // Blueprint 9.3: the published revision is immutable. It is stored as
    // `published`, and every write path filters on `status: 'draft'`.
    const stored = await harness.db
      .collection(COLLECTIONS.widgetRevisions)
      .findOne({ _id: new ObjectId(detail.published?.id ?? '') });
    expect(stored?.['status']).toBe('published');
  });

  it('refuses to publish for an UNVERIFIED Owner, and says why', async () => {
    const unverified = await unverifiedUser('w-unverified');
    await onboard(unverified, 'Unconfirmed Co');

    const created = await createWidget(unverified, 'contact_form', 'Cannot publish');
    const draft = created.draft;
    if (draft === null) throw new Error('expected a draft');

    // Drafting is allowed - blueprint 4.1 keeps the dashboard available.
    const saved = await saveDraft(
      unverified,
      created.widget.id,
      publishableConfig(draft.config),
      draft.version,
    );
    expect(saved.status).toBe(200);

    // Publishing is not, and the refusal is specific.
    const response = await unverified.api.post(
      `/api/v1/widgets/${created.widget.id}/publish`,
      { expectedVersion: (saved.body as { version: number }).version },
      await unverified.api.csrfHeaders(),
    );
    expect(response.status).toBe(403);
    expect((response.body as { error: { code: string } }).error.code).toBe('email_not_verified');
  });

  it('refuses to publish without an allowed domain (blueprint 4.4)', async () => {
    const owner = await verifiedUser('w-nodomain');
    await onboard(owner, 'No Domain Co');
    const created = await createWidget(owner, 'contact_form', 'No domains yet');
    const draft = created.draft;
    if (draft === null) throw new Error('expected a draft');

    const response = await owner.api.post(
      `/api/v1/widgets/${created.widget.id}/publish`,
      { expectedVersion: draft.version },
      await owner.api.csrfHeaders(),
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('allowed domain');
  });

  it('unpublishing stops serving without destroying the revision', async () => {
    const { owner, widgetId, version } = await ownerWithPublishableWidget('w-unpub');
    expect(
      (
        await owner.api.post(
          `/api/v1/widgets/${widgetId}/publish`,
          { expectedVersion: version },
          await owner.api.csrfHeaders(),
        )
      ).status,
    ).toBe(200);

    const response = await owner.api.post(
      `/api/v1/widgets/${widgetId}/unpublish`,
      undefined,
      await owner.api.csrfHeaders(),
    );
    expect(response.status).toBe(200);

    const detail = await getDetail(owner, widgetId);
    expect(detail.widget.state).toBe('unpublished');
    expect(detail.widget.publishedRevisionNumber).toBeNull();
    expect(detail.published).toBeNull();

    // The revision row survives; only the live pointer was cleared.
    const revisions = await harness.db
      .collection(COLLECTIONS.widgetRevisions)
      .find({ status: 'published' })
      .toArray();
    expect(revisions.length).toBeGreaterThan(0);
  });

  it('refuses a second publish of the same draft version', async () => {
    const { owner, widgetId, version } = await ownerWithPublishableWidget('w-doublepub');

    const first = await owner.api.post(
      `/api/v1/widgets/${widgetId}/publish`,
      { expectedVersion: version },
      await owner.api.csrfHeaders(),
    );
    expect(first.status).toBe(200);

    const second = await owner.api.post(
      `/api/v1/widgets/${widgetId}/publish`,
      { expectedVersion: version },
      await owner.api.csrfHeaders(),
    );
    // There is no draft left to publish, so this is a conflict, not a second
    // identical live revision.
    expect(second.status).toBe(409);
  });

  it('a Member is refused publish and delete (blueprint 11)', async () => {
    const owner = await verifiedUser('w-member-denied-owner');
    await onboard(owner, 'Member Denied Co');
    const member = await verifiedUser('w-member-denied');
    await inviteAndAccept(owner, member, 'member');

    const created = await createWidget(owner, 'contact_form', 'Members may not publish');

    const publish = await member.api.post(
      `/api/v1/widgets/${created.widget.id}/publish`,
      { expectedVersion: 0 },
      await member.api.csrfHeaders(),
    );
    expect(publish.status).toBe(403);

    const unpublish = await member.api.post(
      `/api/v1/widgets/${created.widget.id}/unpublish`,
      undefined,
      await member.api.csrfHeaders(),
    );
    expect(unpublish.status).toBe(403);

    const removed = await member.api.delete(
      `/api/v1/widgets/${created.widget.id}`,
      await member.api.csrfHeaders(),
    );
    expect(removed.status).toBe(403);

    // But a Member can still read and draft.
    expect((await member.api.get(`/api/v1/widgets/${created.widget.id}`)).status).toBe(200);
  });
});

describe('widget trash and recovery (blueprint 4.5, 9.5)', () => {
  it('soft-deletes, hides the widget, and restores it WITHOUT republishing', async () => {
    const { owner, widgetId, version } = await ownerWithPublishableWidget('w-trash');
    expect(
      (
        await owner.api.post(
          `/api/v1/widgets/${widgetId}/publish`,
          { expectedVersion: version },
          await owner.api.csrfHeaders(),
        )
      ).status,
    ).toBe(200);

    const deleted = await owner.api.delete(
      `/api/v1/widgets/${widgetId}`,
      await owner.api.csrfHeaders(),
    );
    expect(deleted.status).toBe(200);

    // Gone from the list and from detail, but not purged.
    const list = await owner.api.get('/api/v1/widgets');
    expect((list.body as { widgets: WidgetSummary[] }).widgets).toHaveLength(0);
    expect((await owner.api.get(`/api/v1/widgets/${widgetId}`)).status).toBe(404);

    const stored = await harness.db
      .collection(COLLECTIONS.widgets)
      .findOne({ _id: new ObjectId(widgetId) });
    expect(stored?.['status']).toBe('deleted');
    expect(stored?.['purgeAfter']).toBeInstanceOf(Date);

    // It appears in the trash listing.
    const trash = await owner.api.get('/api/v1/widgets/trash');
    expect((trash.body as { widgets: WidgetSummary[] }).widgets).toHaveLength(1);

    const recovered = await owner.api.post(
      `/api/v1/widgets/${widgetId}/recover`,
      undefined,
      await owner.api.csrfHeaders(),
    );
    expect(recovered.status).toBe(200);

    // Blueprint 4.5: restoring does not automatically republish.
    const detail = await getDetail(owner, widgetId);
    expect(detail.widget.state).toBe('unpublished');
    expect(detail.published).toBeNull();
  });

  it('refuses recovery once the 30-day window has passed', async () => {
    const owner = await verifiedUser('w-expired');
    const workspaceId = await onboard(owner, 'Expired Co');
    const created = await createWidget(owner, 'email_signup', 'Old widget');

    expect(
      (
        await owner.api.delete(
          `/api/v1/widgets/${created.widget.id}`,
          await owner.api.csrfHeaders(),
        )
      ).status,
    ).toBe(200);

    /**
     * Thirty-one days is also past the absolute session lifetime, so the old
     * session is legitimately gone. Signing in again is the honest way to get
     * back in - weakening the jump to keep a session alive would stop the test
     * from crossing the window it exists to check.
     */
    harness.clock.advanceDays(31);
    expect(
      (
        await owner.api.post('/api/v1/auth/login', {
          email: owner.email,
          password: STRONG_PASSWORD,
        })
      ).status,
    ).toBe(200);

    // A fresh session has no active workspace, exactly as after any sign-in,
    // so it has to be selected before a workspace-scoped route will answer.
    expect(
      (
        await owner.api.post(
          '/api/v1/workspaces/switch',
          { workspaceId },
          await owner.api.csrfHeaders(),
        )
      ).status,
    ).toBe(200);

    const response = await owner.api.post(
      `/api/v1/widgets/${created.widget.id}/recover`,
      undefined,
      await owner.api.csrfHeaders(),
    );
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).toContain('30-day');

    // And it is no longer offered as recoverable.
    const trash = await owner.api.get('/api/v1/widgets/trash');
    expect((trash.body as { widgets: WidgetSummary[] }).widgets).toHaveLength(0);

    harness.clock.advanceDays(-31);
  });
});

describe('workspace-scoped audit (blueprint 9.3)', () => {
  it('records create, publish, unpublish, delete, and recover with actor and correlation id', async () => {
    const { owner, widgetId, version } = await ownerWithPublishableWidget('w-audit');

    await owner.api.post(
      `/api/v1/widgets/${widgetId}/publish`,
      { expectedVersion: version },
      await owner.api.csrfHeaders(),
    );
    await owner.api.post(
      `/api/v1/widgets/${widgetId}/unpublish`,
      undefined,
      await owner.api.csrfHeaders(),
    );
    await owner.api.delete(`/api/v1/widgets/${widgetId}`, await owner.api.csrfHeaders());
    await owner.api.post(
      `/api/v1/widgets/${widgetId}/recover`,
      undefined,
      await owner.api.csrfHeaders(),
    );

    const response = await owner.api.get('/api/v1/workspaces/audit');
    const events = (response.body as { events: { type: string; actorUserId: string | null }[] })
      .events;
    const types = events.map((event) => event.type);

    for (const expected of [
      'widget.created',
      'widget.published',
      'widget.unpublished',
      'widget.deleted',
      'widget.recovered',
    ]) {
      expect(types, expected).toContain(expected);
    }

    for (const event of events.filter((entry) => entry.type.startsWith('widget.'))) {
      expect(event.actorUserId).toBe(owner.userId);
    }

    // No captured values or secrets end up in audit metadata.
    expect(JSON.stringify(events)).not.toContain(STRONG_PASSWORD);
  });
});

describe('cross-tenant isolation on every widget path - EXIT GATE part 3', () => {
  it('another tenant cannot read, modify, publish, delete, or recover a widget', async () => {
    // Blueprint 9.1 requires this per endpoint, not once representatively.
    const { owner, widgetId, version } = await ownerWithPublishableWidget('w-tenant-a');
    await owner.api.post(
      `/api/v1/widgets/${widgetId}/publish`,
      { expectedVersion: version },
      await owner.api.csrfHeaders(),
    );

    const stranger = await verifiedUser('w-tenant-b');
    await onboard(stranger, 'Other Tenant Co');
    const strangerHeaders = await stranger.api.csrfHeaders();
    const detail = await getDetail(owner, widgetId);

    // Read
    expect((await stranger.api.get(`/api/v1/widgets/${widgetId}`)).status).toBe(404);

    // The stranger's own list never contains it.
    const list = await stranger.api.get('/api/v1/widgets');
    expect((list.body as { widgets: WidgetSummary[] }).widgets).toHaveLength(0);

    // Modify
    expect(
      (
        await stranger.api.put(
          `/api/v1/widgets/${widgetId}/draft`,
          { config: detail.published?.config, expectedVersion: 0 },
          strangerHeaders,
        )
      ).status,
    ).toBe(404);

    // Publish and unpublish
    expect(
      (
        await stranger.api.post(
          `/api/v1/widgets/${widgetId}/publish`,
          { expectedVersion: 0 },
          strangerHeaders,
        )
      ).status,
    ).toBe(404);
    expect(
      (await stranger.api.post(`/api/v1/widgets/${widgetId}/unpublish`, undefined, strangerHeaders))
        .status,
    ).toBe(404);

    // Delete and recover
    expect((await stranger.api.delete(`/api/v1/widgets/${widgetId}`, strangerHeaders)).status).toBe(
      404,
    );
    expect(
      (await stranger.api.post(`/api/v1/widgets/${widgetId}/recover`, undefined, strangerHeaders))
        .status,
    ).toBe(404);

    // After all of that, the owner's widget is exactly as it was.
    const after = await getDetail(owner, widgetId);
    expect(after.widget.state).toBe('published');
    expect(after.published?.revisionNumber).toBe(detail.published?.revisionNumber);
  });

  it('keeps the widget collections workspace-scoped in storage, not only in the API', async () => {
    const first = await ownerWithPublishableWidget('w-scope-a');
    const second = await ownerWithPublishableWidget('w-scope-b');

    const widgets = await harness.db.collection(COLLECTIONS.widgets).find({}).toArray();
    const revisions = await harness.db.collection(COLLECTIONS.widgetRevisions).find({}).toArray();

    // Every row carries a workspaceId (blueprint 9.1), and the two tenants'
    // rows never share one.
    for (const row of [...widgets, ...revisions]) {
      expect(row['workspaceId']).toBeDefined();
    }

    const firstWidget = widgets.find((row) => row['_id']?.toString() === first.widgetId);
    const secondWidget = widgets.find((row) => row['_id']?.toString() === second.widgetId);
    expect(firstWidget?.['workspaceId']?.toString()).not.toBe(
      secondWidget?.['workspaceId']?.toString(),
    );
  });

  it("gives an unparseable widget id the same answer as someone else's widget", async () => {
    const owner = await verifiedUser('w-badid');
    await onboard(owner, 'Bad Id Co');
    expect((await owner.api.get('/api/v1/widgets/not-an-object-id')).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------

function defaultsOf(detail: WidgetDetail): WidgetConfig {
  const config = detail.published?.config ?? detail.draft?.config;
  if (config === undefined) throw new Error('expected a configuration');
  return config;
}
