import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import {
  COLLECTIONS,
  workspaceScope,
  type DailyAnalyticsRecord,
  type InteractionEventRecord,
} from '@lcp/database';
import type { AnalyticsOverview, WidgetConfig, WidgetDetail } from '@lcp/contracts';
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
 * Interaction-event ingestion, aggregation, and the completed live stream
 * (blueprint 4.9, 4.10, 9.4, 13.1, 13.2) - against real MongoDB, Redis, and
 * Mailpit.
 *
 * The Stage 10a exit gate is three claims, and each has named tests below:
 *
 *   GATE 1: seeded deterministic data produces verified metrics;
 *   GATE 2: raw-event cleanup leaves aggregates intact;
 *   GATE 3: the completed SSE stream never crosses tenants and revokes.
 */

let harness: AuthHarness;

beforeAll(async () => {
  harness = await createAuthHarness();
}, 120_000);

beforeEach(async () => {
  await harness.clearRateLimits();
  for (const collection of [
    COLLECTIONS.interactionEvents,
    COLLECTIONS.dailyAnalytics,
    COLLECTIONS.submissionEvents,
    COLLECTIONS.contacts,
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
  readonly workspaceId: string;
}

async function verifiedOwner(label: string, timezone = 'Europe/Berlin'): Promise<Owner> {
  const email = uniqueEmail(label);
  const api = new TestClient(harness.baseUrl);

  await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
  const message = await waitForEmail(email, (m) => m.Subject.includes('Confirm'));
  await api.post('/api/v1/auth/verify', { token: extractToken(await mailpitBody(message.ID)) });
  await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });

  const created = await api.post(
    '/api/v1/workspaces',
    { name: `${label} workspace`, timezone },
    await api.csrfHeaders(),
  );
  expect(created.status).toBe(201);
  return {
    api,
    email,
    workspaceId: (created.body as { workspace: { id: string } }).workspace.id,
  };
}

const ALLOWED_ORIGIN = 'https://shop.example.com';

async function publishWidget(
  owner: Owner,
  label: string,
  type: 'contact_form' | 'cta_popover' = 'contact_form',
): Promise<{ publicId: string; widgetId: string }> {
  const created = await owner.api.post(
    '/api/v1/widgets',
    { type, name: `${label} widget` },
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
  const published = await owner.api.post(
    `/api/v1/widgets/${detail.widget.id}/publish`,
    { expectedVersion: (saved.body as { version: number }).version },
    await owner.api.csrfHeaders(),
  );
  expect(published.status).toBe(200);
  return { publicId: detail.widget.publicId, widgetId: detail.widget.id };
}

async function sendEvents(
  publicId: string,
  types: readonly string[],
  origin: string = ALLOWED_ORIGIN,
  pageUrl = 'https://shop.example.com/pricing',
): Promise<{ status: number; body: unknown }> {
  return new TestClient(harness.baseUrl).post(
    `/widget/v1/events/${publicId}`,
    { events: types.map((type) => ({ type, pageUrl })) },
    { origin },
  );
}

function scope(owner: Owner) {
  return workspaceScope(new ObjectId(owner.workspaceId));
}

async function rawEvents(owner: Owner): Promise<InteractionEventRecord[]> {
  return harness.db
    .collection<InteractionEventRecord>(COLLECTIONS.interactionEvents)
    .find({ workspaceId: new ObjectId(owner.workspaceId) })
    .toArray();
}

async function aggregates(owner: Owner): Promise<DailyAnalyticsRecord[]> {
  return harness.db
    .collection<DailyAnalyticsRecord>(COLLECTIONS.dailyAnalytics)
    .find({ workspaceId: new ObjectId(owner.workspaceId) })
    .toArray();
}

// ===========================================================================
// Ingestion (blueprint 13.2 step 1)
// ===========================================================================

describe('the public interaction-event endpoint', () => {
  it('accepts a batch from an allowed origin and stores one row per event', async () => {
    const owner = await verifiedOwner('ingest');
    const { publicId } = await publishWidget(owner, 'ingest');

    const response = await sendEvents(publicId, ['impression', 'open', 'form_start']);
    expect(response.status).toBe(202);
    expect((response.body as { accepted: number }).accepted).toBe(3);

    const rows = await rawEvents(owner);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.type).sort()).toEqual(['form_start', 'impression', 'open']);
    expect(rows[0]?.source.domain).toBe('shop.example.com');
  }, 60_000);

  it('stores a rotating pseudonym and NO raw address', async () => {
    const owner = await verifiedOwner('ingest-privacy');
    const { publicId } = await publishWidget(owner, 'ingest-privacy');
    await sendEvents(publicId, ['impression']);

    const rows = await rawEvents(owner);
    const row = rows[0];
    expect(row?.visitorPseudonym).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.visitorPseudonymPeriod).toMatch(/^\d{4}-\d{2}$/);

    // Blueprint 9.4: no raw IP is ever persisted.
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain('127.0.0.1');
    expect(serialised).not.toContain('::1');
    expect(row).not.toHaveProperty('ip');
    expect(row).not.toHaveProperty('userAgent');
  }, 60_000);

  it('refuses a disallowed Origin, and says nothing about why', async () => {
    const owner = await verifiedOwner('ingest-origin');
    const { publicId } = await publishWidget(owner, 'ingest-origin');

    const response = await sendEvents(publicId, ['impression'], 'https://evil.example.com');
    // A uniform 202 with nothing accepted: a public id must not become a way
    // to probe which widgets exist or which origins they trust.
    expect(response.status).toBe(202);
    expect((response.body as { accepted: number }).accepted).toBe(0);
    expect(await rawEvents(owner)).toHaveLength(0);
  }, 60_000);

  it('records nothing for an unknown or unpublished widget', async () => {
    const owner = await verifiedOwner('ingest-unpublished');
    const { publicId, widgetId } = await publishWidget(owner, 'ingest-unpublished');

    await owner.api.post(
      `/api/v1/widgets/${widgetId}/unpublish`,
      undefined,
      await owner.api.csrfHeaders(),
    );

    expect((await sendEvents(publicId, ['impression'])).status).toBe(202);
    expect((await sendEvents('w_doesnotexist1234', ['impression'])).status).toBe(202);
    expect(await rawEvents(owner)).toHaveLength(0);
  }, 60_000);

  it('rejects a malformed batch distinctly, because that is a caller bug', async () => {
    const owner = await verifiedOwner('ingest-malformed');
    const { publicId } = await publishWidget(owner, 'ingest-malformed');

    const bad = await sendEvents(publicId, ['not_a_real_event']);
    expect(bad.status).toBe(400);

    const empty = await new TestClient(harness.baseUrl).post(
      `/widget/v1/events/${publicId}`,
      { events: [] },
      { origin: ALLOWED_ORIGIN },
    );
    expect(empty.status).toBe(400);
  }, 60_000);

  it('never trusts a client-supplied timestamp or visitor id', async () => {
    const owner = await verifiedOwner('ingest-trust');
    const { publicId } = await publishWidget(owner, 'ingest-trust');

    const backdated = Date.UTC(2020, 0, 1);
    await new TestClient(harness.baseUrl).post(
      `/widget/v1/events/${publicId}`,
      {
        events: [{ type: 'impression', observedAt: backdated }],
        // Not in the schema; must be ignored rather than honoured.
        visitorPseudonym: 'chosen-by-the-caller',
      },
      { origin: ALLOWED_ORIGIN },
    );

    const row = (await rawEvents(owner))[0];
    /**
     * The server's clock decides the day. A client timestamp would let a caller
     * backdate events into an already-aggregated, already-expired day.
     */
    expect(row?.occurredAt.getUTCFullYear()).toBeGreaterThan(2020);
    expect(row?.visitorPseudonym).not.toBe('chosen-by-the-caller');
  }, 60_000);

  it('throttles a visitor hammering one widget', async () => {
    const owner = await verifiedOwner('ingest-rate');
    const { publicId } = await publishWidget(owner, 'ingest-rate');

    let accepted = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await sendEvents(publicId, ['impression']);
      accepted += (response.body as { accepted: number }).accepted;
    }
    // The per-visitor rule allows 30 batches a minute; the rest are absorbed
    // silently, because a browser should never see an error for telemetry.
    expect(accepted).toBeLessThanOrEqual(30);
    expect(accepted).toBeGreaterThan(0);
  }, 90_000);
});

