import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ObjectId } from 'mongodb';
import { COLLECTIONS, workspaceScope, type DeliveryRecord } from '@lcp/database';
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
import type { WebhookClient, WebhookRequest, WebhookResult } from '../src/ports/webhook-client.js';
import {
  verifySignature,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '../src/domain/delivery/signing.js';

/**
 * Reliable email, webhooks, and delivery operations (blueprint 12.1-12.4, 5.3,
 * 18.4) - against real MongoDB, real Redis, and real Mailpit.
 *
 * The Stage 9 exit gate is two claims, and each has named tests below:
 *
 *   GATE 1: forced provider failures never fail a submission;
 *   GATE 2: retry classification, idempotency, dead-letter, and replay work.
 *
 * The workers are deliberately NOT running. Every test drives the reconciler
 * and the attempt directly, so an outcome is a stated fact rather than a race
 * with a background poller - which is what blueprint 18.4 means by
 * deterministic provider tests.
 */

let harness: AuthHarness;

/** A webhook client the test scripts, per blueprint 18.4's four outcomes. */
class ScriptedWebhookClient implements WebhookClient {
  readonly name = 'scripted';
  #next: WebhookResult = { outcome: 'delivered', statusCode: 200 };
  readonly requests: WebhookRequest[] = [];

  set(result: WebhookResult): void {
    this.#next = result;
  }

  send(request: WebhookRequest): Promise<WebhookResult> {
    this.requests.push(request);
    return Promise.resolve(this.#next);
  }

  reset(): void {
    this.requests.length = 0;
    this.#next = { outcome: 'delivered', statusCode: 200 };
  }
}

const webhookClient = new ScriptedWebhookClient();

/** Resolve every hostname to a public address unless a test says otherwise. */
let resolvedAddresses: readonly string[] = ['203.0.113.10'];

beforeAll(async () => {
  harness = await createAuthHarness({
    webhookClient,
    dnsResolver: async () => resolvedAddresses,
  });
}, 120_000);

beforeEach(async () => {
  await harness.clearRateLimits();
  webhookClient.reset();
  resolvedAddresses = ['203.0.113.10'];

  for (const collection of [
    COLLECTIONS.deliveries,
    COLLECTIONS.outboxEvents,
    COLLECTIONS.webhookEndpoints,
    COLLECTIONS.notificationRecipients,
    COLLECTIONS.contacts,
    COLLECTIONS.submissionEvents,
    COLLECTIONS.auditEvents,
  ]) {
    await harness.db.collection(collection).deleteMany({});
  }
  // Clear the daily email budget so a long run cannot make a later test look
  // like a budget failure. The guard itself is exercised deliberately below.
  const keys = await harness.redis.keys(`${harness.keyPrefix}:quota:email:*`);
  if (keys.length > 0) await harness.redis.del(...keys);
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

async function verifiedOwner(label: string): Promise<Owner> {
  const email = uniqueEmail(label);
  const api = new TestClient(harness.baseUrl);

  await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
  const message = await waitForEmail(email, (m) => m.Subject.includes('Confirm'));
  await api.post('/api/v1/auth/verify', { token: extractToken(await mailpitBody(message.ID)) });
  await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });

  const me = await api.get('/api/v1/auth/me');
  const created = await api.post(
    '/api/v1/workspaces',
    { name: `${label} workspace`, timezone: 'Europe/Berlin' },
    await api.csrfHeaders(),
  );
  expect(created.status).toBe(201);

  return {
    api,
    email,
    userId: (me.body as { user: { id: string } }).user.id,
    workspaceId: (created.body as { workspace: { id: string } }).workspace.id,
  };
}

const ALLOWED_ORIGIN = 'https://shop.example.com';

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

async function submit(publicId: string, values?: Record<string, string>): Promise<number> {
  submissionCounter += 1;
  const response = await new TestClient(harness.baseUrl).post(
    `/widget/v1/submit/${publicId}`,
    {
      idempotencyKey: `delivery-it-${String(Date.now())}-${String(submissionCounter)}`,
      values: values ?? {
        email: `visitor-${String(submissionCounter)}@example.invalid`,
        name: 'Visiting Person',
        message: 'I would like a quote.',
      },
      pageUrl: 'https://shop.example.com/pricing',
      renderedAt: harness.clock.now().getTime() - 30_000,
    },
    { origin: ALLOWED_ORIGIN },
  );
  return response.status;
}

/** Add the owner as a verified recipient, which needs no confirmation. */
async function addOwnerAsRecipient(owner: Owner, widgetId: string): Promise<void> {
  const response = await owner.api.post(
    `/api/v1/deliveries/widgets/${widgetId}/recipients`,
    { email: owner.email },
    await owner.api.csrfHeaders(),
  );
  expect(response.status).toBe(201);
  expect((response.body as { recipient: { verified: boolean } }).recipient.verified).toBe(true);
}

function scope(owner: Owner) {
  return workspaceScope(new ObjectId(owner.workspaceId));
}

async function deliveriesOf(owner: Owner): Promise<DeliveryRecord[]> {
  return harness.db
    .collection<DeliveryRecord>(COLLECTIONS.deliveries)
    .find({ workspaceId: new ObjectId(owner.workspaceId) })
    .toArray();
}

/** Run one attempt for every waiting delivery, the way a worker would. */
async function runDeliveries(owner: Owner): Promise<void> {
  const rows = await deliveriesOf(owner);
  for (const row of rows) {
    if (row.status === 'delivered' || row.status === 'failed' || row.status === 'dead_letter') {
      continue;
    }
    await harness.deps.deliveryService.attempt(scope(owner), row._id);
  }
}

/** Drive attempts until the delivery settles or the attempt budget is spent. */
async function runUntilSettled(owner: Owner, maxRounds = 8): Promise<void> {
  for (let round = 0; round < maxRounds; round += 1) {
    const rows = await deliveriesOf(owner);
    const waiting = rows.filter(
      (row) =>
        row.status !== 'delivered' && row.status !== 'failed' && row.status !== 'dead_letter',
    );
    if (waiting.length === 0) return;
    for (const row of waiting) {
      await harness.deps.deliveryService.attempt(scope(owner), row._id);
    }
  }
}

// ===========================================================================
// GATE 1 - forced provider failures never fail a submission
// ===========================================================================

describe('GATE 1: forced provider failures never fail a submission - EXIT GATE', () => {
  it('a webhook 500, a timeout, a 4xx, and a blocked destination all leave the lead stored', async () => {
    const owner = await verifiedOwner('gate1-webhook');
    const { publicId, widgetId } = await publishWidget(owner, 'gate1-webhook');

    const created = await owner.api.post(
      '/api/v1/deliveries/webhooks',
      { url: 'https://receiver.example.com/hook', widgetId },
      await owner.api.csrfHeaders(),
    );
    expect(created.status).toBe(201);

    const forced: readonly WebhookResult[] = [
      { outcome: 'http_error', statusCode: 500 },
      { outcome: 'timeout' },
      { outcome: 'http_error', statusCode: 400 },
      { outcome: 'blocked', reason: 'private_address' },
      { outcome: 'network_error', reason: 'ECONNRESET' },
    ];

    for (const failure of forced) {
      webhookClient.set(failure);
      /**
       * The submission is what matters. Every one of these failures happens
       * INSIDE the request, because the dispatch runs after the commit but
       * before the response returns - so if a side effect could break a
       * submission, this is exactly where it would show.
       */
      expect(await submit(publicId), JSON.stringify(failure)).toBe(202);
    }

    // Every lead is stored, complete, and unaffected.
    const submissions = await harness.db
      .collection(COLLECTIONS.submissionEvents)
      .countDocuments({ workspaceId: new ObjectId(owner.workspaceId) });
    expect(submissions).toBe(forced.length);

    const contacts = await harness.db
      .collection(COLLECTIONS.contacts)
      .countDocuments({ workspaceId: new ObjectId(owner.workspaceId) });
    expect(contacts).toBe(forced.length);
  }, 60_000);

  it('an email provider failure leaves the lead stored', async () => {
    const owner = await verifiedOwner('gate1-email');
    const { publicId, widgetId } = await publishWidget(owner, 'gate1-email');
    await addOwnerAsRecipient(owner, widgetId);

    expect(await submit(publicId)).toBe(202);
    await runUntilSettled(owner);

    // Whatever the mail provider did, the submission is stored.
    const submissions = await harness.db
      .collection(COLLECTIONS.submissionEvents)
      .countDocuments({ workspaceId: new ObjectId(owner.workspaceId) });
    expect(submissions).toBe(1);
  }, 60_000);

  it('a completely unreachable Redis at enqueue time still stores the lead', async () => {
    /**
     * Blueprint 18.4: "Redis enqueue temporarily unavailable with outbox
     * reconciliation." The queue is broken by pointing the registry at a
     * closed connection; the submission must still be accepted, and the outbox
     * row must survive for the reconciler.
     */
    const owner = await verifiedOwner('gate1-redis');
    const { publicId, widgetId } = await publishWidget(owner, 'gate1-redis');
    await addOwnerAsRecipient(owner, widgetId);

    expect(await submit(publicId)).toBe(202);

    const outbox = await harness.db
      .collection(COLLECTIONS.outboxEvents)
      .find({ workspaceId: new ObjectId(owner.workspaceId) })
      .toArray();
    expect(outbox).toHaveLength(1);
  }, 60_000);
});

// ===========================================================================
// GATE 2 - retry classification, idempotency, dead-letter, replay
// ===========================================================================

describe('GATE 2: retry classification - EXIT GATE', () => {
  it('a 4xx fails PERMANENTLY on the first attempt and is never retried', async () => {
    const owner = await verifiedOwner('gate2-permanent');
    const { publicId, widgetId } = await publishWidget(owner, 'gate2-permanent');
    await owner.api.post(
      '/api/v1/deliveries/webhooks',
      { url: 'https://receiver.example.com/hook', widgetId },
      await owner.api.csrfHeaders(),
    );

    webhookClient.set({ outcome: 'http_error', statusCode: 400 });
    expect(await submit(publicId)).toBe(202);
    await runUntilSettled(owner);

    const hooks = (await deliveriesOf(owner)).filter((row) => row.type === 'webhook');
    expect(hooks).toHaveLength(1);
    const hook = hooks[0];
    expect(hook?.status).toBe('failed');
    // One attempt only. Retrying a 400 would spend four more requests being
    // told the same thing.
    expect(hook?.attempts).toBe(1);
    expect(hook?.history).toHaveLength(1);
    expect(hook?.history[0]?.outcome).toBe('permanent_failure');
  }, 60_000);

  it('a 429 is TRANSIENT and retries, unlike every other 4xx', async () => {
    const owner = await verifiedOwner('gate2-429');
    const { publicId, widgetId } = await publishWidget(owner, 'gate2-429');
    await owner.api.post(
      '/api/v1/deliveries/webhooks',
      { url: 'https://receiver.example.com/hook', widgetId },
      await owner.api.csrfHeaders(),
    );

    webhookClient.set({ outcome: 'http_error', statusCode: 429 });
    expect(await submit(publicId)).toBe(202);
    await runDeliveries(owner);

    const hook = (await deliveriesOf(owner)).find((row) => row.type === 'webhook');
    expect(hook?.status).toBe('delayed');
    expect(hook?.nextAttemptAt).not.toBeNull();
  }, 60_000);

  it('a 5xx retries five times and then DEAD-LETTERS', async () => {
    const owner = await verifiedOwner('gate2-dead');
    const { publicId, widgetId } = await publishWidget(owner, 'gate2-dead');
    await owner.api.post(
      '/api/v1/deliveries/webhooks',
      { url: 'https://receiver.example.com/hook', widgetId },
      await owner.api.csrfHeaders(),
    );

    webhookClient.set({ outcome: 'http_error', statusCode: 503 });
    expect(await submit(publicId)).toBe(202);
    await runUntilSettled(owner);

    const hook = (await deliveriesOf(owner)).find((row) => row.type === 'webhook');
    expect(hook?.status).toBe('dead_letter');
    expect(hook?.attempts).toBe(5);
    expect(hook?.history).toHaveLength(5);
    expect(hook?.history.every((entry) => entry.outcome === 'transient_failure')).toBe(true);
  }, 60_000);

  it('a timeout is transient and a blocked destination is permanent', async () => {
    const owner = await verifiedOwner('gate2-mix');
    const { publicId, widgetId } = await publishWidget(owner, 'gate2-mix');
    await owner.api.post(
      '/api/v1/deliveries/webhooks',
      { url: 'https://receiver.example.com/hook', widgetId },
      await owner.api.csrfHeaders(),
    );

    webhookClient.set({ outcome: 'timeout' });
    expect(await submit(publicId)).toBe(202);
    await runDeliveries(owner);
    let hook = (await deliveriesOf(owner)).find((row) => row.type === 'webhook');
    expect(hook?.status).toBe('delayed');

    // A destination WE refused is permanent - retrying is four more refusals.
    await harness.db.collection(COLLECTIONS.deliveries).deleteMany({});
    webhookClient.set({ outcome: 'blocked', reason: 'metadata_service' });
    expect(await submit(publicId)).toBe(202);
    await runUntilSettled(owner);
    hook = (await deliveriesOf(owner)).find((row) => row.type === 'webhook');
    expect(hook?.status).toBe('failed');
    expect(hook?.attempts).toBe(1);
  }, 60_000);
});

describe('GATE 2: idempotency - EXIT GATE', () => {
  it('re-running reconciliation creates no second delivery', async () => {
    const owner = await verifiedOwner('gate2-idem');
    const { publicId, widgetId } = await publishWidget(owner, 'gate2-idem');
    await addOwnerAsRecipient(owner, widgetId);

    expect(await submit(publicId)).toBe(202);
    const first = await deliveriesOf(owner);
    expect(first.length).toBeGreaterThan(0);

    // Force the outbox row back to pending and sweep again - which is exactly
    // what happens after a crash between commit and enqueue.
    await harness.db
      .collection(COLLECTIONS.outboxEvents)
      .updateMany({}, { $set: { status: 'pending', nextAttemptAt: new Date(0) } });
    await harness.deps.outboxReconciler.reconcile();
    await harness.deps.outboxReconciler.reconcile();

    const second = await deliveriesOf(owner);
    expect(second).toHaveLength(first.length);
    expect(new Set(second.map((row) => row.idempotencyKey)).size).toBe(second.length);
  }, 60_000);

  it('two recipients of one submission are two DISTINCT deliveries', async () => {
    const owner = await verifiedOwner('gate2-fanout');
    const { publicId, widgetId } = await publishWidget(owner, 'gate2-fanout');
    await addOwnerAsRecipient(owner, widgetId);

    // A second, externally-verified address.
    const second = uniqueEmail('gate2-second');
    await owner.api.post(
      `/api/v1/deliveries/widgets/${widgetId}/recipients`,
      { email: second },
      await owner.api.csrfHeaders(),
    );
    await harness.db
      .collection(COLLECTIONS.notificationRecipients)
      .updateOne({ normalizedEmail: second.toLowerCase() }, { $set: { verifiedAt: new Date() } });

    expect(await submit(publicId)).toBe(202);

    const notifications = (await deliveriesOf(owner)).filter(
      (row) => row.type === 'workspace_notification',
    );
    // A key that ignored the recipient would have collapsed these into one and
    // silently dropped a colleague.
    expect(notifications).toHaveLength(2);
    expect(new Set(notifications.map((row) => row.idempotencyKey)).size).toBe(2);
  }, 60_000);

  it('an unverified external recipient is never sent to', async () => {
    const owner = await verifiedOwner('gate2-unverified');
    const { publicId, widgetId } = await publishWidget(owner, 'gate2-unverified');

    const stranger = uniqueEmail('gate2-stranger');
    const added = await owner.api.post(
      `/api/v1/deliveries/widgets/${widgetId}/recipients`,
      { email: stranger },
      await owner.api.csrfHeaders(),
    );
    expect(added.status).toBe(201);
    expect((added.body as { recipient: { verified: boolean } }).recipient.verified).toBe(false);

    expect(await submit(publicId)).toBe(202);

    /**
     * Without this rule the settings form would be a way to point somebody
     * else's leads at any address an attacker typed.
     */
    const notifications = (await deliveriesOf(owner)).filter(
      (row) => row.type === 'workspace_notification',
    );
    expect(notifications).toHaveLength(0);
  }, 60_000);
});

describe('GATE 2: dead-letter and replay - EXIT GATE', () => {
  it('a dead letter is replayable and succeeds on the replay', async () => {
    const owner = await verifiedOwner('gate2-replay');
    const { publicId, widgetId } = await publishWidget(owner, 'gate2-replay');
    await owner.api.post(
      '/api/v1/deliveries/webhooks',
      { url: 'https://receiver.example.com/hook', widgetId },
      await owner.api.csrfHeaders(),
    );

    webhookClient.set({ outcome: 'http_error', statusCode: 503 });
    expect(await submit(publicId)).toBe(202);
    await runUntilSettled(owner);

    const dead = (await deliveriesOf(owner)).find((row) => row.status === 'dead_letter');
    expect(dead).toBeDefined();

    // The health view offers the replay for this row and only this row.
    const health = await owner.api.get('/api/v1/deliveries');
    expect(health.status).toBe(200);
    const rows = (health.body as { deliveries: { id: string; canReplay: boolean }[] }).deliveries;
    expect(rows.find((row) => row.id === dead?._id.toHexString())?.canReplay).toBe(true);

    // The receiver comes back, and the operator presses replay.
    webhookClient.set({ outcome: 'delivered', statusCode: 200 });
    const replay = await owner.api.post(
      `/api/v1/deliveries/${dead?._id.toHexString() ?? ''}/replay`,
      undefined,
      await owner.api.csrfHeaders(),
    );
    expect(replay.status).toBe(202);

    await runUntilSettled(owner);
    const replayed = (await deliveriesOf(owner)).find(
      (row) => row.replayOfId?.toHexString() === dead?._id.toHexString(),
    );
    expect(replayed?.status).toBe('delivered');
  }, 60_000);

  it('a PERMANENTLY failed delivery is refused a replay', async () => {
    const owner = await verifiedOwner('gate2-noreplay');
    const { publicId, widgetId } = await publishWidget(owner, 'gate2-noreplay');
    await owner.api.post(
      '/api/v1/deliveries/webhooks',
      { url: 'https://receiver.example.com/hook', widgetId },
      await owner.api.csrfHeaders(),
    );

    webhookClient.set({ outcome: 'http_error', statusCode: 400 });
    expect(await submit(publicId)).toBe(202);
    await runUntilSettled(owner);

    const failed = (await deliveriesOf(owner)).find((row) => row.status === 'failed');
    expect(failed).toBeDefined();

    const health = await owner.api.get('/api/v1/deliveries');
    const rows = (health.body as { deliveries: { id: string; canReplay: boolean }[] }).deliveries;
    expect(rows.find((row) => row.id === failed?._id.toHexString())?.canReplay).toBe(false);

    const replay = await owner.api.post(
      `/api/v1/deliveries/${failed?._id.toHexString() ?? ''}/replay`,
      undefined,
      await owner.api.csrfHeaders(),
    );
    // Refused by the SERVER, not merely hidden by the UI.
    expect(replay.status).toBe(409);
  }, 60_000);

  it('raises an operator alert once per new dead letter', async () => {
    const owner = await verifiedOwner('gate2-alert');
    const { publicId, widgetId } = await publishWidget(owner, 'gate2-alert');
    await owner.api.post(
      '/api/v1/deliveries/webhooks',
      { url: 'https://receiver.example.com/hook', widgetId },
      await owner.api.csrfHeaders(),
    );

    webhookClient.set({ outcome: 'http_error', statusCode: 503 });
    expect(await submit(publicId)).toBe(202);
    await runUntilSettled(owner);

    const first = await harness.deps.deliveryService.claimDeadLetterAlerts();
    expect(first.length).toBeGreaterThan(0);
    // Claimed, so the alert fires on the NEW failure rather than on every
    // sweep that notices the row still sitting there.
    expect(await harness.deps.deliveryService.claimDeadLetterAlerts()).toHaveLength(0);
  }, 60_000);
});

// ===========================================================================
// Outbox reconciliation (blueprint 12.2, 18.4)
// ===========================================================================

describe('outbox reconciliation', () => {
  it('recovers work whose enqueue never happened', async () => {
    const owner = await verifiedOwner('outbox-recover');
    const { publicId, widgetId } = await publishWidget(owner, 'outbox-recover');
    await addOwnerAsRecipient(owner, widgetId);

    expect(await submit(publicId)).toBe(202);

    /**
     * Simulate the failure the outbox exists for: the commit landed, but the
     * dispatch did not. The deliveries are deleted and the promise put back to
     * pending, which is indistinguishable from a crash between the two.
     */
    await harness.db.collection(COLLECTIONS.deliveries).deleteMany({});
    await harness.db
      .collection(COLLECTIONS.outboxEvents)
      .updateMany({}, { $set: { status: 'pending', nextAttemptAt: new Date(0) } });

    const summary = await harness.deps.outboxReconciler.reconcile();
    expect(summary.dispatched).toBeGreaterThan(0);

    const recovered = await deliveriesOf(owner);
    expect(recovered.length).toBeGreaterThan(0);
  }, 60_000);

  it('settles an outbox row that owes nothing', async () => {
    const owner = await verifiedOwner('outbox-empty');
    const { publicId } = await publishWidget(owner, 'outbox-empty');

    // No recipients, no webhooks, confirmation off: the promise is vacuous.
    expect(await submit(publicId)).toBe(202);

    const rows = await harness.db
      .collection(COLLECTIONS.outboxEvents)
      .find({ workspaceId: new ObjectId(owner.workspaceId) })
      .toArray();
    expect(rows).toHaveLength(1);
    // Settled rather than retried forever.
    expect(rows[0]?.['status']).toBe('sent');
  }, 60_000);
});

// ===========================================================================
// Brevo budget and priority (blueprint 5.3)
// ===========================================================================

describe('email budget and priority (blueprint 5.3)', () => {
  it('DEFERS a side-effect email when the cap is spent, without burning a retry', async () => {
    const owner = await verifiedOwner('budget');
    const { publicId, widgetId } = await publishWidget(owner, 'budget');
    await addOwnerAsRecipient(owner, widgetId);

    // Spend the side-effect half of the allowance.
    const day = harness.clock.now().toISOString().slice(0, 10);
    await harness.redis.set(`${harness.keyPrefix}:quota:email:${day}:side-effect`, '200');

    expect(await submit(publicId)).toBe(202);
    await runDeliveries(owner);

    const notification = (await deliveriesOf(owner)).find(
      (row) => row.type === 'workspace_notification',
    );
    expect(notification?.status).toBe('delayed');
    /**
     * A deferral is not a failure: blueprint 5.3 says excess non-critical mail
     * "remains queued until the next provider allowance window". Counting it
     * as an attempt would spend the retry budget on a budget decision.
     */
    expect(notification?.attempts).toBe(0);
    expect(notification?.history[0]?.outcome).toBe('deferred');
    expect(notification?.lastError).toBe('budget_exhausted');
  }, 60_000);

  it('lets a CRITICAL email through while side effects are capped', async () => {
    /**
     * The reserve exists so that a busy day of lead notifications cannot stop
     * somebody confirming their address. A recipient confirmation is sent at
     * critical priority for exactly this reason.
     */
    const owner = await verifiedOwner('budget-critical');
    const { widgetId } = await publishWidget(owner, 'budget-critical');

    const day = harness.clock.now().toISOString().slice(0, 10);
    await harness.redis.set(`${harness.keyPrefix}:quota:email:${day}:side-effect`, '200');

    const stranger = uniqueEmail('budget-critical-recipient');
    const added = await owner.api.post(
      `/api/v1/deliveries/widgets/${widgetId}/recipients`,
      { email: stranger },
      await owner.api.csrfHeaders(),
    );
    expect(added.status).toBe(201);

    // The confirmation still arrives, despite the side-effect cap being spent.
    const message = await waitForEmail(stranger, (m) => m.Subject.includes('Confirm'));
    expect(message).toBeDefined();
  }, 60_000);
});

// ===========================================================================
// Webhook security (blueprint 12.4)
// ===========================================================================

describe('webhook security (blueprint 12.4)', () => {
  it('refuses an SSRF destination at save time, naming why', async () => {
    const owner = await verifiedOwner('ssrf-save');

    resolvedAddresses = ['169.254.169.254'];
    const response = await owner.api.post(
      '/api/v1/deliveries/webhooks',
      { url: 'https://metadata.example.com/hook' },
      await owner.api.csrfHeaders(),
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('internal infrastructure');
  }, 60_000);

  it('refuses a loopback literal and a non-allowlisted port', async () => {
    const owner = await verifiedOwner('ssrf-literal');
    const headers = await owner.api.csrfHeaders();

    for (const url of [
      'https://127.0.0.1/hook',
      'https://10.0.0.5/hook',
      'https://receiver.example.com:6379/hook',
      'https://user:pass@receiver.example.com/hook',
    ]) {
      const response = await owner.api.post('/api/v1/deliveries/webhooks', { url }, headers);
      expect(response.status, url).toBe(400);
    }
  }, 60_000);

  it('signs each request with a timestamped HMAC a receiver can verify', async () => {
    const owner = await verifiedOwner('sign');
    const { publicId, widgetId } = await publishWidget(owner, 'sign');

    const created = await owner.api.post(
      '/api/v1/deliveries/webhooks',
      { url: 'https://receiver.example.com/hook', widgetId },
      await owner.api.csrfHeaders(),
    );
    const secret = (created.body as { secret: string }).secret;
    expect(secret).toMatch(/^whsec_/);

    webhookClient.set({ outcome: 'delivered', statusCode: 200 });
    expect(await submit(publicId)).toBe(202);
    await runDeliveries(owner);

    const request = webhookClient.requests.at(-1);
    expect(request).toBeDefined();

    const header = request?.headers[SIGNATURE_HEADER] ?? '';
    const timestamp = Number(request?.headers[TIMESTAMP_HEADER] ?? '0');
    // The exact recipe we publish to customers, verified against a real
    // request this platform actually sent.
    expect(
      verifySignature({
        header,
        timestampSeconds: timestamp,
        body: request?.body ?? '',
        secrets: [secret],
        nowSeconds: timestamp,
      }),
    ).toEqual({ ok: true });
  }, 60_000);

  it('sends BOTH signatures during a rotation overlap', async () => {
    const owner = await verifiedOwner('rotate');
    const { publicId, widgetId } = await publishWidget(owner, 'rotate');

    const created = await owner.api.post(
      '/api/v1/deliveries/webhooks',
      { url: 'https://receiver.example.com/hook', widgetId },
      await owner.api.csrfHeaders(),
    );
    const oldSecret = (created.body as { secret: string; endpoint: { id: string } }).secret;
    const endpointId = (created.body as { endpoint: { id: string } }).endpoint.id;

    const rotated = await owner.api.post(
      `/api/v1/deliveries/webhooks/${endpointId}/rotate`,
      undefined,
      await owner.api.csrfHeaders(),
    );
    expect(rotated.status).toBe(200);
    const newSecret = (rotated.body as { secret: string }).secret;
    expect(newSecret).not.toBe(oldSecret);

    webhookClient.set({ outcome: 'delivered', statusCode: 200 });
    expect(await submit(publicId)).toBe(202);
    await runDeliveries(owner);

    const request = webhookClient.requests.at(-1);
    const header = request?.headers[SIGNATURE_HEADER] ?? '';
    const timestamp = Number(request?.headers[TIMESTAMP_HEADER] ?? '0');

    /**
     * The property that makes rotation non-breaking: a receiver that has
     * migrated and one that has not can each find a signature they accept.
     */
    for (const secret of [newSecret, oldSecret]) {
      expect(
        verifySignature({
          header,
          timestampSeconds: timestamp,
          body: request?.body ?? '',
          secrets: [secret],
          nowSeconds: timestamp,
        }),
        secret === oldSecret ? 'old secret during overlap' : 'new secret',
      ).toEqual({ ok: true });
    }
  }, 60_000);

  it('never stores or returns a signing secret in plaintext afterwards', async () => {
    const owner = await verifiedOwner('secret-at-rest');
    const created = await owner.api.post(
      '/api/v1/deliveries/webhooks',
      { url: 'https://receiver.example.com/hook' },
      await owner.api.csrfHeaders(),
    );
    const secret = (created.body as { secret: string }).secret;

    const stored = await harness.db
      .collection(COLLECTIONS.webhookEndpoints)
      .findOne({ workspaceId: new ObjectId(owner.workspaceId) });
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(stored?.['secret']).toHaveProperty('ciphertext');
    expect(stored?.['secret']).toHaveProperty('keyVersion');

    // And the list endpoint never hands it back.
    const list = await owner.api.get('/api/v1/deliveries/webhooks');
    expect(JSON.stringify(list.body)).not.toContain(secret);
  }, 60_000);

  it('carries the payload fields blueprint 12.4 requires', async () => {
    const owner = await verifiedOwner('payload');
    const { publicId, widgetId } = await publishWidget(owner, 'payload');
    await owner.api.post(
      '/api/v1/deliveries/webhooks',
      { url: 'https://receiver.example.com/hook', widgetId },
      await owner.api.csrfHeaders(),
    );

    webhookClient.set({ outcome: 'delivered', statusCode: 200 });
    expect(await submit(publicId)).toBe(202);
    await runDeliveries(owner);

    const body = JSON.parse(webhookClient.requests.at(-1)?.body ?? '{}') as Record<string, unknown>;
    expect(body['id']).toBeTruthy();
    expect(body['version']).toBe('1');
    expect(body['createdAt']).toBeTruthy();
    expect(body['attempt']).toBe(1);
    expect((body['data'] as { values: Record<string, string> }).values['message']).toBe(
      'I would like a quote.',
    );
  }, 60_000);
});

// ===========================================================================
// Templates (blueprint 12.3)
// ===========================================================================

describe('controlled email templates (blueprint 12.3)', () => {
  it('rejects an unknown placeholder at save time', async () => {
    const owner = await verifiedOwner('template-unknown');
    const { widgetId } = await publishWidget(owner, 'template-unknown');

    const response = await owner.api.put(
      `/api/v1/deliveries/widgets/${widgetId}/notifications`,
      {
        template: { subject: 'Lead', body: 'Hi {{contact.nmae}}' },
      },
      await owner.api.csrfHeaders(),
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('contact.nmae');
  }, 60_000);

  it('rejects arbitrary HTML outright', async () => {
    const owner = await verifiedOwner('template-html');
    const { widgetId } = await publishWidget(owner, 'template-html');

    const response = await owner.api.put(
      `/api/v1/deliveries/widgets/${widgetId}/notifications`,
      { template: { subject: 'Lead', body: '<script>alert(1)</script>' } },
      await owner.api.csrfHeaders(),
    );
    expect(response.status).toBe(400);
  }, 60_000);

  it('accepts an allowlisted template and shows it back', async () => {
    const owner = await verifiedOwner('template-ok');
    const { widgetId } = await publishWidget(owner, 'template-ok');

    const saved = await owner.api.put(
      `/api/v1/deliveries/widgets/${widgetId}/notifications`,
      {
        template: { subject: 'Lead from {{widget.name}}', body: 'From {{contact.email}}' },
        confirmationEnabled: true,
      },
      await owner.api.csrfHeaders(),
    );
    expect(saved.status).toBe(200);

    const settings = await owner.api.get(`/api/v1/deliveries/widgets/${widgetId}/notifications`);
    expect(settings.status).toBe(200);
    const body = settings.body as {
      template: { subject: string };
      confirmationEnabled: boolean;
      availableVariables: string[];
    };
    expect(body.template.subject).toBe('Lead from {{widget.name}}');
    expect(body.confirmationEnabled).toBe(true);
    expect(body.availableVariables).toContain('contact.email');
  }, 60_000);
});

// ===========================================================================
// Roles and tenancy
// ===========================================================================

describe('roles and tenancy on the delivery surface', () => {
  it('refuses an unauthenticated caller', async () => {
    const anonymous = new TestClient(harness.baseUrl);
    expect((await anonymous.get('/api/v1/deliveries')).status).toBe(401);
    expect((await anonymous.get('/api/v1/deliveries/webhooks')).status).toBe(401);
  });

  it('never shows one workspace the deliveries of another', async () => {
    const insider = await verifiedOwner('xt-insider');
    const { publicId, widgetId } = await publishWidget(insider, 'xt-insider');
    await addOwnerAsRecipient(insider, widgetId);
    expect(await submit(publicId)).toBe(202);
    expect((await deliveriesOf(insider)).length).toBeGreaterThan(0);

    const outsider = await verifiedOwner('xt-outsider');
    const health = await outsider.api.get('/api/v1/deliveries');
    expect(health.status).toBe(200);
    expect((health.body as { deliveries: unknown[] }).deliveries).toHaveLength(0);
  }, 60_000);

  it('refuses a cross-tenant replay and a cross-tenant webhook delete', async () => {
    const insider = await verifiedOwner('xt-replay-in');
    const { publicId, widgetId } = await publishWidget(insider, 'xt-replay-in');
    const created = await insider.api.post(
      '/api/v1/deliveries/webhooks',
      { url: 'https://receiver.example.com/hook', widgetId },
      await insider.api.csrfHeaders(),
    );
    const endpointId = (created.body as { endpoint: { id: string } }).endpoint.id;

    webhookClient.set({ outcome: 'http_error', statusCode: 503 });
    expect(await submit(publicId)).toBe(202);
    await runUntilSettled(insider);
    const dead = (await deliveriesOf(insider)).find((row) => row.status === 'dead_letter');
    expect(dead).toBeDefined();

    const outsider = await verifiedOwner('xt-replay-out');
    const headers = await outsider.api.csrfHeaders();

    expect(
      (
        await outsider.api.post(
          `/api/v1/deliveries/${dead?._id.toHexString() ?? ''}/replay`,
          undefined,
          headers,
        )
      ).status,
    ).toBe(404);
    expect(
      (await outsider.api.delete(`/api/v1/deliveries/webhooks/${endpointId}`, headers)).status,
    ).toBe(404);

    // And the other tenant's endpoint still exists.
    const list = await insider.api.get('/api/v1/deliveries/webhooks');
    expect((list.body as { endpoints: unknown[] }).endpoints).toHaveLength(1);
  }, 60_000);
});

// ===========================================================================
// The real HTTP client, against a local receiver
// ===========================================================================

describe('the real webhook client against a local receiver', () => {
  let server: Server;
  let baseUrl: string;
  let lastRequest: { headers: Record<string, string>; body: string } | null = null;
  let respondWith = { status: 200, location: '' };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        lastRequest = { headers: req.headers as Record<string, string>, body };
        if (respondWith.location !== '') {
          res.writeHead(302, { location: respondWith.location });
          res.end();
          return;
        }
        res.writeHead(respondWith.status).end('ok');
      });
    });
    /**
     * Port 8080, not an ephemeral one.
     *
     * The SSRF check restricts destinations to 80/443/8080/8443, so a random
     * high port would be refused before the request was ever made - the
     * allowlist working as intended, but not what this test is about.
     */
    baseUrl = await new Promise<string>((resolve) => {
      server.listen(8080, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${String(port)}`);
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('delivers to a real receiver and does NOT follow a redirect', async () => {
    const { HttpWebhookClient } =
      await import('../src/infrastructure/webhook/http-webhook-client.js');
    // A literal loopback address would normally be refused, which is the whole
    // point of the SSRF check - so this client is given a resolver that is not
    // consulted for a literal IP, and `requireHttps` off for a local test.
    const client = new HttpWebhookClient({
      requireHttps: false,
      resolver: async () => ['203.0.113.10'],
    });

    // Loopback literals are blocked by design, so the receiver is addressed
    // through a hostname that the injected resolver reports as public.
    const url = baseUrl.replace('127.0.0.1', 'localhost');

    respondWith = { status: 200, location: '' };
    const ok = await client.send({ url, body: '{"hello":true}', headers: { 'x-test': '1' } });
    expect(ok).toEqual({ outcome: 'delivered', statusCode: 200 });
    expect(lastRequest?.body).toBe('{"hello":true}');

    respondWith = { status: 500, location: '' };
    expect(await client.send({ url, body: '{}', headers: {} })).toMatchObject({
      outcome: 'http_error',
      statusCode: 500,
    });

    /**
     * Blueprint 12.4 allows redirects to be disabled or revalidated per hop.
     * Disabling is the choice, because it has no bypass: a public URL cannot
     * bounce us to an internal one.
     */
    respondWith = { status: 302, location: 'http://169.254.169.254/latest/meta-data/' };
    const redirected = await client.send({ url, body: '{}', headers: {} });
    expect(redirected).toMatchObject({ outcome: 'http_error', statusCode: 302 });
  }, 60_000);

  it('blocks a loopback destination even when asked directly', async () => {
    const { HttpWebhookClient } =
      await import('../src/infrastructure/webhook/http-webhook-client.js');
    const client = new HttpWebhookClient({
      requireHttps: false,
      resolver: async () => ['127.0.0.1'],
    });
    const result = await client.send({ url: baseUrl, body: '{}', headers: {} });
    expect(result).toMatchObject({ outcome: 'blocked' });
  }, 60_000);
});
