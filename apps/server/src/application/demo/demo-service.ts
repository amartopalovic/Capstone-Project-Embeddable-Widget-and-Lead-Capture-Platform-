import { ObjectId, type Db } from 'mongodb';
import {
  ANONYMOUS_ACTOR_HEX,
  COLLECTIONS,
  DEFAULT_OPT_IN_MODE,
  DEFAULT_RETENTION_DAYS,
  workspaceScope,
  type InteractionEventRecord,
  type SubmissionEventRecord,
  type WidgetRecord,
  type WidgetRevisionRecord,
  type WorkspaceRecord,
} from '@lcp/database';
import {
  DEMO_RESET_INTERVAL_MINUTES,
  type DemoConfig,
  type DemoFeed,
  type DemoFeedEntry,
  type DemoWidgetSummary,
  type Logger,
  type WidgetConfig,
} from '@lcp/contracts';
import type { Clock } from '../../ports/clock.js';
import { generatePublicId } from '../../domain/widget/snippet.js';
import { defaultConfigFor } from '../../domain/widget/defaults.js';

/**
 * The public sandbox (blueprint 14.3).
 *
 * Anyone may use it, without an account, and it must never become a way to
 * reach anything real. Three properties carry that, and none of them is a
 * special case in the tenancy layer:
 *
 * **It is an ordinary workspace.** Marked with `isDemo`, scoped and queried
 * exactly like every other tenant. The isolation the demo demonstrates is the
 * isolation the product actually has, not an arrangement built to make a demo
 * look safe. Nothing here reads across a workspace boundary, and the repository
 * layer has no idea this tenant is different.
 *
 * **Nothing leaves it.** Email and webhooks are refused for this workspace at
 * the point deliveries are planned and again at the point one is attempted.
 * Two layers, because the first is a policy and the second is a wall.
 *
 * **It forgets hourly.** A scheduled job wipes and reseeds, so the sandbox
 * never accumulates a year of strangers' typing. Everything the wipe touches is
 * filtered by this workspace's id, so it structurally cannot reach another.
 */

/** The three examples, one per widget type (blueprint 4.3). */
interface Seed {
  readonly type: 'contact_form' | 'email_signup' | 'cta_popover';
  readonly name: string;
  readonly blurb: string;
  readonly headline: string;
  readonly description: string;
}

const SEEDS: readonly Seed[] = [
  {
    type: 'contact_form',
    name: 'Contact form',
    blurb:
      'Always visible, asks for an email address and a message. The workhorse: an enquiry form on a pricing or contact page.',
    headline: 'Ask us anything',
    description: 'Tell us what you need and we will get back to you.',
  },
  {
    type: 'email_signup',
    name: 'Email signup',
    blurb:
      'One field. For a mailing list, where the only thing you need is an address and permission to use it.',
    headline: 'Get the monthly note',
    description: 'One email a month about what we have shipped. Unsubscribe whenever.',
  },
  {
    type: 'cta_popover',
    name: 'CTA popover',
    blurb:
      'Hidden until something triggers it — a delay, a scroll depth, or a button you already have on the page.',
    headline: 'Before you go',
    description: 'Two minutes on a call is usually faster than an email thread.',
  },
];

/** The demo workspace's name, which appears nowhere a real workspace could. */
export const DEMO_WORKSPACE_NAME = 'Public sandbox';

export interface DemoServiceDeps {
  readonly db: Db;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Where the loader and public endpoints live, for the embed snippet. */
  readonly apiBaseUrl: string;
  /** Origins the seeded widgets accept submissions from. */
  readonly allowedOrigins: readonly string[];
}

export class DemoService {
  readonly #deps: DemoServiceDeps;

  /**
   * The seeded widgets' public ids, cached.
   *
   * The public submission path asks "is this a demo widget?" on every request
   * in order to apply the stricter limits, and that question must not cost a
   * database round trip per submission. The set changes only when the sandbox
   * is reseeded, which is once an hour, so it is refreshed there and lazily on
   * first use.
   */
  #demoPublicIds: ReadonlySet<string> = new Set();
  #loaded = false;