// ===========================================================================
// GATE 1 - seeded data produces verified metrics
// ===========================================================================

describe('GATE 1: aggregation produces verified metrics - EXIT GATE', () => {
  it('rolls a deterministic day into counters that match the funnel formulas', async () => {
    const owner = await verifiedOwner('agg-metrics');
    const { publicId, widgetId } = await publishWidget(owner, 'agg-metrics', 'cta_popover');

    /**
     * A deliberately shaped day: 4 impressions, 2 opens, 1 form start, 1
     * submission. Sent as four separate batches so each is a distinct visitor
     * stage rather than one visitor's whole funnel, and the numbers are exact
     * rather than approximate.
     */
    await sendEvents(publicId, ['impression']);
    await sendEvents(publicId, ['impression', 'open']);
    await sendEvents(publicId, ['impression', 'open', 'form_start']);
    await sendEvents(publicId, ['impression', 'cta_click']);

    // 1 + 2 + 3 + 2 = 8 rows: the server stores every event in every batch.
    expect(await rawEvents(owner)).toHaveLength(8);

    const summary = await harness.deps.analyticsService.aggregatePending();
    expect(summary.days).toBe(1);

    const rows = await aggregates(owner);
    const total = rows.find((row) => row.dimension === 'total');
    expect(total).toBeDefined();
    expect(total?.impressions).toBe(4);
    expect(total?.opens).toBe(2);
    expect(total?.formStarts).toBe(1);
    expect(total?.ctaClicks).toBe(1);
    expect(total?.widgetId.toHexString()).toBe(widgetId);

    // A CTA popover CAN be opened, so its impressions are eligible (13.2).
    expect(total?.openEligible).toBe(true);

    // Every batch came from one test client, so one pseudonym: the distinct
    // visitor count is 1, not 4.
    expect(total?.visitors).toBe(1);
  }, 90_000);

  it('slices the same day by domain, page, and widget', async () => {
    const owner = await verifiedOwner('agg-slices');
    const { publicId } = await publishWidget(owner, 'agg-slices');

    await sendEvents(publicId, ['impression'], ALLOWED_ORIGIN, 'https://shop.example.com/a');
    await sendEvents(publicId, ['impression'], ALLOWED_ORIGIN, 'https://shop.example.com/b');
    await sendEvents(publicId, ['impression'], ALLOWED_ORIGIN, 'https://shop.example.com/a');

    await harness.deps.analyticsService.aggregatePending();
    const rows = await aggregates(owner);

    const domain = rows.filter((row) => row.dimension === 'domain');
    expect(domain).toHaveLength(1);
    expect(domain[0]?.dimensionValue).toBe('shop.example.com');
    expect(domain[0]?.impressions).toBe(3);

    const pages = rows.filter((row) => row.dimension === 'page');
    expect(pages).toHaveLength(2);
    expect(pages.find((row) => row.dimensionValue?.endsWith('/a'))?.impressions).toBe(2);
    expect(pages.find((row) => row.dimensionValue?.endsWith('/b'))?.impressions).toBe(1);
  }, 90_000);

  it('marks an INLINE form as not open-eligible', async () => {
    /**
     * Blueprint 13.2's "eligible impressions". An inline form is permanently
     * visible and has no open action; counting it would report an open rate
     * that is really a measure of how many inline widgets a workspace has.
     */
    const owner = await verifiedOwner('agg-eligible');
    const { publicId } = await publishWidget(owner, 'agg-eligible', 'contact_form');

    await sendEvents(publicId, ['impression']);
    await harness.deps.analyticsService.aggregatePending();

    const total = (await aggregates(owner)).find((row) => row.dimension === 'total');
    expect(total?.openEligible).toBe(false);
  }, 60_000);

  it('is IDEMPOTENT: running the same day twice does not double the counters', async () => {
    const owner = await verifiedOwner('agg-idempotent');
    const { publicId } = await publishWidget(owner, 'agg-idempotent');

    await sendEvents(publicId, ['impression', 'form_start']);

    await harness.deps.analyticsService.aggregatePending();
    const first = (await aggregates(owner)).find((row) => row.dimension === 'total');

    await harness.deps.analyticsService.aggregatePending();
    await harness.deps.analyticsService.aggregatePending();
    const rows = await aggregates(owner);
    const second = rows.find((row) => row.dimension === 'total');

    // One set of counters, with the same numbers - not three sets, and not
    // tripled numbers. The unique key plus recompute-and-upsert is what makes a
    // retried BullMQ job safe.
    expect(rows.filter((row) => row.dimension === 'total')).toHaveLength(1);
    expect(second?.impressions).toBe(first?.impressions);
    expect(second?.formStarts).toBe(first?.formStarts);
    expect(second?.impressions).toBe(1);
  }, 90_000);
});

