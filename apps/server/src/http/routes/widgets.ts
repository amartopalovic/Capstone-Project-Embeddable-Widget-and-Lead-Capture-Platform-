import { Router } from 'express';
import { ObjectId } from 'mongodb';
import {
  ERROR_CODES,
  createWidgetSchema,
  publishWidgetSchema,
  updateDraftSchema,
  validate,
  type Logger,
} from '@lcp/contracts';
import type { WidgetService } from '../../application/widget/widget-service.js';
import type { MembershipService } from '../../application/workspace/membership-service.js';
import type { WorkspaceService } from '../../application/workspace/workspace-service.js';
import { ApiError } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/session.js';
import { requireCapability, requireWorkspaceContext } from '../middleware/workspace.js';

/**
 * Widget management (blueprint 4.3, 4.5, 10.1, 11).
 *
 * The capability on each route is the whole authorization story, and each one
 * is an EXISTING row of the section 11 matrix rather than a new name invented
 * for this stage:
 *
 *  - reading falls under `workspace.view`, the same row the workspace-context
 *    and members endpoints already use; section 11 has no separate
 *    "view widgets" row;
 *  - drafting is `widget.draft.write`, which every role holds - that is what
 *    lets a Member edit a draft;
 *  - publishing and unpublishing are `widget.publish`, which is Owner/Admin and
 *    carries the verified-email qualifier, so an unverified Admin is refused
 *    with `email_not_verified` rather than a bare forbidden;
 *  - deleting and recovering are `widget.delete`, Owner/Admin only.
 *
 * Scope always comes from `requireWorkspaceContext`, never from the request.
 */

/** Express 5 types a route parameter as `string | string[]`; see members.ts. */
function pathParam(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? '';
  return '';
}

function widgetObjectId(raw: string): ObjectId {
  if (!ObjectId.isValid(raw)) {
    // Same answer as a widget in another tenant, so an invalid id cannot be
    // told apart from someone else's.
    throw new ApiError(ERROR_CODES.NOT_FOUND, 'Widget not found');
  }
  return new ObjectId(raw);
}

export interface WidgetsRouterDeps {
  readonly widgets: WidgetService;
  readonly memberships: MembershipService;
  readonly workspaces: WorkspaceService;
  readonly logger: Logger;
}

