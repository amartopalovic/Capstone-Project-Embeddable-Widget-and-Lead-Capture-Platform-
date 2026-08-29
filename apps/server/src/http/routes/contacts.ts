import { Router, type Request } from 'express';
import { pipeline } from 'node:stream/promises';
import { ObjectId, type WithId } from 'mongodb';
import type { ContactRecord } from '@lcp/database';
import {
  ERROR_CODES,
  addNoteSchema,
  bulkActionSchema,
  contactListQuerySchema,
  exportQuerySchema,
  mergeContactsSchema,
  updateCanonicalSchema,
  updateWorkflowSchema,
  validate,
  type Logger,
} from '@lcp/contracts';
import type { ContactService, Actor } from '../../application/contact/contact-service.js';
import { csvExport, jsonExport } from '../../application/contact/export.js';
import { canPerformBulkAction } from '../../domain/contact/bulk.js';
import type { MembershipService } from '../../application/workspace/membership-service.js';
import type { WorkspaceService } from '../../application/workspace/workspace-service.js';
import { ApiError } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/session.js';
import { requireCapability, requireWorkspaceContext } from '../middleware/workspace.js';

/**
 * The contact inbox API (blueprint 4.6, 4.7, 9.3, 9.5, 11).
 *
 * Every route names an EXISTING capability from the section 11 matrix; Stage 8
 * adds no capability names and edits no cells. The mapping is the whole
 * authorization story:
 *
 *  - reading, listing, and the timeline are `contact.view`, which all three
 *    roles hold;
 *  - status, assignee, tags, and notes are `contact.workflow.write`, also all
 *    three roles - that is what makes this a collaborative inbox rather than an
 *    Owner's private list;
 *  - canonical edits and merges are `contact.canonical.write`, Owner/Admin;
 *  - export is `contact.export`, Owner/Admin;
 *  - soft-delete, trash, and recovery are `contact.delete`, Owner/Admin.
 *
 * Bulk is the one route whose capability depends on its BODY, so it is checked
 * inside the handler against the same matrix rather than by a fixed guard.
 */

/** Express 5 types a route parameter as `string | string[]`; see members.ts. */
function pathParam(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? '';
  return '';
}

function contactObjectId(raw: string): ObjectId {
  if (!ObjectId.isValid(raw)) {
    // The same answer as a contact in another tenant, so an invalid id cannot
    // be told apart from someone else's.
    throw new ApiError(ERROR_CODES.NOT_FOUND, 'Contact not found');
  }
  return new ObjectId(raw);
}

/** The scope, role, and actor a handler needs, or a refusal. */
function context(request: Request): {
  scope: NonNullable<Request['workspaceScope']>;
  actor: Actor;
} {
  const scope = request.workspaceScope;
  const role = request.workspaceRole;
  const user = request.currentUser;
  if (scope === undefined || role === undefined || user === undefined) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
  }
  return {
    scope,
    actor: {
      userId: user._id,
      // Blueprint 9.3: every change records the request correlation ID.
      correlationId: request.correlationId ?? 'unknown',
      subject: { role, emailVerified: user.emailVerifiedAt !== null },
    },
  };
}

/**
 * Translate a service result into an HTTP answer.
 *
 * One place, so a stale canonical edit and a stale bulk action cannot end up
 * with different status codes.
 */
function sendWrite(
  result: Awaited<ReturnType<ContactService['updateWorkflow']>>,
  response: Parameters<Parameters<Router['get']>[1]>[1],
): void {
  switch (result.kind) {
    case 'ok':
      response.status(200).json({ contact: result.contact });
      return;
    case 'not_found':
      throw new ApiError(ERROR_CODES.NOT_FOUND, 'Contact not found');
    case 'stale':
      throw new ApiError(
        ERROR_CODES.STALE_REVISION,
        'This contact changed since you loaded it. Reload and reapply your edit.',
        [
          {
            path: 'expectedVersion',
            message: `Current version is ${String(result.currentVersion)}`,
          },
        ],
      );
    case 'conflict':
      throw new ApiError(
        ERROR_CODES.CONFLICT,
        result.reason === 'email_in_use'
          ? 'Another contact in this workspace already uses that email address'
          : 'This change conflicts with the current state of the contact',
      );
  }
}