// ===========================================================================
// GATE 2 - cleanup leaves aggregates intact
// ===========================================================================

describe('GATE 2: raw-event expiry leaves aggregates intact - EXIT GATE', () => {
  it('deletes raw events past 90 days and KEEPS the aggregate', async () => {
    const owner = await verifiedOwner('expiry');
    const { publicId } = await publishWidget(owner, 'expiry');

    await sendEvents(publicId, ['impression', 'open', 'form_start']);
    expect(await rawEvents(owner)).toHaveLength(3);

    /**
     * Age the events past the retention window, measured on the HARNESS CLOCK.
     *
     * The service computes its cutoff from the injected clock, which does not
     * track the wall clock. Using `Date.now()` here put the events within hours
     * of the cutoff on the wrong side of it, and the sweep correctly deleted
     * nothing - a test failing for a reason that had nothing to do with the
     * rule it was checking. Stage 7 hit exactly this.
     */
    const wellPastRetention = new Date(harness.clock.now().getTime() - 100 * 24 * 60 * 60 * 1000);
    await harness.db
      .collection(COLLECTIONS.interactionEvents)
      .updateMany(
        { workspaceId: new ObjectId(owner.workspaceId) },
        { $set: { occurredAt: wellPastRetention } },
      );

    const result = await harness.deps.analyticsService.expireRawEvents();
    expect(result.eventsDeleted).toBe(3);
    expect(result.skipped).toBe(0);

    // The raw detail is gone...
    expect(await rawEvents(owner)).toHaveLength(0);

    // ...and the counters that replaced it survive, which is the whole point.
    const total = (await aggregates(owner)).find((row) => row.dimension === 'total');
    expect(total).toBeDefined();
    expect(total?.impressions).toBe(1);
    expect(total?.opens).toBe(1);
    expect(total?.formStarts).toBe(1);
  }, 90_000);

  it('AGGREGATES an un-aggregated day before deleting it, never the other way', async () => {
    /**
     * The precondition blueprint 4.9 states - raw events are "removed after
     * daily aggregates are produced" - and the reason this is a sweep rather
     * than the TTL index 9.2 might suggest. A TTL deletes on a clock alone; if
     * aggregation had been failing for a week it would destroy the only copy of
     * that week's data, turning a retention rule into data loss.
     *
     * The order is asserted directly: a day that reaches the cutoff with NO
     * aggregate must come out of the sweep with one, and only then without its
     * raw events. If the sweep deleted first, the aggregate would be empty or
     * absent and this fails.
     */
    const owner = await verifiedOwner('expiry-order');
    const { publicId } = await publishWidget(owner, 'expiry-order');
    await sendEvents(publicId, ['impression', 'open']);

    // Nothing has aggregated this day yet.
    expect(await aggregates(owner)).toHaveLength(0);

    await harness.db.collection(COLLECTIONS.interactionEvents).updateMany(
      { workspaceId: new ObjectId(owner.workspaceId) },
      {
        $set: {
          occurredAt: new Date(harness.clock.now().getTime() - 100 * 24 * 60 * 60 * 1000),
        },
      },
    );

    const result = await harness.deps.analyticsService.expireRawEvents();
    expect(result.skipped).toBe(0);
    expect(result.eventsDeleted).toBe(2);

    // The aggregate was written by the sweep itself, and carries the real
    // counts - so the raw events were read before they were removed.
    const total = (await aggregates(owner)).find((row) => row.dimension === 'total');
    expect(total).toBeDefined();
    expect(total?.impressions).toBe(1);
    expect(total?.opens).toBe(1);
    expect(await rawEvents(owner)).toHaveLength(0);
  }, 90_000);

  it('keeps raw events that are still inside the window', async () => {
    const owner = await verifiedOwner('expiry-recent');
    const { publicId } = await publishWidget(owner, 'expiry-recent');
    await sendEvents(publicId, ['impression']);

    const result = await harness.deps.analyticsService.expireRawEvents();
    expect(result.eventsDeleted).toBe(0);
    expect(await rawEvents(owner)).toHaveLength(1);
  }, 60_000);
});