export function createWidgetsRouter(deps: WidgetsRouterDeps): Router {
  const router = Router();
  const { widgets, memberships, workspaces } = deps;

  router.use(requireAuth());
  const withWorkspace = requireWorkspaceContext(memberships, workspaces);

  // ------------------------------------------------------------------ read

  router.get(
    '/',
    withWorkspace,
    requireCapability('workspace.view'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        if (scope === undefined) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        response.status(200).json({ widgets: await widgets.listActive(scope) });
      } catch (error) {
        next(error);
      }
    },
  );

  /** Soft-deleted widgets still inside the 30-day window (blueprint 9.5). */
  router.get(
    '/trash',
    withWorkspace,
    requireCapability('workspace.view'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        if (scope === undefined) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        response.status(200).json({ widgets: await widgets.listRecoverable(scope) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/:widgetId',
    withWorkspace,
    requireCapability('workspace.view'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        if (scope === undefined) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');

        const detail = await widgets.detail(
          scope,
          widgetObjectId(pathParam(request.params.widgetId)),
        );
        if (detail === null) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Widget not found');

        response.status(200).json(detail);
      } catch (error) {
        next(error);
      }
    },
  );

  // ----------------------------------------------------------------- draft

  router.post(
    '/',
    withWorkspace,
    requireCapability('widget.draft.write'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        const user = request.currentUser;
        if (scope === undefined || user === undefined) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        }

        const parsed = validate(createWidgetSchema, request.body);
        if (!parsed.ok) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_FAILED,
            'Check the submitted fields',
            parsed.errors,
          );
        }

        const outcome = await widgets.create(
          scope,
          user,
          parsed.data.type,
          parsed.data.name,
          request.correlationId,
        );

        if (outcome.kind === 'quota_exceeded') {
          throw new ApiError(
            ERROR_CODES.QUOTA_EXCEEDED,
            `This workspace has reached its ${String(outcome.limit)}-widget limit`,
          );
        }

        const detail = await widgets.detail(scope, outcome.widget._id);
        response.status(201).json(detail);
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/:widgetId/draft',
    withWorkspace,
    requireCapability('widget.draft.write'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        const user = request.currentUser;
        if (scope === undefined || user === undefined) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        }

        const parsed = validate(updateDraftSchema, request.body);
        if (!parsed.ok) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_FAILED,
            'Check the submitted fields',
            parsed.errors,
          );
        }

        const outcome = await widgets.saveDraft(
          scope,
          user,
          widgetObjectId(pathParam(request.params.widgetId)),
          parsed.data.config,
          parsed.data.expectedVersion,
          parsed.data.name,
        );

        switch (outcome.kind) {
          case 'saved':
            response.status(200).json({ status: 'saved', version: outcome.draft.version });
            return;
          case 'not_found':
            throw new ApiError(ERROR_CODES.NOT_FOUND, 'Widget not found');
          case 'invalid':
            throw new ApiError(
              ERROR_CODES.VALIDATION_FAILED,
              'Check the submitted fields',
              outcome.errors,
            );
          case 'stale':
            // Blueprint 10.1: a conflicting update answers 409 and tells the
            // caller what to rebase onto, rather than overwriting a teammate.
            throw new ApiError(
              ERROR_CODES.STALE_REVISION,
              'Someone else saved this draft first. Reload to see their changes.',
              [
                {
                  path: 'expectedVersion',
                  message: `Current version is ${String(outcome.currentVersion)}`,
                },
              ],
            );
        }
      } catch (error) {
        next(error);
      }
    },
  );

  // ------------------------------------------------------------- publishing

  router.post(
    '/:widgetId/publish',
    withWorkspace,
    requireCapability('widget.publish'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        const user = request.currentUser;
        if (scope === undefined || user === undefined) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        }

        const parsed = validate(publishWidgetSchema, request.body);
        if (!parsed.ok) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_FAILED,
            'Check the submitted fields',
            parsed.errors,
          );
        }

        const outcome = await widgets.publish(
          scope,
          user,
          widgetObjectId(pathParam(request.params.widgetId)),
          parsed.data.expectedVersion,
          request.correlationId,
        );

        switch (outcome.kind) {
          case 'published':
            response
              .status(200)
              .json({ status: 'published', revisionNumber: outcome.revision.revisionNumber });
            return;
          case 'not_found':
            throw new ApiError(ERROR_CODES.NOT_FOUND, 'Widget not found');
          case 'nothing_to_publish':
            throw new ApiError(ERROR_CODES.CONFLICT, 'There are no draft changes to publish');
          case 'invalid':
            throw new ApiError(
              ERROR_CODES.VALIDATION_FAILED,
              'This widget is not ready to publish',
              outcome.errors,
            );
          case 'stale':
            throw new ApiError(
              ERROR_CODES.STALE_REVISION,
              'This draft changed while you were publishing. Reload and try again.',
              [
                {
                  path: 'expectedVersion',
                  message: `Current version is ${String(outcome.currentVersion)}`,
                },
              ],
            );
        }
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/:widgetId/unpublish',
    withWorkspace,
    requireCapability('widget.publish'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        const user = request.currentUser;
        if (scope === undefined || user === undefined) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        }

        const outcome = await widgets.unpublish(
          scope,
          user,
          widgetObjectId(pathParam(request.params.widgetId)),
          request.correlationId,
        );

        if (outcome.kind === 'not_found')
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Widget not found');
        if (outcome.kind === 'not_published') {
          throw new ApiError(ERROR_CODES.CONFLICT, 'This widget is not published');
        }

        response.status(200).json({ status: 'unpublished' });
      } catch (error) {
        next(error);
      }
    },
  );

  // ------------------------------------------------------ trash and recovery

  router.delete(
    '/:widgetId',
    withWorkspace,
    requireCapability('widget.delete'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        const user = request.currentUser;
        if (scope === undefined || user === undefined) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        }

        const outcome = await widgets.softDelete(
          scope,
          user,
          widgetObjectId(pathParam(request.params.widgetId)),
          request.correlationId,
        );
        if (outcome.kind === 'not_found')
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Widget not found');

        response.status(200).json({ status: 'deleted' });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/:widgetId/recover',
    withWorkspace,
    requireCapability('widget.delete'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        const user = request.currentUser;
        if (scope === undefined || user === undefined) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        }

        const outcome = await widgets.recover(
          scope,
          user,
          widgetObjectId(pathParam(request.params.widgetId)),
          request.correlationId,
        );

        if (outcome.kind === 'not_found')
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Widget not found');
        if (outcome.kind === 'window_expired') {
          throw new ApiError(
            ERROR_CODES.CONFLICT,
            'The 30-day recovery window for this widget has passed.',
          );
        }

        response.status(200).json({ status: 'recovered' });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
