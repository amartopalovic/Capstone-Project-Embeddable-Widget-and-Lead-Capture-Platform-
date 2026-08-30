import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import {
  COLLECTIONS,
  type ContactRecord,
  type WidgetRecord,
  type WorkspaceRecord,
} from '@lcp/database';
import { DEMO_MAX_BODY_BYTES, DEMO_RATE_RULES } from '../src/domain/demo/limits.js';
import { SUBMISSION_RATE_RULES } from '../src/infrastructure/redis/rate-limiter.js';
import { TestClient, createAuthHarness, type AuthHarness } from './helpers/auth-harness.js';

/**
 * The public sandbox (blueprint 14.3), against real MongoDB and Redis.
 *
 * The browser suite proves a visitor can use it. This proves the things a
 * browser cannot observe: that the hourly reset actually clears and reseeds,
 * that it cannot touch another tenant, and that the sandbox's limits really are
 * stricter than production's rather than merely being called so.
 */

let harness: AuthHarness;

beforeAll(async () => {
  harness = await createAuthHarness();
}, 120_000);

afterAll(async () => {
  await harness?.teardown();
});

/**
 * The sandbox workspace, or a failure.
 *
 * Throws rather than returning null so every call site can use the id directly.
 * A test that quietly queried `workspaceId: undefined` would match every
 * document in the collection and pass for the wrong reason - which is exactly
 * the mistake worth making impossible in a file about tenant isolation.
 */
async function demoWorkspace(): Promise<WorkspaceRecord & { _id: ObjectId }> {
  const found = await harness.db
    .collection<WorkspaceRecord>(COLLECTIONS.workspaces)
    .findOne({ isDemo: true });
  if (found === null) throw new Error('the sandbox workspace does not exist');
  return found;
}

describe('the sandbox seeds itself (blueprint 14.3)', () => {
  it('creates one workspace with all three widget types, published', async () => {
    await harness.deps.demoService.reset();

    const workspace = await demoWorkspace();
    expect(workspace.isDemo).toBe(true);

    const widgets = await harness.db
      .collection<WidgetRecord>(COLLECTIONS.widgets)
      .find({ workspaceId: workspace._id })
      .toArray();

    expect(widgets.map((widget) => widget.type).sort()).toEqual([
      'contact_form',
      'cta_popover',
      'email_signup',
    ]);
    // Published, or a visitor would see three empty boxes.
    for (const widget of widgets) expect(widget.publishedRevisionId).not.toBeNull();
  }, 90_000);

  it('belongs to nobody, so nothing in it can appear in a dashboard', async () => {
    /**
     * The structural half of "demo data never enters a user's workspace". The
     * sandbox has no membership rows, so there is no account for which it is
     * listed, no session that can switch into it, and no route by which its
     * contents could be read through the dashboard - all of which follow from
     * ordinary tenancy rather than from a special case.
     */
    const workspace = await demoWorkspace();
    const memberships = await harness.db
      .collection(COLLECTIONS.memberships)
      .countDocuments({ workspaceId: workspace._id });
    expect(memberships).toBe(0);
  }, 60_000);
});