// ===========================================================================
// GATE 3 - the completed SSE stream
// ===========================================================================

interface SseFrame {
  readonly event: string;
  readonly data: string;
}

async function openStream(
  owner: Owner,
  options: { until: (frames: SseFrame[]) => boolean; timeoutMs?: number },
): Promise<{ close: () => void; done: Promise<SseFrame[]> }> {
  const controller = new AbortController();
  const frames: SseFrame[] = [];

  const response = await fetch(`${harness.baseUrl}/api/v1/events`, {
    headers: { cookie: owner.api.cookieHeader, accept: 'text/event-stream' },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  const body = response.body;
  if (body === null) throw new Error('no stream body');

  const done = (async (): Promise<SseFrame[]> => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const deadline = Date.now() + (options.timeoutMs ?? 15_000);

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
            const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
            if (data !== undefined && !raw.startsWith(':')) {
              frames.push({
                event: lines.find((line) => line.startsWith('event: '))?.slice(7) ?? 'message',
                data,
              });
            }
            boundary = buffer.indexOf('\n\n');
          }
        }
        if (options.until(frames)) break;
      }
    } catch {
      // An aborted read is how this ends.
    }
    return frames;
  })();

  return { close: () => controller.abort(), done };
}

describe('GATE 3: the completed live stream - EXIT GATE', () => {
  it('delivers usage.changed to its own workspace and never to another', async () => {
    const owner = await verifiedOwner('sse-usage');
    const { publicId } = await publishWidget(owner, 'sse-usage');

    const outsider = await verifiedOwner('sse-usage-other');

    const mine = await openStream(owner, {
      until: (frames) => frames.some((frame) => frame.event === 'usage.changed'),
    });
    const theirs = await openStream(outsider, {
      until: (frames) => frames.some((frame) => frame.event === 'usage.changed'),
      timeoutMs: 6_000,
    });

    /**
     * A submission moves the submissions meter, which is announced per accepted
     * lead - unlike the interaction meter, which announces per hundred.
     */
    await new TestClient(harness.baseUrl).post(
      `/widget/v1/submit/${publicId}`,
      {
        idempotencyKey: `usage-${String(Date.now())}`,
        values: { email: 'usage@example.invalid', message: 'Hello' },
        pageUrl: 'https://shop.example.com/pricing',
        renderedAt: harness.clock.now().getTime() - 30_000,
      },
      { origin: ALLOWED_ORIGIN },
    );

    const received = await mine.done;
    const usage = received.find((frame) => frame.event === 'usage.changed');
    expect(usage).toBeDefined();
    expect(usage?.data).toContain('submissions');
    mine.close();

    const otherFrames = await theirs.done;
    expect(otherFrames.filter((frame) => frame.event === 'usage.changed')).toHaveLength(0);
    theirs.close();
  }, 90_000);

  it('delivers delivery.status_changed to its own workspace only', async () => {
    const owner = await verifiedOwner('sse-delivery');
    const { publicId, widgetId } = await publishWidget(owner, 'sse-delivery');

    // A verified recipient, so the submission owes a notification.
    const added = await owner.api.post(
      `/api/v1/deliveries/widgets/${widgetId}/recipients`,
      { email: owner.email },
      await owner.api.csrfHeaders(),
    );
    expect(added.status).toBe(201);

    const outsider = await verifiedOwner('sse-delivery-other');

    const mine = await openStream(owner, {
      until: (frames) => frames.some((frame) => frame.event === 'delivery.status_changed'),
    });
    const theirs = await openStream(outsider, {
      until: (frames) => frames.some((frame) => frame.event === 'delivery.status_changed'),
      timeoutMs: 6_000,
    });

    await new TestClient(harness.baseUrl).post(
      `/widget/v1/submit/${publicId}`,
      {
        idempotencyKey: `delivery-sse-${String(Date.now())}`,
        values: { email: 'lead@example.invalid', message: 'Hello' },
        pageUrl: 'https://shop.example.com/pricing',
        renderedAt: harness.clock.now().getTime() - 30_000,
      },
      { origin: ALLOWED_ORIGIN },
    );

    // Drive the delivery, which is what produces the status transition.
    const deliveries = await harness.db
      .collection(COLLECTIONS.deliveries)
      .find({ workspaceId: new ObjectId(owner.workspaceId) })
      .toArray();
    for (const row of deliveries) {
      await harness.deps.deliveryService.attempt(scope(owner), row['_id'] as ObjectId);
    }

    const received = await mine.done;
    const frame = received.find((entry) => entry.event === 'delivery.status_changed');
    expect(frame).toBeDefined();
    expect(frame?.data).toContain('deliveryId');
    // Structural only: a recipient address is never broadcast to every tab.
    expect(frame?.data).not.toContain(owner.email);
    mine.close();

    const otherFrames = await theirs.done;
    expect(otherFrames.filter((entry) => entry.event === 'delivery.status_changed')).toHaveLength(
      0,
    );
    theirs.close();
  }, 90_000);

  it('refuses a stream to a member whose access was revoked', async () => {
    /**
     * Blueprint 13.1: "Authorization is rechecked when the stream begins and
     * workspace membership changes revoke future access." A reconnect after
     * revocation must not succeed.
     */
    const owner = await verifiedOwner('sse-revoke');

    const memberEmail = uniqueEmail('sse-revoke-member');
    const memberApi = new TestClient(harness.baseUrl);
    await memberApi.post('/api/v1/auth/register', {
      email: memberEmail,
      password: STRONG_PASSWORD,
    });
    const confirm = await waitForEmail(memberEmail, (m) => m.Subject.includes('Confirm'));
    await memberApi.post('/api/v1/auth/verify', {
      token: extractToken(await mailpitBody(confirm.ID)),
    });

    await owner.api.post(
      '/api/v1/invitations',
      { email: memberEmail, role: 'member' },
      await owner.api.csrfHeaders(),
    );
    const invite = await waitForEmail(memberEmail, (m) => m.Subject.includes('Join'));
    await memberApi.post('/api/v1/auth/login', { email: memberEmail, password: STRONG_PASSWORD });
    await memberApi.post(
      '/api/v1/invitations/accept',
      { token: extractToken(await mailpitBody(invite.ID)) },
      await memberApi.csrfHeaders(),
    );

    // Connects fine while a member.
    const before = await fetch(`${harness.baseUrl}/api/v1/events`, {
      headers: { cookie: memberApi.cookieHeader, accept: 'text/event-stream' },
    });
    expect(before.status).toBe(200);
    await before.body?.cancel();

    const me = await memberApi.get('/api/v1/auth/me');
    const memberUserId = (me.body as { user: { id: string } }).user.id;
    const removed = await owner.api.delete(
      `/api/v1/members/${memberUserId}`,
      await owner.api.csrfHeaders(),
    );
    expect(removed.status).toBe(204);

    // And is refused on reconnect.
    const after = await fetch(`${harness.baseUrl}/api/v1/events`, {
      headers: { cookie: memberApi.cookieHeader, accept: 'text/event-stream' },
    });
    expect(after.status).toBe(404);
    await after.body?.cancel();
  }, 90_000);
});

