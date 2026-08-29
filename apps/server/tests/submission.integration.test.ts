import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { COLLECTIONS } from '@lcp/database';
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
import type { GeoLookup, GeoProvider } from '../src/ports/geo-provider.js';

/**
 * The hardened public submission path (blueprint 7.3, 7.4, 9.4, 4.10) and the
 * six PDF acceptance probes from blueprint 18.5.
 *
 * Each probe has its own named test below, because EVIDENCE.md cites them
 * individually and "the suite passed" is not the same claim as "this specific
 * property holds".
 */

let harness: AuthHarness;

/** Providers the tests drive, so outcomes are stated rather than awaited. */
class ScriptedGeoProvider implements GeoProvider {
  readonly name: string;
  #result: GeoLookup | null;
  #calls = 0;

  constructor(name: string, result: GeoLookup | null) {
    this.name = name;
    this.#result = result;
  }

  get calls(): number {
    return this.#calls;
  }

  setResult(result: GeoLookup | null): void {
    this.#result = result;
  }

  lookup(): Promise<GeoLookup | null> {
    this.#calls += 1;
    return Promise.resolve(this.#result);
  }
}

const providerA = new ScriptedGeoProvider('ip-api', null);
const providerB = new ScriptedGeoProvider('ipapi-co', null);

beforeAll(async () => {
  harness = await createAuthHarness({ geoProviders: [providerA, providerB] });
}, 120_000);

beforeEach(async () => {
  await harness.clearRateLimits();

  /**
   * Clear what the submission path writes.
   *
   * The harness gives the whole FILE one database, so without this each test
   * would assert against every earlier test's records too - and "one contact
   * exists" would quietly become "seventeen do". Widgets and workspaces are
   * left alone; each test creates its own.
   */
  for (const collection of [
    COLLECTIONS.contacts,
    COLLECTIONS.submissionEvents,
    COLLECTIONS.consentEvents,
    COLLECTIONS.abuseEvents,
    COLLECTIONS.outboxEvents,
  ]) {
    await harness.db.collection(collection).deleteMany({});
  }

  // Both providers down by default; the geo tests opt into an answer.
  providerA.setResult(null);
  providerB.setResult(null);
});

afterAll(async () => {
  await harness?.teardown();
});

const ALLOWED_ORIGIN = 'https://shop.example.com';

interface Owner {
  readonly api: TestClient;
}

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
  return { api };
}

/** A published contact-form widget accepting submissions from ALLOWED_ORIGIN. */
async function publishedWidget(
  label: string,
  tweak?: (config: WidgetConfig) => WidgetConfig,
): Promise<{ owner: Owner; publicId: string; widgetId: string }> {
  const owner = await verifiedOwner(label);

  const created = await owner.api.post(
    '/api/v1/widgets',
    { type: 'contact_form', name: `${label} widget` },
    await owner.api.csrfHeaders(),
  );
  const detail = created.body as WidgetDetail;
  const draft = detail.draft;
  if (draft === null) throw new Error('expected a draft');

  const base: WidgetConfig = {
    ...draft.config,
    targeting: { ...draft.config.targeting, allowedDomains: ['shop.example.com'] },
  };

  const saved = await owner.api.put(
    `/api/v1/widgets/${detail.widget.id}/draft`,
    { config: tweak === undefined ? base : tweak(base), expectedVersion: draft.version },
    await owner.api.csrfHeaders(),
  );
  expect(saved.status).toBe(200);

  const published = await owner.api.post(
    `/api/v1/widgets/${detail.widget.id}/publish`,
    { expectedVersion: (saved.body as { version: number }).version },
    await owner.api.csrfHeaders(),
  );
  expect(published.status).toBe(200);

  return { owner, publicId: detail.widget.publicId, widgetId: detail.widget.id };
}

function visitor(): TestClient {
  return new TestClient(harness.baseUrl);
}

let keyCounter = 0;

