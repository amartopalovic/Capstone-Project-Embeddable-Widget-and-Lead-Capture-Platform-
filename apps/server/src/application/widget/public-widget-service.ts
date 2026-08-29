import type { WithId } from 'mongodb';
import { workspaceScope, type WidgetRecord, type WorkspaceRecord } from '@lcp/database';
import {
  isOriginAllowed,
  toPublicConfig,
  type Logger,
  type PublicWidgetResponse,
  type WidgetConfig,
  type WidgetType,
} from '@lcp/contracts';
import type { WidgetRevisionRepositoryPort } from './types.js';

/**
 * Serving a published widget's configuration to a visitor's browser
 * (blueprint 7.2).
 *
 * Step 5 of that load path is the whole job of this file: "The backend confirms
 * the widget is published, not deleted, within quota, and permitted for that
 * Origin." Every one of those is checked here, on the server, against current
 * state - never in the runtime and never from anything the caller sent.
 *
 * Blueprint 8.2 allows the answer to be cached for 60 seconds, and immediately
 * qualifies it: "The submission endpoint always checks current server state. A
 * briefly cached config cannot bypass unpublishing, deletion, an updated
 * allowed-domain rule, or a quota block." Nothing here is a shortcut Stage 7 may
 * reuse in place of its own checks.
 */

export type PublicConfigOutcome =
  /** Served. `revision` doubles as the cache identity. */
  | { readonly kind: 'ok'; readonly response: PublicWidgetResponse }
  /** Unknown, deleted, unpublished, or in a deleted workspace - all one answer. */
  | { readonly kind: 'not_found' }
  /** Real and published, but not permitted on the Origin that asked. */
  | { readonly kind: 'origin_not_allowed' }
  | { readonly kind: 'quota_blocked' };

/**
 * A resolved public widget, for callers that need the records themselves.
 *
 * The failure cases mirror `PublicConfigOutcome` exactly, and for the same
 * reason: a public id must not become a way to probe which widgets exist.
 */
export type PublicResolution =
  | {
      readonly kind: 'ok';
      readonly widget: WithId<WidgetRecord>;
      readonly workspace: WithId<WorkspaceRecord>;
      readonly config: WidgetConfig;
      readonly revisionNumber: number;
    }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'origin_not_allowed' };

/** Look a widget up by its public identifier, across all tenants. */
export type PublicWidgetLookup = (publicId: string) => Promise<WithId<WidgetRecord> | null>;

/** Load the workspace a widget belongs to, to confirm it is still active. */
export type WorkspaceLookup = (
  widget: WithId<WidgetRecord>,
) => Promise<WithId<WorkspaceRecord> | null>;

/**
 * Whether a workspace is currently over a serving quota (blueprint 4.10).
 *
 * A seam, and honestly an inert one today: the caps that could block serving
 * are monthly submission and interaction-event counts, and neither is counted
 * until Stages 7 and 10. It exists as a named checkpoint in the right place so
 * those stages have somewhere to attach, rather than as a check that pretends
 * to do something.
 */
export type QuotaCheck = (widget: WithId<WidgetRecord>) => Promise<boolean>;

export interface PublicWidgetServiceDeps {
  readonly findByPublicId: PublicWidgetLookup;
  readonly findWorkspace: WorkspaceLookup;
  readonly revisions: WidgetRevisionRepositoryPort;
  readonly isQuotaBlocked: QuotaCheck;
  readonly logger: Logger;
}

export class PublicWidgetService {
  readonly #deps: PublicWidgetServiceDeps;

  constructor(deps: PublicWidgetServiceDeps) {
    this.#deps = deps;
  }

  /**
   * Resolve a public id to a live widget, its workspace, and its published
   * config - applying every check `config` applies.
   *
   * Extracted so the analytics endpoint runs the SAME gate as the config
   * endpoint rather than a second copy that could drift: unknown, deleted,
   * unpublished, deleted-workspace, and disallowed-Origin all behave
   * identically for both. The difference is only what the caller gets back.
   */
  async resolveForPublic(publicId: string, origin: string | undefined): Promise<PublicResolution> {
    const { findByPublicId, findWorkspace, revisions } = this.#deps;

    const widget = await findByPublicId(publicId);
    if (widget === null || widget.status !== 'active') return { kind: 'not_found' };
    if (widget.publishedRevisionId === null) return { kind: 'not_found' };

    const workspace = await findWorkspace(widget);
    if (workspace === null || workspace.status !== 'active') return { kind: 'not_found' };

    const revision = await revisions.findById(
      workspaceScope(widget.workspaceId),
      widget.publishedRevisionId,
    );
    if (revision === null || revision.status !== 'published') return { kind: 'not_found' };

    const config = revision.config as unknown as WidgetConfig;
    if (origin === undefined || !isOriginAllowed(config.targeting.allowedDomains, origin)) {
      return { kind: 'origin_not_allowed' };
    }

    return { kind: 'ok', widget, workspace, config, revisionNumber: revision.revisionNumber };
  }

  async config(publicId: string, origin: string | undefined): Promise<PublicConfigOutcome> {
    const { findByPublicId, findWorkspace, revisions, isQuotaBlocked } = this.#deps;

    const widget = await findByPublicId(publicId);

    /**
     * One answer for every "you cannot have this" case.
     *
     * Unknown, deleted, never published, and unpublished are deliberately
     * indistinguishable to a visitor. Separating them would let anyone probe
     * which identifiers are real and what state they are in.
     */
    if (widget === null) return { kind: 'not_found' };
    if (widget.status !== 'active') return { kind: 'not_found' };
    if (widget.publishedRevisionId === null) return { kind: 'not_found' };

    // A soft-deleted workspace stops serving everything it owns.
    const workspace = await findWorkspace(widget);
    if (workspace === null || workspace.status !== 'active') return { kind: 'not_found' };

    const scope = workspaceScope(widget.workspaceId);
    const revision = await revisions.findById(scope, widget.publishedRevisionId);
    if (revision === null || revision.status !== 'published') return { kind: 'not_found' };

    const config = revision.config as unknown as WidgetConfig;

    /**
     * The Origin check, on the current allowlist.
     *
     * A missing Origin header is refused rather than waved through. Browsers
     * send it on cross-origin requests, so its absence means this is not the
     * cross-origin browser fetch the endpoint exists to serve.
     */
    if (origin === undefined || !isOriginAllowed(config.targeting.allowedDomains, origin)) {
      return { kind: 'origin_not_allowed' };
    }

    if (await isQuotaBlocked(widget)) return { kind: 'quota_blocked' };

    return {
      kind: 'ok',
      response: {
        publicId: widget.publicId,
        type: widget.type as WidgetType,
        revision: revision.revisionNumber,
        config: toPublicConfig(config),
      },
    };
  }
}