  constructor(deps: DemoServiceDeps) {
    this.#deps = deps;
  }

  // ------------------------------------------------------------- discovery

  /** The sandbox workspace, or null if it has never been seeded. */
  async findWorkspace(): Promise<(WorkspaceRecord & { _id: ObjectId }) | null> {
    return this.#deps.db
      .collection<WorkspaceRecord>(COLLECTIONS.workspaces)
      .findOne({ isDemo: true });
  }

  /**
   * Whether this public id belongs to the sandbox.
   *
   * Answers false rather than throwing when the sandbox has never been seeded,
   * because the public submission path calls this for every widget on the
   * platform and an unseeded sandbox must not break real traffic.
   */
  async isDemoWidget(publicId: string): Promise<boolean> {
    if (!this.#loaded) await this.#refreshIds();
    return this.#demoPublicIds.has(publicId);
  }

  async #refreshIds(): Promise<void> {
    const workspace = await this.findWorkspace();
    if (workspace === null) {
      this.#demoPublicIds = new Set();
      this.#loaded = true;
      return;
    }
    const widgets = await this.#deps.db
      .collection<WidgetRecord>(COLLECTIONS.widgets)
      .find({ workspaceId: workspace._id, status: 'active' }, { projection: { publicId: 1 } })
      .toArray();
    this.#demoPublicIds = new Set(widgets.map((widget) => widget.publicId));
    this.#loaded = true;
  }

  // ---------------------------------------------------------------- public

  /** What the demo page needs to install the seeded widgets. */
  async config(): Promise<DemoConfig | null> {
    const workspace = await this.findWorkspace();
    if (workspace === null) return null;

    const widgets = await this.#deps.db
      .collection<WidgetRecord>(COLLECTIONS.widgets)
      .find({ workspaceId: workspace._id, status: 'active' })
      .sort({ createdAt: 1 })
      .toArray();

    const summaries: DemoWidgetSummary[] = [];
    for (const widget of widgets) {
      const seed = SEEDS.find((candidate) => candidate.type === widget.type);
      if (seed === undefined) continue;
      // Only widgets that are actually being served; an unpublished one would
      // render nothing and look broken.
      if (widget.publishedRevisionId === null) continue;
      summaries.push({
        publicId: widget.publicId,
        type: seed.type,
        name: seed.name,
        blurb: seed.blurb,
      });
    }

    return {
      widgets: summaries,
      seededAt: workspace.createdAt.toISOString(),
      resetsAt: this.#nextReset(workspace.createdAt).toISOString(),
      apiBaseUrl: this.#deps.apiBaseUrl,
    };
  }

  /**
   * Recent sandbox activity, safe to show anybody (blueprint 14.3).
   *
   * "a safe, public demo result/feed without exposing dashboard tenancy." The
   * safety is in what this does NOT select. It reads only this workspace, and
   * from each record it takes a widget name, a kind, a time, and a count -
   * never an id, never an address, and never a value the visitor typed.
   *
   * That last exclusion is the one that matters. A feed echoing submitted text
   * would publish whatever the previous stranger chose to type, to every
   * subsequent visitor, on a page with no moderation. The count preserves the
   * only useful thing about the content - that something real arrived.
   */
  async feed(limit = 12): Promise<DemoFeed | null> {
    const workspace = await this.findWorkspace();
    if (workspace === null) return null;
    const scope = workspaceScope(workspace._id);

    const widgets = await this.#deps.db
      .collection<WidgetRecord>(COLLECTIONS.widgets)
      .find({ workspaceId: scope.workspaceId })
      .toArray();
    const names = new Map(widgets.map((widget) => [widget._id.toHexString(), widget.name]));

    const submissions = await this.#deps.db
      .collection<SubmissionEventRecord>(COLLECTIONS.submissionEvents)
      .find({ workspaceId: scope.workspaceId })
      .sort({ submittedAt: -1 })
      .limit(limit)
      .toArray();

    const views = await this.#deps.db
      .collection<InteractionEventRecord>(COLLECTIONS.interactionEvents)
      .find({ workspaceId: scope.workspaceId, type: 'impression' })
      .sort({ occurredAt: -1 })
      .limit(limit)
      .toArray();

    const entries: DemoFeedEntry[] = [
      ...submissions.map((event) => ({
        kind: 'submission' as const,
        widgetName: names.get(event.widgetId.toHexString()) ?? 'A demo widget',
        occurredAt: event.submittedAt.toISOString(),
        fieldCount: Object.keys(event.values).length,
      })),
      ...views.map((event) => ({
        kind: 'view' as const,
        widgetName: names.get(event.widgetId.toHexString()) ?? 'A demo widget',
        occurredAt: event.occurredAt.toISOString(),
        fieldCount: null,
      })),
    ]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit);

