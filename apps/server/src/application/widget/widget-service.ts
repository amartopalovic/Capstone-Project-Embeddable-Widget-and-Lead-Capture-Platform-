import type { ObjectId } from 'mongodb';
import type { WorkspaceScope } from '@lcp/database';
import {
  WORKSPACE_LIMITS,
  widgetConfigSchema,
  type ApiFieldError,
  type Logger,
  type WidgetConfig,
  type WidgetDetail,
  type WidgetLifecycleState,
  type WidgetRevisionSummary,
  type WidgetSummary,
  type WidgetType,
} from '@lcp/contracts';
import type {
  WidgetRepositoryPort,
  WidgetRevisionRepositoryPort,
  WithIdRevision,
  WithIdWidget,
} from './types.js';
import type { WorkspaceAuditPort, WithIdUser } from '../workspace/types.js';
import type { Clock } from '../../ports/clock.js';
import { defaultConfigFor } from '../../domain/widget/defaults.js';
import { validateConfig } from '../../domain/widget/fields.js';
import { publishBlockers } from '../../domain/widget/publishing.js';
import { embedSnippet, generatePublicId } from '../../domain/widget/snippet.js';
import { isRecoverable, purgeDeadline } from '../../domain/workspace/retention.js';

/**
 * Widget lifecycle: create, edit the draft, publish, unpublish, delete, recover
 * (blueprint 4.3, 4.5, 9.3).
 *
 * The rule that shapes this whole file: a PUBLISHED revision is immutable
 * (blueprint 9.3). Nothing here updates one. Publishing promotes the draft to
 * published exactly once, and the next edit starts a fresh draft, so the live
 * configuration a visitor received can always be reconstructed.
 */

export type CreateOutcome =
  | { readonly kind: 'created'; readonly widget: WithIdWidget; readonly draft: WithIdRevision }
  | { readonly kind: 'quota_exceeded'; readonly limit: number };

export type DraftOutcome =
  | { readonly kind: 'saved'; readonly draft: WithIdRevision }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'invalid'; readonly errors: readonly ApiFieldError[] }
  | { readonly kind: 'stale'; readonly currentVersion: number };

export type PublishOutcome =
  | { readonly kind: 'published'; readonly revision: WithIdRevision }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'nothing_to_publish' }
  | { readonly kind: 'invalid'; readonly errors: readonly ApiFieldError[] }
  | { readonly kind: 'stale'; readonly currentVersion: number };