/**
 * The server's idea of "now".
 *
 * The harness drives a MutableClock rather than the wall clock, so the timing
 * heuristic compares `renderedAt` against THAT. Using `Date.now()` here made
 * elapsed time come out negative, which the heuristic leniently accepts - so a
 * deliberately too-fast submission was being let through and the test failed
 * for a reason that had nothing to do with the rule it was checking.
 */
function serverNow(): number {
  return harness.clock.now().getTime();
}

function submissionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  keyCounter += 1;
  return {
    idempotencyKey: `test-key-${String(Date.now())}-${String(keyCounter)}`,
    values: { email: 'visitor@example.invalid', message: 'Hello, I would like a quote.' },
    pageUrl: 'https://shop.example.com/pricing',
    // Well past the timing floor, so an ordinary submission is accepted.
    renderedAt: serverNow() - 30_000,
    ...overrides,
  };
}

async function submit(
  publicId: string,
  body: Record<string, unknown> = submissionBody(),
  headers: Record<string, string> = { origin: ALLOWED_ORIGIN },
): Promise<{ status: number; body: unknown; headers: Headers }> {
  return visitor().post(`/widget/v1/submit/${publicId}`, body, headers);
}

// ---------------------------------------------------------------------------

describe('PROBE 1: valid second-origin submission', () => {
  it('accepts a cross-origin submission and stores a durable event and contact', async () => {
    const { publicId } = await publishedWidget('sub-valid');

    const response = await submit(publicId);

    expect(response.status).toBe(202);
    expect((response.body as { status: string }).status).toBe('received');
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);

    const contact = await harness.db
      .collection(COLLECTIONS.contacts)
      .findOne({ normalizedEmail: 'visitor@example.invalid' });
    expect(contact).not.toBeNull();
    expect(contact?.['status']).toBe('new');
    expect(contact?.['submissionCount']).toBe(1);

    const event = await harness.db
      .collection(COLLECTIONS.submissionEvents)
      .findOne({ contactId: contact?.['_id'] });
    expect(event).not.toBeNull();
    expect(event?.['values']).toMatchObject({ email: 'visitor@example.invalid' });
    expect(event?.['source']).toMatchObject({ domain: 'shop.example.com' });

    // Blueprint 12.2: the durable promise of side-effect work, in the same
    // commit as the submission itself.
    const outbox = await harness.db
      .collection(COLLECTIONS.outboxEvents)
      .findOne({ idempotencyKey: `submission:${String(event?.['_id'])}` });
    expect(outbox).not.toBeNull();
    expect(outbox?.['status']).toBe('pending');
  });

  it('attaches a repeat submission to the same contact rather than duplicating it', async () => {
    // Blueprint 4.6: "Repeated submissions from the same normalized email
    // update or attach to the same workspace Contact."
    const { publicId } = await publishedWidget('sub-repeat');

    expect((await submit(publicId)).status).toBe(202);
    expect((await submit(publicId)).status).toBe(202);

    const contacts = await harness.db
      .collection(COLLECTIONS.contacts)
      .find({ normalizedEmail: 'visitor@example.invalid' })
      .toArray();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.['submissionCount']).toBe(2);

    const events = await harness.db
      .collection(COLLECTIONS.submissionEvents)
      .find({ contactId: contacts[0]?.['_id'] })
      .toArray();
    // Two immutable events, one contact.
    expect(events).toHaveLength(2);
  });

  it('never persists the raw IP, only a rotating pseudonym (blueprint 9.4)', async () => {
    const { publicId } = await publishedWidget('sub-privacy');
    await submit(publicId);

    const event = await harness.db.collection(COLLECTIONS.submissionEvents).findOne({});
    expect(event?.['ipPseudonym']).toMatch(/^[0-9a-f]{64}$/);
    expect(event?.['ipPseudonymPeriod']).toMatch(/^\d{4}-\d{2}$/);

    // The address the request came from appears nowhere in the stored document.
    const raw = JSON.stringify(event);
    expect(raw).not.toContain('127.0.0.1');
    expect(raw).not.toContain('::1');
    expect(raw).not.toContain('ipAddress');
  });
});