    return {
      entries,
      totals: {
        submissions: await this.#deps.db
          .collection(COLLECTIONS.submissionEvents)
          .countDocuments({ workspaceId: scope.workspaceId }),
        views: await this.#deps.db
          .collection(COLLECTIONS.interactionEvents)
          .countDocuments({ workspaceId: scope.workspaceId, type: 'impression' }),
      },
      seededAt: workspace.createdAt.toISOString(),
      resetsAt: this.#nextReset(workspace.createdAt).toISOString(),
    };
  }

  // ----------------------------------------------------------------- reset

  /**
   * Wipe the sandbox and seed it again (blueprint 14.3, 12.1).
   *
   * Not reachable from outside: there is no route that calls this. It runs on
   * the hourly scheduler and at startup, because a public endpoint that wipes a
   * tenant is a public endpoint that wipes a tenant, however well-intentioned.
   *
   * The delete is scoped by workspace id on every collection, which is what
   * makes "resets the sandbox" and "cannot touch a real workspace" the same
   * statement rather than two separate promises.
   */
  async reset(): Promise<{ widgets: number; cleared: number }> {
    const existing = await this.findWorkspace();
    const now = this.#deps.clock.now();

    let workspaceId: ObjectId;
    let cleared = 0;

    if (existing === null) {
      workspaceId = new ObjectId();
      await this.#deps.db.collection<WorkspaceRecord>(COLLECTIONS.workspaces).insertOne({
        _id: workspaceId,
        name: DEMO_WORKSPACE_NAME,
        /**
         * No owner, and that is deliberate. The sandbox belongs to nobody, so
         * there is no account that could sign into it and no membership row
         * linking a person to it - which is why nothing in it can appear in
         * anybody's dashboard.
         */
        ownerUserId: new ObjectId(ANONYMOUS_ACTOR_HEX),
        timezone: 'UTC',
        retentionDays: DEFAULT_RETENTION_DAYS,
        optInMode: DEFAULT_OPT_IN_MODE,
        isDemo: true,
        status: 'active',
        deletedAt: null,
        purgeAfter: null,
        createdAt: now,
        updatedAt: now,
      } as WorkspaceRecord);
    } else {
      workspaceId = existing._id;
      cleared = await this.#clear(workspaceId);
      await this.#deps.db
        .collection<WorkspaceRecord>(COLLECTIONS.workspaces)
        .updateOne({ _id: workspaceId }, { $set: { createdAt: now, updatedAt: now } });
    }

    const widgets = await this.#seedWidgets(workspaceId, now);

    await this.#refreshIds();
    this.#deps.logger.info('demo.reset', {
      result: 'success',
      widgets,
      cleared,
    });
    return { widgets, cleared };
  }

  /**
   * Everything the sandbox accumulated, removed.
   *
   * The widgets go too, and are recreated: a reset that kept them would leave
   * their public ids stable across resets, and a stable public id in a sandbox
   * is one somebody can hard-code into a script and keep pointing at.
   */
  async #clear(workspaceId: ObjectId): Promise<number> {
    let cleared = 0;
    for (const collection of DEMO_OWNED_COLLECTIONS) {
      const result = await this.#deps.db.collection(collection).deleteMany({ workspaceId });
      cleared += result.deletedCount;
    }
    return cleared;
  }

  async #seedWidgets(workspaceId: ObjectId, now: Date): Promise<number> {
    const widgets = this.#deps.db.collection<WidgetRecord>(COLLECTIONS.widgets);
    const revisions = this.#deps.db.collection<WidgetRevisionRecord>(COLLECTIONS.widgetRevisions);

    for (const seed of SEEDS) {
      const widgetId = new ObjectId();
      const revisionId = new ObjectId();
      const config = this.#configFor(seed);

      await revisions.insertOne({
        _id: revisionId,
        workspaceId,
        widgetId,
        revisionNumber: 1,
        status: 'published',
        config: config as unknown as Readonly<Record<string, unknown>>,
        version: 0,
        publishedAt: now,
        /**
         * The reserved anonymous actor. The sandbox has no owner, so there is
         * no person who published these - and pointing at a real user would be
         * a lie in an audit field.
         */
        publishedByUserId: new ObjectId(ANONYMOUS_ACTOR_HEX),
        createdByUserId: new ObjectId(ANONYMOUS_ACTOR_HEX),
        createdAt: now,
        updatedAt: now,
      });

      await widgets.insertOne({
        _id: widgetId,
        workspaceId,
        publicId: generatePublicId(),
        type: seed.type,
        name: seed.name,
        status: 'active',
        deletedAt: null,
        purgeAfter: null,
        publishedRevisionId: revisionId,
        lastPublishedRevisionNumber: 1,
        lastPublishedAt: now,
        lastRevisionNumber: 1,
        notificationTemplate: null,
        // Off, and it would be refused anyway: nothing leaves this tenant.
        confirmationEnabled: false,
        createdAt: now,
        updatedAt: now,
      } as WidgetRecord);
    }
    return SEEDS.length;
  }

  /**
   * A published configuration for one seeded widget.
   *
   * Starts from `defaultConfigFor`, the SAME function the builder uses when
   * somebody creates a widget, and changes only the copy and the allowed
   * domains. That matters: a hand-written config here would be a second
   * description of what a widget of each type looks like, and the sandbox would
   * slowly stop resembling what a customer actually gets. Reusing the builder's
   * own defaults means the demo shows the real thing.
   *
   * The allowed domains are the only structural edit, and they have to be: a
   * default config has none, because blueprint 4.4 requires the creator to
   * choose them before publishing, and the sandbox's creator is this code.
   */
  #configFor(seed: Seed): WidgetConfig {
    const base = defaultConfigFor(seed.type);
    return {
      ...base,
      headline: seed.headline,
      body: seed.description,
      /**
       * Replaced rather than spread. `success` is a discriminated union - a
       * message or a redirect - and spreading the redirect variant then adding
       * a message would build an object that is neither.
       */
      success: {
        kind: 'message',
        message: 'Thanks. This is a sandbox, so nothing was actually sent anywhere.',
      },
      targeting: {
        ...base.targeting,
        allowedDomains: this.#deps.allowedOrigins.map((origin) => hostOf(origin)),
      },
    };
  }

  #nextReset(seededAt: Date): Date {
    return new Date(seededAt.getTime() + DEMO_RESET_INTERVAL_MINUTES * 60 * 1000);
  }
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

/**
 * What a sandbox reset clears.
 *
 * Derived from the canonical collection map rather than typed out, so a
 * collection added by a later stage is wiped without anybody remembering - a
 * reset that missed one would let the sandbox accumulate exactly the history it
 * exists not to have. The exclusions are the collections with no `workspaceId`
 * to filter on, plus the workspace row itself, which is updated rather than
 * deleted so its identity survives the reset.
 */
const NOT_DEMO_OWNED = new Set<string>([
  COLLECTIONS.users,
  COLLECTIONS.workspaces,
  COLLECTIONS.migrations,
]);

export const DEMO_OWNED_COLLECTIONS: readonly string[] = Object.values(COLLECTIONS).filter(
  (name) => !NOT_DEMO_OWNED.has(name),
);