export type UnpublishOutcome =
  | { readonly kind: 'unpublished' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_published' };

export type DeleteOutcome = { readonly kind: 'deleted' } | { readonly kind: 'not_found' };

export type RecoverOutcome =
  | { readonly kind: 'recovered' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'window_expired' };

export interface WidgetServiceDeps {
  readonly widgets: WidgetRepositoryPort;
  readonly revisions: WidgetRevisionRepositoryPort;
  readonly audit: WorkspaceAuditPort;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Origin the embed snippet points at, e.g. https://app.example.com. */
  readonly publicBaseUrl: string;
}

export class WidgetService {
  readonly #deps: WidgetServiceDeps;

  constructor(deps: WidgetServiceDeps) {
    this.#deps = deps;
  }

  /**
   * Create a widget and its first draft.
   *
   * The 10-active-widget cap (blueprint 4.10) is checked before anything is
   * written. There is no unique index that could back this one - a count is not
   * expressible as an index - so a determined concurrent pair of creates could
   * still cross the line by one. That is a visible, self-correcting overage on
   * a demo quota rather than a security boundary, and the alternative (a
   * transaction taking a workspace-level lock on every create) costs more than
   * the problem is worth.
   */
  async create(
    scope: WorkspaceScope,
    actor: WithIdUser,
    type: WidgetType,
    name: string,
    correlationId: string,
  ): Promise<CreateOutcome> {
    const { widgets, revisions, audit, clock } = this.#deps;

    const active = await widgets.countActive(scope);
    if (active >= WORKSPACE_LIMITS.activeWidgets) {
      return { kind: 'quota_exceeded', limit: WORKSPACE_LIMITS.activeWidgets };
    }

    const now = clock.now();
    const widget = await widgets.insert(scope, {
      publicId: generatePublicId(),
      type,
      name: name.trim(),
      status: 'active',
      deletedAt: null,
      purgeAfter: null,
      publishedRevisionId: null,
      lastPublishedRevisionNumber: null,
      lastPublishedAt: null,
      lastRevisionNumber: 1,
      // Stage 9 delivery settings: a new widget has no custom copy and does
      // not confirm to visitors until somebody turns it on.
      notificationTemplate: null,
      confirmationEnabled: false,
      createdAt: now,
      updatedAt: now,
    });

    const draft = await revisions.insert(scope, {
      widgetId: widget._id,
      revisionNumber: 1,
      status: 'draft',
      config: defaultConfigFor(type) as unknown as Readonly<Record<string, unknown>>,
      version: 0,
      publishedAt: null,
      publishedByUserId: null,
      createdByUserId: actor._id,
      createdAt: now,
      updatedAt: now,
    });

    await audit.record(scope, {
      type: 'widget.created',
      actorUserId: actor._id,
      correlationId,
      metadata: {
        widgetId: widget._id.toHexString(),
        publicId: widget.publicId,
        widgetType: type,
        name: widget.name,
      },
    });

    return { kind: 'created', widget, draft };
  }

  async listActive(scope: WorkspaceScope): Promise<readonly WidgetSummary[]> {
    const widgets = await this.#deps.widgets.listActive(scope);
    const summaries = await Promise.all(
      widgets.map(async (widget) => this.#summarize(scope, widget)),
    );
    return summaries;
  }

  async listRecoverable(scope: WorkspaceScope): Promise<readonly WidgetSummary[]> {
    const now = this.#deps.clock.now();
    const widgets = await this.#deps.widgets.listRecoverable(scope, now);
    return Promise.all(widgets.map(async (widget) => this.#summarize(scope, widget)));
  }

  /** Everything one widget's detail view needs, including the embed snippet. */
  async detail(scope: WorkspaceScope, widgetId: ObjectId): Promise<WidgetDetail | null> {
    const widget = await this.#deps.widgets.findById(scope, widgetId);
    if (widget === null || widget.status !== 'active') return null;

    const all = await this.#deps.revisions.listForWidget(scope, widgetId);
    const draft = all.find((revision) => revision.status === 'draft') ?? null;
    const published =
      widget.publishedRevisionId === null
        ? null
        : (all.find((revision) => revision._id.equals(widget.publishedRevisionId)) ?? null);

    return {
      widget: await this.#summarize(scope, widget),
      draft: draft === null ? null : toRevisionSummary(draft),
      published: published === null ? null : toRevisionSummary(published),
      snippet: embedSnippet(this.#deps.publicBaseUrl, widget.publicId),
    };
  }

  /**
   * Save the draft (`widget.draft.write`).
   *
   * A Member reaches this path, and must never change what is live. That
   * property does not rest on a check here: the repository write is filtered on
   * `status: 'draft'`, and publishing is a separate route behind a separate
   * capability, so there is no argument to this method that could touch the
   * published revision.
   *
   * Deliberately not audited. Blueprint 9.3 requires an actor and correlation
   * id on role, publish, export, delete, restore, merge, and settings changes;
   * a draft save is none of those, it is autosave-shaped, and recording every
   * one would bury the events that matter in a workspace's audit view. What
   * goes live IS audited, at publish.
   */
  async saveDraft(
    scope: WorkspaceScope,
    actor: WithIdUser,
    widgetId: ObjectId,
    config: unknown,
    expectedVersion: number,
    name: string | undefined,
  ): Promise<DraftOutcome> {
    const { widgets, revisions, clock } = this.#deps;

    const widget = await widgets.findById(scope, widgetId);
    if (widget === null || widget.status !== 'active') return { kind: 'not_found' };

    const parsed = widgetConfigSchema.safeParse(config);
    if (!parsed.success) {
      return {
        kind: 'invalid',
        errors: parsed.error.issues.map((issue) => ({
          path: `config.${issue.path.join('.')}`,
          message: issue.message,
        })),
      };
    }

    // Shape is valid; now the rules shape cannot express.
    const errors = validateConfig(widget.type as WidgetType, parsed.data);
    if (errors.length > 0) return { kind: 'invalid', errors };

    const draft = await this.#ensureDraft(scope, actor, widget, clock.now());
    if (draft === null) return { kind: 'not_found' };

    const updated = await revisions.updateDraftIfVersionMatches(scope, draft._id, expectedVersion, {
      config: parsed.data as unknown as Readonly<Record<string, unknown>>,
      updatedAt: clock.now(),
    });

    if (updated === null) {
      // Either someone else saved first, or this draft is not the one the
      // caller read. Re-read to report the version they should rebase onto.
      const current = await revisions.findDraft(scope, widgetId);
      return { kind: 'stale', currentVersion: current?.version ?? draft.version };
    }

    if (name !== undefined && name.trim() !== widget.name) {
      await widgets.updateById(scope, widgetId, { name: name.trim(), updatedAt: clock.now() });
    }

    return { kind: 'saved', draft: updated };
  }

  /**
   * Publish the draft as the new live revision (`widget.publish`).
   *
   * The draft row itself becomes the published row. That keeps the promise in
   * blueprint 4.5 - "publishes the draft, making it the new immutable live
   * revision" - literal: there is one row per revision number, and its content
   * is exactly what was reviewed. A later edit allocates the NEXT number for a
   * fresh draft, so nothing published is ever rewritten.
   */
  async publish(
    scope: WorkspaceScope,
    actor: WithIdUser,
    widgetId: ObjectId,
    expectedVersion: number,
    correlationId: string,
  ): Promise<PublishOutcome> {
    const { widgets, revisions, audit, clock } = this.#deps;

    const widget = await widgets.findById(scope, widgetId);
    if (widget === null || widget.status !== 'active') return { kind: 'not_found' };

    const draft = await revisions.findDraft(scope, widgetId);
    if (draft === null) return { kind: 'nothing_to_publish' };

    const config = draft.config as unknown as WidgetConfig;
    const blockers = publishBlockers(widget.type as WidgetType, config);
    if (blockers.length > 0) return { kind: 'invalid', errors: blockers };

    const now = clock.now();
    const published = await revisions.promoteDraftToPublished(
      scope,
      draft._id,
      expectedVersion,
      now,
      actor._id,
    );
    if (published === null) {
      const current = await revisions.findDraft(scope, widgetId);
      return { kind: 'stale', currentVersion: current?.version ?? draft.version };
    }

    await widgets.updateById(scope, widgetId, {
      publishedRevisionId: published._id,
      lastPublishedRevisionNumber: published.revisionNumber,
      lastPublishedAt: now,
      updatedAt: now,
    });

    await audit.record(scope, {
      type: 'widget.published',
      actorUserId: actor._id,
      correlationId,
      metadata: {
        widgetId: widgetId.toHexString(),
        publicId: widget.publicId,
        revisionNumber: published.revisionNumber,
      },
    });

    return { kind: 'published', revision: published };
  }

  /**
   * Stop serving the widget (blueprint 4.5: "Unpublishing immediately blocks
   * new config use and submissions at the backend").
   *
   * The published revision is kept; only the pointer to it is cleared. History
   * is not rewritten, and republishing is an ordinary publish of the next
   * draft.
   */
  async unpublish(
    scope: WorkspaceScope,
    actor: WithIdUser,
    widgetId: ObjectId,
    correlationId: string,
  ): Promise<UnpublishOutcome> {
    const { widgets, audit, clock } = this.#deps;

    const widget = await widgets.findById(scope, widgetId);
    if (widget === null || widget.status !== 'active') return { kind: 'not_found' };
    if (widget.publishedRevisionId === null) return { kind: 'not_published' };

    const now = clock.now();
    // Only the live pointer is cleared; the publish history stays.
    await widgets.updateById(scope, widgetId, {
      publishedRevisionId: null,
      updatedAt: now,
    });

    await audit.record(scope, {
      type: 'widget.unpublished',
      actorUserId: actor._id,
      correlationId,
      metadata: {
        widgetId: widgetId.toHexString(),
        publicId: widget.publicId,
        revisionNumber: widget.lastPublishedRevisionNumber,
      },
    });

    return { kind: 'unpublished' };
  }

  /**
   * Soft-delete into the 30-day widget trash (blueprint 9.5).
   *
   * Nothing cascades. Blueprint 4.5 is explicit that "deleting a widget does
   * not delete its historical contacts or submission events", and those records
   * do not exist until Stage 8 - so the important thing this stage can do is
   * not build the cascade in the first place.
   */
  async softDelete(
    scope: WorkspaceScope,
    actor: WithIdUser,
    widgetId: ObjectId,
    correlationId: string,
  ): Promise<DeleteOutcome> {
    const { widgets, audit, clock } = this.#deps;

    const widget = await widgets.findById(scope, widgetId);
    if (widget === null || widget.status !== 'active') return { kind: 'not_found' };

    const now = clock.now();
    await widgets.updateById(scope, widgetId, {
      status: 'deleted',
      deletedAt: now,
      purgeAfter: purgeDeadline(now),
      // A deleted widget is servable to nobody. Clearing the pointer here is
      // also what makes "restoring does not republish" (4.5) fall out for free.
      publishedRevisionId: null,
      updatedAt: now,
    });

    await audit.record(scope, {
      type: 'widget.deleted',
      actorUserId: actor._id,
      correlationId,
      metadata: {
        widgetId: widgetId.toHexString(),
        publicId: widget.publicId,
        purgeAfter: purgeDeadline(now).toISOString(),
      },
    });

    return { kind: 'deleted' };
  }

  /** Restore from trash, deliberately NOT republished (blueprint 4.5). */
  async recover(
    scope: WorkspaceScope,
    actor: WithIdUser,
    widgetId: ObjectId,
    correlationId: string,
  ): Promise<RecoverOutcome> {
    const { widgets, audit, clock } = this.#deps;

    const widget = await widgets.findById(scope, widgetId);
    if (widget === null || widget.status !== 'deleted') return { kind: 'not_found' };

    const now = clock.now();
    if (!isRecoverable(widget.purgeAfter, now)) return { kind: 'window_expired' };

    await widgets.updateById(scope, widgetId, {
      status: 'active',
      deletedAt: null,
      purgeAfter: null,
      updatedAt: now,
    });

    await audit.record(scope, {
      type: 'widget.recovered',
      actorUserId: actor._id,
      correlationId,
      metadata: { widgetId: widgetId.toHexString(), publicId: widget.publicId },
    });

    return { kind: 'recovered' };
  }

  /**
   * The draft to write into, creating one if the widget has only a live
   * revision (blueprint 4.5: "Editing a published widget creates or updates a
   * draft revision").
   */
  async #ensureDraft(
    scope: WorkspaceScope,
    actor: WithIdUser,
    widget: WithIdWidget,
    now: Date,
  ): Promise<WithIdRevision | null> {
    const existing = await this.#deps.revisions.findDraft(scope, widget._id);
    if (existing !== null) return existing;

    const nextNumber = await this.#deps.widgets.allocateRevisionNumber(scope, widget._id);
    if (nextNumber === null) return null;

    // The new draft starts from what is live, so an edit is a change to the
    // published configuration rather than a blank slate.
    const published =
      widget.publishedRevisionId === null
        ? null
        : await this.#deps.revisions.findById(scope, widget.publishedRevisionId);

    return this.#deps.revisions.insert(scope, {
      widgetId: widget._id,
      revisionNumber: nextNumber,
      status: 'draft',
      config:
        published?.config ??
        (defaultConfigFor(widget.type as WidgetType) as unknown as Readonly<
          Record<string, unknown>
        >),
      version: 0,
      publishedAt: null,
      publishedByUserId: null,
      createdByUserId: actor._id,
      createdAt: now,
      updatedAt: now,
    });
  }

  async #summarize(scope: WorkspaceScope, widget: WithIdWidget): Promise<WidgetSummary> {
    const draft = await this.#deps.revisions.findDraft(scope, widget._id);
    return {
      id: widget._id.toHexString(),
      publicId: widget.publicId,
      type: widget.type as WidgetType,
      name: widget.name,
      state: lifecycleState(widget),
      // Reported only while actually live, so a taken-down widget does not
      // look published in a list.
      publishedRevisionNumber:
        widget.publishedRevisionId === null ? null : widget.lastPublishedRevisionNumber,
      publishedAt:
        widget.publishedRevisionId === null
          ? null
          : (widget.lastPublishedAt?.toISOString() ?? null),
      // A draft alongside a live revision means edits are waiting to go out.
      hasUnpublishedChanges: draft !== null && widget.publishedRevisionId !== null,
      createdAt: widget.createdAt.toISOString(),
      updatedAt: widget.updatedAt.toISOString(),
    };
  }
}

function lifecycleState(widget: WithIdWidget): WidgetLifecycleState {
  if (widget.status === 'deleted') return 'deleted';
  if (widget.publishedRevisionId !== null) return 'published';
  // Never published and taken down look identical to a visitor but not to a
  // creator, so the publish history separates them.
  return widget.lastPublishedRevisionNumber === null ? 'draft' : 'unpublished';
}

function toRevisionSummary(revision: WithIdRevision): WidgetRevisionSummary {
  return {
    id: revision._id.toHexString(),
    revisionNumber: revision.revisionNumber,
    status: revision.status,
    version: revision.version,
    config: revision.config as unknown as WidgetConfig,
    publishedAt: revision.publishedAt?.toISOString() ?? null,
    publishedByUserId: revision.publishedByUserId?.toHexString() ?? null,
    createdAt: revision.createdAt.toISOString(),
    updatedAt: revision.updatedAt.toISOString(),
  };
}