describe('PROBE 2: malformed and oversized input', () => {
  it('rejects a body over 32 KB with a clean 4xx, never a 500', async () => {
    const { publicId } = await publishedWidget('sub-oversize');

    const huge = 'x'.repeat(40 * 1024);
    const response = await submit(
      publicId,
      submissionBody({ values: { email: 'a@b.co', message: huge } }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect((response.body as { error: { code: string } }).error.code).toBeTruthy();
  });

  it('rejects a value over 5,000 characters with a clean 4xx', async () => {
    const { publicId } = await publishedWidget('sub-longvalue');
    const long = 'y'.repeat(6000);

    const response = await submit(
      publicId,
      submissionBody({ values: { email: 'a@b.co', message: long } }),
    );
    expect(response.status).toBe(400);
    expect((response.body as { error: { code: string } }).error.code).toBe('validation_failed');
  });

  it('rejects more than 20 fields with a clean 4xx', async () => {
    const { publicId } = await publishedWidget('sub-manyfields');
    const values: Record<string, string> = { email: 'a@b.co', message: 'hi' };
    for (let index = 0; index < 25; index += 1) values[`extra${String(index)}`] = 'x';

    const response = await submit(publicId, submissionBody({ values }));
    expect(response.status).toBe(400);
  });

  it('rejects a field the published widget does not declare', async () => {
    // Blueprint 7.3 step 4: validated against the SERVER-owned field schema, so
    // a crafted request cannot smuggle extra values into the event.
    const { publicId } = await publishedWidget('sub-undeclared');

    const response = await submit(
      publicId,
      submissionBody({ values: { email: 'a@b.co', message: 'hi', ssn: '123-45-6789' } }),
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('does not have that field');
  });

  it('rejects malformed JSON and a missing required field as 4xx, never 500', async () => {
    const { publicId } = await publishedWidget('sub-malformed');

    // Missing the required message field.
    const missing = await submit(publicId, submissionBody({ values: { email: 'a@b.co' } }));
    expect(missing.status).toBe(400);

    // Missing the idempotency key entirely.
    const noKey = await submit(publicId, { values: { email: 'a@b.co', message: 'hi' } });
    expect(noKey.status).toBe(400);

    // A syntactically broken body.
    const broken = await visitor().request('POST', `/widget/v1/submit/${publicId}`, undefined, {
      origin: ALLOWED_ORIGIN,
      'content-type': 'application/json',
    });
    expect(broken.status).toBeGreaterThanOrEqual(400);
    expect(broken.status).toBeLessThan(500);
  });
});

describe('PROBE 3: burst traffic', () => {
  it('returns 429 during a burst while a later legitimate request still succeeds', async () => {
    const { publicId } = await publishedWidget('sub-burst');

    /**
     * Blueprint 7.3 step 3: 5 per minute per IP-widget pair. Every request in
     * this suite arrives from 127.0.0.1, so a burst of eight from one client
     * crosses that limit.
     */
    const statuses: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      const response = await submit(
        publicId,
        submissionBody({
          values: { email: `burst${String(index)}@example.invalid`, message: 'hi' },
        }),
      );
      statuses.push(response.status);
    }

    expect(statuses.filter((status) => status === 202).length).toBeGreaterThanOrEqual(5);
    expect(statuses).toContain(429);

    const limited = statuses.indexOf(429);
    expect(limited).toBeGreaterThan(0);

    // A rate-limited attempt is recorded as minimal evidence (blueprint 7.4).
    const abuse = await harness.db
      .collection(COLLECTIONS.abuseEvents)
      .find({ type: 'rate_limit' })
      .toArray();
    expect(abuse.length).toBeGreaterThan(0);

    /**
     * And a later legitimate request still succeeds, which is the half of this
     * probe that proves the limiter throttles rather than bans.
     */
    await harness.clearRateLimits();
    const after = await submit(
      publicId,
      submissionBody({ values: { email: 'after-burst@example.invalid', message: 'still fine' } }),
    );
    expect(after.status).toBe(202);
  });
});

describe('PROBE 4: geo fallback', () => {
  const berlin: GeoLookup = {
    countryCode: 'DE',
    countryName: 'Germany',
    region: 'Berlin',
    city: 'Berlin',
    timezone: 'Europe/Berlin',
    provider: 'ipapi-co',
  };

  it('enriches from provider A when A answers', async () => {
    providerA.setResult({ ...berlin, provider: 'ip-api' });
    const { publicId } = await publishedWidget('sub-geo-a');

    await submit(publicId);

    const event = await harness.db
      .collection(COLLECTIONS.submissionEvents)
      .findOne({}, { sort: { submittedAt: -1 } });
    expect(event?.['geo']).toMatchObject({
      countryCode: 'DE',
      provider: 'ip-api',
      usedFallback: false,
    });
  });

  it('A down, B enriches - and records that the fallback was used', async () => {
    providerA.setResult(null);
    providerB.setResult(berlin);
    const { publicId } = await publishedWidget('sub-geo-b');

    await submit(publicId);

    const event = await harness.db
      .collection(COLLECTIONS.submissionEvents)
      .findOne({}, { sort: { submittedAt: -1 } });
    expect(event?.['geo']).toMatchObject({
      countryCode: 'DE',
      provider: 'ipapi-co',
      // Blueprint 9.4 lists provider/fallback status as worth persisting: it is
      // the only way to notice from stored data that the primary is failing.
      usedFallback: true,
    });
  });

  it('A and B down - the submission is still stored, without geo', async () => {
    providerA.setResult(null);
    providerB.setResult(null);
    const { publicId } = await publishedWidget('sub-geo-none');

    const response = await submit(publicId);
    expect(response.status).toBe(202);

    const event = await harness.db
      .collection(COLLECTIONS.submissionEvents)
      .findOne({}, { sort: { submittedAt: -1 } });
    expect(event).not.toBeNull();
    // Blueprint 7.3 step 8: "If both fail, storage still succeeds without geo."
    expect(event?.['geo']).toBeNull();
  });
});

describe('PROBE 5: side-effect failure', () => {
  it('keeps the submission when side-effect work cannot be started', async () => {
    /**
     * Blueprint 7.3 step 11 and 12.2: side effects happen after the primary
     * commit and can never reverse it.
     *
     * Stage 7's side effect is the durable outbox record, written inside the
     * same transaction. What Stage 9 will do with it - email, webhooks - runs
     * later and separately by construction, so the way to prove "a failing side
     * effect cannot lose a lead" here is to show the submission is durable
     * BEFORE anything downstream has run: the outbox row is still `pending`,
     * nothing has consumed it, and the contact and event are committed.
     */
    const { publicId } = await publishedWidget('sub-sideeffect');
    const response = await submit(publicId);
    expect(response.status).toBe(202);

    const event = await harness.db
      .collection(COLLECTIONS.submissionEvents)
      .findOne({}, { sort: { submittedAt: -1 } });
    const outbox = await harness.db
      .collection(COLLECTIONS.outboxEvents)
      .findOne({ idempotencyKey: `submission:${String(event?.['_id'])}` });

    expect(event).not.toBeNull();
    expect(outbox?.['status']).toBe('pending');
    expect(outbox?.['attempts']).toBe(0);

    /**
     * Simulate the delivery attempt failing permanently, exactly as Stage 9's
     * worker would record it, and confirm the lead is untouched.
     */
    await harness.db
      .collection(COLLECTIONS.outboxEvents)
      .updateOne(
        { _id: (outbox?.['_id'] as ObjectId | undefined) ?? new ObjectId() },
        { $set: { status: 'dead_letter', lastError: 'simulated provider outage', attempts: 5 } },
      );

    const eventId = event?.['_id'] as ObjectId | undefined;
    const contactId = event?.['contactId'] as ObjectId | undefined;
    expect(eventId).toBeDefined();
    expect(contactId).toBeDefined();

    const afterFailure = await harness.db
      .collection(COLLECTIONS.submissionEvents)
      .findOne({ _id: eventId ?? new ObjectId() });
    const contact = await harness.db
      .collection(COLLECTIONS.contacts)
      .findOne({ _id: contactId ?? new ObjectId() });

    expect(afterFailure).not.toBeNull();
    expect(contact).not.toBeNull();
    expect(contact?.['submissionCount']).toBe(1);
  });

  it('stores the submission even when geo enrichment throws outright', async () => {
    // A provider that throws rather than returning null is the harsher case:
    // geo is optional enrichment and must never be able to reject a lead.
    const exploding: GeoProvider = {
      name: 'exploding',
      lookup: () => Promise.reject(new Error('provider exploded')),
    };
    const isolated = await createAuthHarness({ geoProviders: [exploding] });
    try {
      const api = new TestClient(isolated.baseUrl);
      const email = uniqueEmail('sub-geo-throw');
      await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
      const message = await waitForEmail(email, (m) => m.Subject.includes('Confirm'));
      await api.post('/api/v1/auth/verify', {
        token: extractToken(await mailpitBody(message.ID)),
      });
      await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
      await api.post(
        '/api/v1/workspaces',
        { name: 'Geo throw', timezone: 'UTC' },
        await api.csrfHeaders(),
      );

      const created = await api.post(
        '/api/v1/widgets',
        { type: 'contact_form', name: 'Throwing geo' },
        await api.csrfHeaders(),
      );
      const detail = created.body as WidgetDetail;
      const draft = detail.draft;
      if (draft === null) throw new Error('expected a draft');

      const saved = await api.put(
        `/api/v1/widgets/${detail.widget.id}/draft`,
        {
          config: {
            ...draft.config,
            targeting: { ...draft.config.targeting, allowedDomains: ['shop.example.com'] },
          },
          expectedVersion: draft.version,
        },
        await api.csrfHeaders(),
      );
      await api.post(
        `/api/v1/widgets/${detail.widget.id}/publish`,
        { expectedVersion: (saved.body as { version: number }).version },
        await api.csrfHeaders(),
      );

      const response = await new TestClient(isolated.baseUrl).post(
        `/widget/v1/submit/${detail.widget.publicId}`,
        submissionBody(),
        { origin: ALLOWED_ORIGIN },
      );

      // The provider blew up; the lead survived.
      expect(response.status).toBe(202);
      const stored = await isolated.db.collection(COLLECTIONS.submissionEvents).findOne({});
      expect(stored).not.toBeNull();
      expect(stored?.['geo']).toBeNull();
    } finally {
      await isolated.teardown();
    }
  }, 180_000);
});

describe('PROBE 6: honeypot', () => {
  it('gives a bot the same generic outcome and creates no contact', async () => {
    const { publicId } = await publishedWidget('sub-honeypot');

    const good = await submit(publicId);
    const bot = await submit(
      publicId,
      submissionBody({
        values: { email: 'bot@example.invalid', message: 'buy now' },
        honeypot: 'i am a bot',
      }),
    );

    // Blueprint 7.3 step 10: the response must not reveal the classification.
    expect(bot.status).toBe(good.status);
    expect(JSON.stringify(bot.body)).toBe(JSON.stringify(good.body));

    // But nothing was stored for it.
    const contact = await harness.db
      .collection(COLLECTIONS.contacts)
      .findOne({ normalizedEmail: 'bot@example.invalid' });
    expect(contact).toBeNull();

    // Only minimal evidence, with no captured values (blueprint 7.4).
    const abuse = await harness.db
      .collection(COLLECTIONS.abuseEvents)
      .findOne({ type: 'honeypot' });
    expect(abuse).not.toBeNull();
    expect(abuse?.['ipPseudonym']).toMatch(/^[0-9a-f]{64}$/);

    const raw = JSON.stringify(abuse);
    expect(raw).not.toContain('bot@example.invalid');
    expect(raw).not.toContain('buy now');
    expect(raw).not.toContain('values');
  });

  it('discards a form submitted too fast to have been read', async () => {
    const { publicId } = await publishedWidget('sub-timing');

    const response = await submit(
      publicId,
      submissionBody({
        values: { email: 'speedy@example.invalid', message: 'instant' },
        renderedAt: serverNow() - 50,
      }),
    );
    expect(response.status).toBe(202);

    expect(
      await harness.db
        .collection(COLLECTIONS.contacts)
        .findOne({ normalizedEmail: 'speedy@example.invalid' }),
    ).toBeNull();
    expect(
      await harness.db.collection(COLLECTIONS.abuseEvents).findOne({ type: 'timing' }),
    ).not.toBeNull();
  });
});

describe('origin enforcement and CORS (blueprint 7.3 step 1)', () => {
  it('refuses an Origin that is not on the widget allowlist', async () => {
    const { publicId } = await publishedWidget('sub-origin');

    const response = await submit(publicId, submissionBody(), {
      origin: 'https://not-allowed.example.org',
    });
    expect(response.status).toBe(403);
    expect(await harness.db.collection(COLLECTIONS.contacts).countDocuments({})).toBe(0);
  });

  it('refuses a request with no Origin at all', async () => {
    const { publicId } = await publishedWidget('sub-noorigin');
    const response = await submit(publicId, submissionBody(), {});
    expect(response.status).toBe(403);
  });

  it('answers a preflight without revealing whether the widget exists', async () => {
    const { publicId } = await publishedWidget('sub-preflight');

    const real = await visitor().request('OPTIONS', `/widget/v1/submit/${publicId}`, undefined, {
      origin: ALLOWED_ORIGIN,
      'access-control-request-method': 'POST',
    });
    expect(real.status).toBe(204);
    expect(real.headers.get('access-control-allow-methods')).toContain('POST');
    expect(real.headers.get('vary')).toContain('Origin');

    // A preflight grants nothing, so an unknown widget answers identically.
    const unknown = await visitor().request(
      'OPTIONS',
      '/widget/v1/submit/w_notarealwidgetid',
      undefined,
      { origin: ALLOWED_ORIGIN, 'access-control-request-method': 'POST' },
    );
    expect(unknown.status).toBe(real.status);
  });

  it('refuses a submission to an unpublished widget', async () => {
    const { owner, publicId, widgetId } = await publishedWidget('sub-unpublished');
    await owner.api.post(
      `/api/v1/widgets/${widgetId}/unpublish`,
      undefined,
      await owner.api.csrfHeaders(),
    );

    expect((await submit(publicId)).status).toBe(404);
  });
});

describe('idempotency (blueprint 7.3 step 5)', () => {
  it('returns the original result on a retry and creates no duplicate', async () => {
    const { publicId } = await publishedWidget('sub-idempotent');
    const body = submissionBody();

    const first = await submit(publicId, body);
    const retry = await submit(publicId, body);

    expect(first.status).toBe(202);
    expect(retry.status).toBe(202);
    expect(JSON.stringify(retry.body)).toBe(JSON.stringify(first.body));

    const events = await harness.db.collection(COLLECTIONS.submissionEvents).find({}).toArray();
    expect(events).toHaveLength(1);

    const contact = await harness.db
      .collection(COLLECTIONS.contacts)
      .findOne({ normalizedEmail: 'visitor@example.invalid' });
    expect(contact?.['submissionCount']).toBe(1);

    // And no second promise of side-effect work.
    const outbox = await harness.db.collection(COLLECTIONS.outboxEvents).find({}).toArray();
    expect(outbox).toHaveLength(1);
  });
});

describe('cross-tenant isolation on the submission path (blueprint 9.1)', () => {
  it('writes every record into the widget owner workspace and no other', async () => {
    const first = await publishedWidget('sub-tenant-a');
    const second = await publishedWidget('sub-tenant-b');

    await submit(
      first.publicId,
      submissionBody({ values: { email: 'a@example.invalid', message: 'x' } }),
    );
    await harness.clearRateLimits();
    await submit(
      second.publicId,
      submissionBody({ values: { email: 'b@example.invalid', message: 'y' } }),
    );

    const widgets = await harness.db.collection(COLLECTIONS.widgets).find({}).toArray();
    const firstWorkspace = widgets.find((w) => w['publicId'] === first.publicId)?.['workspaceId'];
    const secondWorkspace = widgets.find((w) => w['publicId'] === second.publicId)?.['workspaceId'];
    expect(String(firstWorkspace)).not.toBe(String(secondWorkspace));

    for (const collection of [
      COLLECTIONS.contacts,
      COLLECTIONS.submissionEvents,
      COLLECTIONS.outboxEvents,
    ]) {
      const rows = await harness.db.collection(collection).find({}).toArray();
      // Every row carries a workspaceId, and the two tenants' rows never mix.
      for (const row of rows) expect(row['workspaceId']).toBeDefined();

      const forFirst = rows.filter((row) => String(row['workspaceId']) === String(firstWorkspace));
      const forSecond = rows.filter(
        (row) => String(row['workspaceId']) === String(secondWorkspace),
      );
      expect(forFirst.length).toBeGreaterThan(0);
      expect(forSecond.length).toBeGreaterThan(0);
      expect(forFirst.length + forSecond.length).toBe(rows.length);
    }
  });

  it('lets the same visitor email exist independently in two workspaces', async () => {
    // Contacts are unique per WORKSPACE, not globally: the same person
    // contacting two customers is two separate leads.
    const first = await publishedWidget('sub-sameemail-a');
    const second = await publishedWidget('sub-sameemail-b');

    const shared = { email: 'shared@example.invalid', message: 'hello' };
    expect((await submit(first.publicId, submissionBody({ values: shared }))).status).toBe(202);
    await harness.clearRateLimits();
    expect((await submit(second.publicId, submissionBody({ values: shared }))).status).toBe(202);

    const contacts = await harness.db
      .collection(COLLECTIONS.contacts)
      .find({ normalizedEmail: 'shared@example.invalid' })
      .toArray();
    expect(contacts).toHaveLength(2);
    expect(String(contacts[0]?.['workspaceId'])).not.toBe(String(contacts[1]?.['workspaceId']));
  });
});

describe('consent evidence (blueprint 9.2)', () => {
  it('snapshots the wording the visitor agreed to, not just a boolean', async () => {
    const { publicId } = await publishedWidget('sub-consent', (config) => ({
      ...config,
      fields: [
        ...config.fields,
        {
          type: 'consent',
          label: 'I agree to receive occasional product news',
          placeholder: '',
          helpText: '',
          required: true,
          maxLength: 1,
          order: config.fields.length,
        },
      ],
    }));

    const response = await submit(
      publicId,
      submissionBody({
        values: { email: 'consenting@example.invalid', message: 'yes please', consent: 'true' },
      }),
    );
    expect(response.status).toBe(202);

    const consent = await harness.db.collection(COLLECTIONS.consentEvents).findOne({});
    expect(consent).not.toBeNull();
    expect(consent?.['granted']).toBe(true);
    // Proving consent later means proving what they agreed TO.
    expect(consent?.['text']).toBe('I agree to receive occasional product news');
    expect(consent?.['type']).toBe('opt_in');
  });

  it('refuses a submission when a required consent box is not ticked', async () => {
    const { publicId } = await publishedWidget('sub-consent-required', (config) => ({
      ...config,
      fields: [
        ...config.fields,
        {
          type: 'consent',
          label: 'I agree',
          placeholder: '',
          helpText: '',
          required: true,
          maxLength: 1,
          order: config.fields.length,
        },
      ],
    }));

    const response = await submit(
      publicId,
      submissionBody({
        values: { email: 'no-consent@example.invalid', message: 'hi', consent: 'false' },
      }),
    );
    expect(response.status).toBe(400);
  });
});