describe('the hourly reset (blueprint 12.1, 14.3)', () => {
  it('clears everything the sandbox accumulated, and reseeds it', async () => {
    await harness.deps.demoService.reset();
    const before = await demoWorkspace();

    // Something accumulates, exactly as a visitor's submission would.
    await harness.db.collection(COLLECTIONS.contacts).insertOne({
      _id: new ObjectId(),
      workspaceId: before._id,
      email: 'sandbox-visitor@example.invalid',
      normalizedEmail: 'sandbox-visitor@example.invalid',
    } as never);
    expect(
      await harness.db.collection(COLLECTIONS.contacts).countDocuments({ workspaceId: before._id }),
    ).toBe(1);

    const oldWidgetIds = (
      await harness.db
        .collection<WidgetRecord>(COLLECTIONS.widgets)
        .find({ workspaceId: before._id })
        .toArray()
    ).map((widget) => widget.publicId);

    await harness.deps.demoService.reset();

    const after = await demoWorkspace();
    // The same workspace, so its identity survives; its contents do not.
    expect(after._id.toHexString()).toBe(before._id.toHexString());
    expect(
      await harness.db.collection(COLLECTIONS.contacts).countDocuments({ workspaceId: after._id }),
    ).toBe(0);

    /**
     * And the widgets are new ones. Stable public ids across resets would be
     * ids somebody could hard-code into a script and keep pointing at.
     */
    const newWidgetIds = (
      await harness.db
        .collection<WidgetRecord>(COLLECTIONS.widgets)
        .find({ workspaceId: after._id })
        .toArray()
    ).map((widget) => widget.publicId);
    expect(newWidgetIds).toHaveLength(3);
    for (const id of newWidgetIds) expect(oldWidgetIds).not.toContain(id);
  }, 120_000);

  it('never touches another workspace - EXIT GATE', async () => {
    /**
     * The claim that matters most about a job whose whole purpose is deleting
     * a tenant's data. A real workspace with real contents sits beside the
     * sandbox across a reset and comes out untouched, because every delete the
     * reset performs is filtered by the sandbox's own workspace id.
     */
    const realWorkspaceId = new ObjectId();
    await harness.db.collection(COLLECTIONS.workspaces).insertOne({
      _id: realWorkspaceId,
      name: 'A real customer',
      isDemo: false,
      status: 'active',
    } as never);

    const realContactId = new ObjectId();
    await harness.db.collection<ContactRecord>(COLLECTIONS.contacts).insertOne({
      _id: realContactId,
      workspaceId: realWorkspaceId,
      email: 'real-lead@example.invalid',
      normalizedEmail: 'real-lead@example.invalid',
    } as never);
    await harness.db.collection(COLLECTIONS.widgets).insertOne({
      _id: new ObjectId(),
      workspaceId: realWorkspaceId,
      publicId: 'w_realrealrealreal',
      type: 'contact_form',
    } as never);

    await harness.deps.demoService.reset();
    await harness.deps.demoService.reset();

    expect(
      await harness.db
        .collection(COLLECTIONS.contacts)
        .countDocuments({ workspaceId: realWorkspaceId }),
    ).toBe(1);
    expect(
      await harness.db
        .collection(COLLECTIONS.widgets)
        .countDocuments({ workspaceId: realWorkspaceId }),
    ).toBe(1);
    expect(
      await harness.db.collection(COLLECTIONS.workspaces).findOne({ _id: realWorkspaceId }),
    ).not.toBeNull();

    await harness.db.collection(COLLECTIONS.contacts).deleteOne({ _id: realContactId });
    await harness.db.collection(COLLECTIONS.workspaces).deleteOne({ _id: realWorkspaceId });
  }, 120_000);

  it('is idempotent, so a retried job does not double-seed', async () => {
    await harness.deps.demoService.reset();
    await harness.deps.demoService.reset();
    await harness.deps.demoService.reset();

    const workspace = await demoWorkspace();
    expect(
      await harness.db
        .collection(COLLECTIONS.widgets)
        .countDocuments({ workspaceId: workspace._id }),
    ).toBe(3);
    expect(
      await harness.db.collection(COLLECTIONS.workspaces).countDocuments({ isDemo: true }),
    ).toBe(1);
  }, 120_000);
});

describe('the sandbox limits are stricter than production - EXIT GATE', () => {
  it('is tighter on every axis production limits', () => {
    /**
     * Asserted rather than left to whoever edits one of the two files next. A
     * sandbox limit that had quietly drifted looser than production's would be
     * worse than having none: it would look like a control and behave like a
     * hole.
     */
    expect(DEMO_RATE_RULES.perIpMinute.limit).toBeLessThan(
      SUBMISSION_RATE_RULES.perIpWidgetMinute.limit,
    );
    expect(DEMO_RATE_RULES.perIpHour.limit).toBeLessThan(
      SUBMISSION_RATE_RULES.perIpWidgetHour.limit,
    );
    expect(DEMO_RATE_RULES.perWidgetMinute.limit).toBeLessThan(
      SUBMISSION_RATE_RULES.perWidgetMinute.limit,
    );
    // And the windows are the same length, so "lower limit" means what it says
    // rather than being a smaller number over a shorter period.
    expect(DEMO_RATE_RULES.perIpMinute.windowSeconds).toBe(
      SUBMISSION_RATE_RULES.perIpWidgetMinute.windowSeconds,
    );
  });

  it('caps a sandbox body well below the platform’s 32 KB', () => {
    expect(DEMO_MAX_BODY_BYTES).toBeLessThan(32 * 1024);
  });
});

describe('the public sandbox endpoints', () => {
  it('serve config and feed to anyone, with no session', async () => {
    await harness.deps.demoService.reset();
    const anonymous = new TestClient(harness.baseUrl);

    const config = await anonymous.get('/demo/v1/config');
    expect(config.status).toBe(200);
    expect((config.body as { widgets: unknown[] }).widgets).toHaveLength(3);

    const feed = await anonymous.get('/demo/v1/feed');
    expect(feed.status).toBe(200);
  }, 90_000);

  it('expose no identifier a caller could address a record with', async () => {
    await harness.deps.demoService.reset();
    const feed = await new TestClient(harness.baseUrl).get('/demo/v1/feed');
    const raw = JSON.stringify(feed.body);

    // No workspace id, no contact id, no submission id.
    expect(raw).not.toMatch(/[0-9a-f]{24}/);
  }, 90_000);
});