// ===========================================================================
// Monthly meters (blueprint 4.10)
// ===========================================================================

describe('monthly meters reset on the workspace timezone boundary', () => {
  it('counts both monthly meters from the workspace month, not UTC', async () => {
    const owner = await verifiedOwner('meters', 'Pacific/Auckland');
    const { publicId } = await publishWidget(owner, 'meters');

    await sendEvents(publicId, ['impression', 'open']);
    await new TestClient(harness.baseUrl).post(
      `/widget/v1/submit/${publicId}`,
      {
        idempotencyKey: `meters-${String(Date.now())}`,
        values: { email: 'meter@example.invalid', message: 'Hello' },
        pageUrl: 'https://shop.example.com/pricing',
        renderedAt: harness.clock.now().getTime() - 30_000,
      },
      { origin: ALLOWED_ORIGIN },
    );

    const usage = await owner.api.get('/api/v1/workspaces/usage');
    expect(usage.status).toBe(200);
    const body = usage.body as {
      submissionsThisMonth: { used: number | null; limit: number };
      interactionEventsThisMonth: { used: number | null; limit: number };
    };

    // Both were `null` - "not measured yet" - until this stage.
    expect(body.interactionEventsThisMonth.used).toBe(2);
    expect(body.interactionEventsThisMonth.limit).toBe(20_000);
    expect(body.submissionsThisMonth.used).toBe(1);
    expect(body.submissionsThisMonth.limit).toBe(2000);
  }, 90_000);

  it('excludes an event recorded before this workspace month began', async () => {
    const owner = await verifiedOwner('meters-boundary', 'Pacific/Auckland');
    const { publicId } = await publishWidget(owner, 'meters-boundary');
    await sendEvents(publicId, ['impression']);

    // Push it back before any plausible month start.
    await harness.db
      .collection(COLLECTIONS.interactionEvents)
      .updateMany(
        { workspaceId: new ObjectId(owner.workspaceId) },
        { $set: { occurredAt: new Date('2020-01-01T00:00:00.000Z') } },
      );

    const usage = await owner.api.get('/api/v1/workspaces/usage');
    const body = usage.body as { interactionEventsThisMonth: { used: number | null } };
    // The meter resets: last month's events are not this month's allowance.
    expect(body.interactionEventsThisMonth.used).toBe(0);
  }, 90_000);
});