export interface ContactsRouterDeps {
  readonly contacts: ContactService;
  readonly memberships: MembershipService;
  readonly workspaces: WorkspaceService;
  readonly logger: Logger;
}

export function createContactsRouter(deps: ContactsRouterDeps): Router {
  const router = Router();
  const { contacts, memberships, workspaces } = deps;

  router.use(requireAuth());
  const withWorkspace = requireWorkspaceContext(memberships, workspaces);

  // ------------------------------------------------------------------ read

  router.get('/', withWorkspace, requireCapability('contact.view'), async (req, res, next) => {
    try {
      const { scope } = context(req);
      const parsed = validate(contactListQuerySchema, req.query);
      if (!parsed.ok) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Invalid filter', parsed.errors);
      }
      res.status(200).json(await contacts.list(scope, parsed.data));
    } catch (error) {
      next(error);
    }
  });

  /**
   * The 30-day contact trash (blueprint 9.5).
   *
   * Owner/Admin only, because 4.7 says "recovery and permanent-deletion
   * controls remain Owner/Admin only" - and seeing what is in the trash is
   * part of that control, not a separate read.
   */
  router.get(
    '/trash',
    withWorkspace,
    requireCapability('contact.delete'),
    async (req, res, next) => {
      try {
        const { scope } = context(req);
        const parsed = validate(contactListQuerySchema, req.query);
        if (!parsed.ok) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Invalid filter', parsed.errors);
        }
        res.status(200).json(await contacts.listTrash(scope, parsed.data));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Filtered, streaming export (blueprint 4.7).
   *
   * Declared before `/:contactId` so the literal path wins, and streamed with
   * `stream.pipeline` so Node applies backpressure - a large workspace's export
   * must not become a memory spike proportional to its lead count.
   */
  router.get(
    '/export',
    withWorkspace,
    requireCapability('contact.export'),
    async (req, res, next) => {
      try {
        const { scope, actor } = context(req);
        const parsed = validate(exportQuerySchema, req.query);
        if (!parsed.ok) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Invalid filter', parsed.errors);
        }
        const query = parsed.data;
        const cursor = await contacts.exportCursor(scope, query);

        const stamp = new Date().toISOString().slice(0, 10);
        res.status(200);
        res.setHeader(
          'content-type',
          query.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
        );
        res.setHeader(
          'content-disposition',
          `attachment; filename="contacts-${stamp}.${query.format}"`,
        );
        // No length is known ahead of time, which is the point of streaming.
        res.setHeader('cache-control', 'no-store');

        let rowCount = 0;
        const counted = async function* (): AsyncGenerator<WithId<ContactRecord>> {
          for await (const contact of cursor) {
            rowCount += 1;
            yield contact;
          }
        };

        await pipeline(query.format === 'csv' ? csvExport(counted()) : jsonExport(counted()), res);

        // Recorded after the stream completes, so the count is what was
        // actually delivered rather than what was intended (blueprint 9.3).
        await contacts.recordExport(scope, query, rowCount, actor);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/:contactId',
    withWorkspace,
    requireCapability('contact.view'),
    async (req, res, next) => {
      try {
        const { scope, actor } = context(req);
        const detail = await contacts.detail(
          scope,
          contactObjectId(pathParam(req.params.contactId)),
          actor.subject,
        );
        if (detail === null) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Contact not found');
        res.status(200).json(detail);
      } catch (error) {
        next(error);
      }
    },
  );

  // ----------------------------------------------------------- workflow

  router.patch(
    '/:contactId/workflow',
    withWorkspace,
    requireCapability('contact.workflow.write'),
    async (req, res, next) => {
      try {
        const { scope, actor } = context(req);
        const parsed = validate(updateWorkflowSchema, req.body);
        if (!parsed.ok) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Invalid change', parsed.errors);
        }
        sendWrite(
          await contacts.updateWorkflow(
            scope,
            contactObjectId(pathParam(req.params.contactId)),
            parsed.data,
            actor,
          ),
          res,
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/:contactId/notes',
    withWorkspace,
    requireCapability('contact.workflow.write'),
    async (req, res, next) => {
      try {
        const { scope, actor } = context(req);
        const parsed = validate(addNoteSchema, req.body);
        if (!parsed.ok) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Invalid note', parsed.errors);
        }
        sendWrite(
          await contacts.addNote(
            scope,
            contactObjectId(pathParam(req.params.contactId)),
            parsed.data.note,
            actor,
          ),
          res,
        );
      } catch (error) {
        next(error);
      }
    },
  );

  // ---------------------------------------------------------- canonical

  router.patch(
    '/:contactId',
    withWorkspace,
    requireCapability('contact.canonical.write'),
    async (req, res, next) => {
      try {
        const { scope, actor } = context(req);
        const parsed = validate(updateCanonicalSchema, req.body);
        if (!parsed.ok) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Invalid change', parsed.errors);
        }
        sendWrite(
          await contacts.updateCanonical(
            scope,
            contactObjectId(pathParam(req.params.contactId)),
            parsed.data,
            actor,
          ),
          res,
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/merge',
    withWorkspace,
    requireCapability('contact.canonical.write'),
    async (req, res, next) => {
      try {
        const { scope, actor } = context(req);
        const parsed = validate(mergeContactsSchema, req.body);
        if (!parsed.ok) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Invalid merge', parsed.errors);
        }
        const result = await contacts.merge(
          scope,
          new ObjectId(parsed.data.survivorId),
          new ObjectId(parsed.data.duplicateId),
          actor,
        );
        switch (result.kind) {
          case 'ok':
            res.status(200).json({
              contact: result.contact,
              movedSubmissions: result.movedSubmissions,
              movedActivities: result.movedActivities,
            });
            return;
          case 'not_found':
            throw new ApiError(ERROR_CODES.NOT_FOUND, 'Contact not found');
          case 'conflict':
            throw new ApiError(
              ERROR_CODES.CONFLICT,
              result.reason === 'same_contact'
                ? 'A contact cannot be merged into itself'
                : 'These contacts cannot be merged',
            );
        }
      } catch (error) {
        next(error);
      }
    },
  );

  // --------------------------------------------------- trash and recovery

  router.delete(
    '/:contactId',
    withWorkspace,
    requireCapability('contact.delete'),
    async (req, res, next) => {
      try {
        const { scope, actor } = context(req);
        sendWrite(
          await contacts.softDelete(scope, contactObjectId(pathParam(req.params.contactId)), actor),
          res,
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/:contactId/recover',
    withWorkspace,
    requireCapability('contact.delete'),
    async (req, res, next) => {
      try {
        const { scope, actor } = context(req);
        sendWrite(
          await contacts.recover(scope, contactObjectId(pathParam(req.params.contactId)), actor),
          res,
        );
      } catch (error) {
        next(error);
      }
    },
  );

  // ------------------------------------------------------------------ bulk

  /**
   * The one route whose required capability depends on the request body.
   *
   * Blueprint 4.7 gives Members status, assign, and tag but not soft-delete, so
   * the guard cannot be a fixed capability on the route. It is still the same
   * matrix - `canPerformBulkAction` maps the action to its capability and asks
   * `can()` - rather than a second role table written for bulk.
   */
  router.post(
    '/bulk',
    withWorkspace,
    requireCapability('contact.workflow.write'),
    async (req, res, next) => {
      try {
        const { scope, actor } = context(req);
        const parsed = validate(bulkActionSchema, req.body);
        if (!parsed.ok) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Invalid bulk action', parsed.errors);
        }
        const input = parsed.data;

        if (!canPerformBulkAction(actor.subject, input.action)) {
          throw new ApiError(ERROR_CODES.FORBIDDEN, 'Your role does not allow this action');
        }

        if (input.action === 'status' && input.status === undefined) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'A status is required', [
            { path: 'status', message: 'Required for the status action' },
          ]);
        }
        if ((input.action === 'tag' || input.action === 'untag') && input.tag === undefined) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'A tag is required', [
            { path: 'tag', message: 'Required for the tag action' },
          ]);
        }

        const result = await contacts.bulk(
          scope,
          input.action,
          input.contactIds.map((id) => new ObjectId(id)),
          {
            ...(input.status === undefined ? {} : { status: input.status }),
            ...(input.assigneeUserId === undefined ? {} : { assigneeUserId: input.assigneeUserId }),
            ...(input.tag === undefined ? {} : { tag: input.tag }),
          },
          actor,
        );
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
