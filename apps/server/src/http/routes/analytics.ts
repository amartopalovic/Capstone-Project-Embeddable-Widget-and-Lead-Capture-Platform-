import { Router } from 'express';
import { COLLECTIONS, type WidgetRecord } from '@lcp/database';
import type { Db } from 'mongodb';
import { ERROR_CODES, analyticsQuerySchema, validate, type Logger } from '@lcp/contracts';
import type { AnalyticsService } from '../../application/analytics/analytics-service.js';
import type { MembershipService } from '../../application/workspace/membership-service.js';
import type { WorkspaceService } from '../../application/workspace/workspace-service.js';
import { ApiError } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/session.js';
import { requireCapability, requireWorkspaceContext } from '../middleware/workspace.js';

/**
 * The analytics read surface (blueprint 4.9, 13.2).
 *
 * One endpoint, not eight. All eight dashboards come from the same aggregate
 * read because they are all slices of one range of one workspace's data:
 * splitting them would mean eight round trips, eight chances for the range to
 * drift between them, and a page that renders inconsistent totals while it
 * loads.
 *
 * `workspace.view` is the capability - the same row of the section 11 matrix
 * the dashboard overview already uses, which every role holds. Stage 10b adds
 * no capability names.
 */

export interface AnalyticsRouterDeps {
  readonly db: Db;
  readonly analytics: AnalyticsService;
  readonly memberships: MembershipService;
  readonly workspaces: WorkspaceService;
  readonly logger: Logger;
}

export function createAnalyticsRouter(deps: AnalyticsRouterDeps): Router {
  const router = Router();
  const { db, analytics, memberships, workspaces } = deps;

  router.use(requireAuth());
  const withWorkspace = requireWorkspaceContext(memberships, workspaces);

  router.get('/', withWorkspace, requireCapability('workspace.view'), async (req, res, next) => {
    try {
      const scope = req.workspaceScope;
      if (scope === undefined) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');

      const parsed = validate(analyticsQuerySchema, req.query);
      if (!parsed.ok) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Invalid range', parsed.errors);
      }

      const workspace = await workspaces.findActive(scope);
      if (workspace === null) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');

      /**
       * Widget names, resolved here rather than stored on the aggregate.
       *
       * The counters are keyed by id and outlive the widget - blueprint 4.9
       * keeps aggregates after raw events expire, and 9.5 keeps historical
       * contacts after a widget is deleted. Denormalising the name into the
       * aggregate would freeze it at aggregation time, so a renamed widget
       * would show two names across one chart.
       */
      const widgets = await db
        .collection<WidgetRecord>(COLLECTIONS.widgets)
        .find({ workspaceId: scope.workspaceId }, { projection: { name: 1 } })
        .toArray();
      const names = new Map(widgets.map((widget) => [widget._id.toHexString(), widget.name]));

      res.status(200).json(await analytics.overview(scope, workspace.timezone, parsed.data, names));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