// ===========================================================================
// Tenancy
// ===========================================================================

describe('tenancy on the analytics surface (blueprint 9.1)', () => {
  it('never mixes two workspaces raw events or aggregates', async () => {
    const first = await verifiedOwner('xt-a');
    const second = await verifiedOwner('xt-b');
    const a = await publishWidget(first, 'xt-a');
    const b = await publishWidget(second, 'xt-b');

    await sendEvents(a.publicId, ['impression', 'open']);
    await sendEvents(b.publicId, ['impression']);

    await harness.deps.analyticsService.aggregatePending();

    expect(await rawEvents(first)).toHaveLength(2);
    expect(await rawEvents(second)).toHaveLength(1);

    const firstTotals = (await aggregates(first)).filter((row) => row.dimension === 'total');
    const secondTotals = (await aggregates(second)).filter((row) => row.dimension === 'total');
    expect(firstTotals[0]?.impressions).toBe(1);
    expect(firstTotals[0]?.opens).toBe(1);
    expect(secondTotals[0]?.impressions).toBe(1);
    expect(secondTotals[0]?.opens).toBe(0);
  }, 90_000);
});

// ===========================================================================
// The authenticated read surface (blueprint 4.9, 13.2 step 4)
// ===========================================================================

describe('the analytics read endpoint', () => {
  /**
   * Stage 10b's dashboards all come from this one response, so the contract
   * they depend on is asserted here rather than only through what a browser
   * happens to render. A rendered em dash proves the page did the right thing
   * with a null; only a JSON assertion proves the null was there to begin with.
   */

  it('refuses a caller with no session', async () => {
    const anonymous = new TestClient(harness.baseUrl);
    const response = await anonymous.get('/api/v1/analytics');
    expect(response.status).toBe(401);
  });

  it('rejects a range that is not one of the three offered', async () => {
    const owner = await verifiedOwner('read-range');
    const response = await owner.api.get('/api/v1/analytics?range=all-time');
    expect(response.status).toBe(400);
  });

  it('serves each workspace only its own figures', async () => {
    const first = await verifiedOwner('read-a');
    const second = await verifiedOwner('read-b');
    const a = await publishWidget(first, 'read-a');
    const b = await publishWidget(second, 'read-b');

    await sendEvents(a.publicId, ['impression', 'impression', 'open']);
    await sendEvents(b.publicId, ['impression']);

    const mine = (await first.api.get('/api/v1/analytics')).body as AnalyticsOverview;
    const theirs = (await second.api.get('/api/v1/analytics')).body as AnalyticsOverview;

    expect(mine.totals.impressions).toBe(2);
    expect(theirs.totals.impressions).toBe(1);
    expect(mine.byWidget.map((row) => row.widgetId)).toEqual([a.widgetId]);
    expect(theirs.byWidget.map((row) => row.widgetId)).toEqual([b.widgetId]);
  }, 90_000);

  it('reports a rate with no denominator as null, never zero', async () => {
    /**
     * The single most important rule on this surface. A contact form is
     * permanently visible and so has no eligible impressions, which makes the
     * open rate genuinely undefined - not zero. Zero would assert that people
     * arrived and did not act.
     */
    const owner = await verifiedOwner('read-null');
    await publishWidget(owner, 'read-null');
    const widget = await publishWidget(owner, 'read-null-2');
    await sendEvents(widget.publicId, ['impression', 'impression']);

    const body = (await owner.api.get('/api/v1/analytics')).body as AnalyticsOverview;

    expect(body.totals.impressions).toBe(2);
    expect(body.totals.eligibleImpressions).toBe(0);
    expect(body.rates.openRate).toBeNull();
    expect(body.rates.openRate).not.toBe(0);
    expect(body.status.conversion).toBeNull();
  }, 90_000);

  it('names widgets as they are now, not as they were when the day was rolled up', async () => {
    /**
     * The aggregate stores ids, and the name is resolved on read. Denormalising
     * it would freeze the name at aggregation time, so a widget renamed midway
     * through a range would appear under two names in one chart - and blueprint
     * 4.9 keeps aggregates long after the raw events are gone.
     */
    const owner = await verifiedOwner('read-name');
    const widget = await publishWidget(owner, 'read-name');
    await sendEvents(widget.publicId, ['impression']);

    const before = (await owner.api.get('/api/v1/analytics')).body as AnalyticsOverview;
    expect(before.byWidget[0]?.name).toBe('read-name widget');

    await harness.db
      .collection(COLLECTIONS.widgets)
      .updateOne({ _id: new ObjectId(widget.widgetId) }, { $set: { name: 'Renamed widget' } });

    const after = (await owner.api.get('/api/v1/analytics')).body as AnalyticsOverview;
    expect(after.byWidget[0]?.name).toBe('Renamed widget');
    expect(after.byWidget[0]?.counts.impressions).toBe(1);
  }, 90_000);

  it('includes today without waiting for the nightly roll-up', async () => {
    /**
     * Blueprint 13.2 step 4 lets a dashboard read combine recent raw data for
     * freshness. Nothing here runs the aggregator: the events are sent, and the
     * next read is expected to account for them, because a dashboard that shows
     * nothing until tomorrow is not a dashboard.
     */
    const owner = await verifiedOwner('read-fresh');
    const widget = await publishWidget(owner, 'read-fresh');
    await sendEvents(widget.publicId, ['impression', 'open', 'form_start', 'submission']);

    const body = (await owner.api.get('/api/v1/analytics?range=7d')).body as AnalyticsOverview;

    expect(body.totals.impressions).toBe(1);
    expect(body.totals.submissions).toBe(1);
    expect(body.timezone).toBe('Europe/Berlin');
    expect(body.daily).not.toHaveLength(0);
  }, 90_000);
});
