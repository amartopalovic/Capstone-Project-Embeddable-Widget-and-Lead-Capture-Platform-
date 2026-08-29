import { Router, type Request } from 'express';
import { ObjectId } from 'mongodb';
import {
  ERROR_CODES,
  addRecipientSchema,
  createWebhookSchema,
  deliveryQuerySchema,
  updateNotificationSettingsSchema,
  updateWebhookSchema,
  validate,
  type Logger,
} from '@lcp/contracts';
import type {
  Actor,
  DeliveryAdminService,
} from '../../application/delivery/delivery-admin-service.js';
import type { DeliveryService } from '../../application/delivery/delivery-service.js';
import type { DeliveryWorkers } from '../../application/delivery/delivery-worker.js';
import type { MembershipService } from '../../application/workspace/membership-service.js';
import type { WorkspaceService } from '../../application/workspace/workspace-service.js';
import { can } from '../../domain/workspace/capabilities.js';
import { ApiError } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/session.js';
import { requireCapability, requireWorkspaceContext } from '../middleware/workspace.js';

/**
 * Delivery operations (blueprint 12.2-12.4, 16.4).
 *
 * Every route names an EXISTING capability from the section 11 matrix; Stage 9
 * adds no capability names:
 *
 *  - reading delivery health is `delivery.view`, the row 11 already has. It is
 *    `limited` for a Member, which the matrix's own comment explains as
 *    "Limited per-lead activity only" - so a Member reaches the surface and
 *    sees their own leads' deliveries, and the management controls are absent;
 *  - configuring webhooks, recipients, and templates is
 *    `settings.delivery.write`, Owner/Admin;
 *  - replaying a dead letter is `settings.delivery.write` too: it spends the
 *    email allowance and re-hits a customer's endpoint, which is an operational
 *    act rather than a read.
 */

function pathParam(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? '';
  return '';
}

function objectId(raw: string, what: string): ObjectId {
  if (!ObjectId.isValid(raw)) throw new ApiError(ERROR_CODES.NOT_FOUND, `${what} not found`);
  return new ObjectId(raw);
}

function context(request: Request): {
  scope: NonNullable<Request['workspaceScope']>;
  actor: Actor;
  canManage: boolean;
} {
  const scope = request.workspaceScope;
  const role = request.workspaceRole;
  const user = request.currentUser;
  if (scope === undefined || role === undefined || user === undefined) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
  }
  const subject = { role, emailVerified: user.emailVerifiedAt !== null };
  return {
    scope,
    actor: { userId: user._id, correlationId: request.correlationId ?? 'unknown' },
    canManage: can(subject, 'settings.delivery.write'),
  };
}

export interface DeliveriesRouterDeps {
  readonly admin: DeliveryAdminService;
  readonly deliveries: DeliveryService;
  readonly workers: DeliveryWorkers;
  readonly memberships: MembershipService;
  readonly workspaces: WorkspaceService;
  readonly logger: Logger;
}

export function createDeliveriesRouter(deps: DeliveriesRouterDeps): Router {
  const router = Router();
  const { admin, deliveries, workers, memberships, workspaces } = deps;

  router.use(requireAuth());
  const withWorkspace = requireWorkspaceContext(memberships, workspaces);

  // ------------------------------------------------------------- health

  router.get('/', withWorkspace, requireCapability('delivery.view'), async (req, res, next) => {
    try {
      const { scope, canManage } = context(req);
      const parsed = validate(deliveryQuerySchema, req.query);
      if (!parsed.ok) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Invalid filter', parsed.errors);
      }
      res.status(200).json(await admin.health(scope, parsed.data, canManage));
    } catch (error) {
      next(error);
    }
  });

  /**
   * Replay a dead letter (blueprint 12.2).
   *
   * The service refuses anything that is not a dead letter, so a caller who
   * crafts the request against a permanently-failed row gets a 409 rather than
   * a pointless send. The UI hides the button for those rows; this is what
   * makes hiding it sufficient.
   */
  router.post(
    '/:deliveryId/replay',
    withWorkspace,
    requireCapability('settings.delivery.write'),
    async (req, res, next) => {
      try {
        const { scope } = context(req);
        const deliveryId = objectId(pathParam(req.params.deliveryId), 'Delivery');
        const result = await deliveries.replay(scope, deliveryId);

        if ('error' in result) {
          if (result.error === 'not_found') {
            throw new ApiError(ERROR_CODES.NOT_FOUND, 'Delivery not found');
          }
          throw new ApiError(
            ERROR_CODES.CONFLICT,
            'Only a delivery that gave up after repeated failures can be replayed',
          );
        }

        await workers.enqueue(
          {
            workspaceId: scope.workspaceId.toHexString(),
            deliveryId: result.delivery._id.toHexString(),
            type: result.delivery.type,
          },
          result.delivery.idempotencyKey,
        );

        res.status(202).json({ deliveryId: result.delivery._id.toHexString(), status: 'queued' });
      } catch (error) {
        next(error);
      }
    },
  );

  // ------------------------------------------------------------ webhooks

  router.get(
    '/webhooks',
    withWorkspace,
    requireCapability('settings.delivery.write'),
    async (req, res, next) => {
      try {
        const { scope } = context(req);
        res.status(200).json({ endpoints: await admin.listWebhooks(scope) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/webhooks',
    withWorkspace,
    requireCapability('settings.delivery.write'),
    async (req, res, next) => {
      try {
        const { scope, actor } = context(req);
        const parsed = validate(createWebhookSchema, req.body);
        if (!parsed.ok) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Invalid endpoint', parsed.errors);
        }

        const result = await admin.createWebhook(
          scope,
          parsed.data.url,
          parsed.data.widgetId,
          actor,
        );
        if (result.kind === 'rejected') {
          // The specific reason is returned: a customer who pasted an internal
          // URL needs to know WHY it was refused, and the reason names a class
          // of address rather than anything about our network.
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, describeRejection(result.reason), [
            { path: 'url', message: describeRejection(result.reason) },
          ]);
        }

        res.status(201).json({
          endpoint: result.endpoint,
          secret: result.secret,
          notice:
            'Copy this signing secret now. It is encrypted at rest and cannot be shown again.',
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/webhooks/:endpointId/rotate',
    withWorkspace,
    requireCapability('settings.delivery.write'),
    async (req, res, next) => {
      try {
        const { scope, actor } = context(req);
        const result = await admin.rotateWebhookSecret(
          scope,
          objectId(pathParam(req.params.endpointId), 'Endpoint'),
          actor,
        );
        if (result.kind === 'not_found') {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Endpoint not found');
        }
        res.status(200).json({
          endpoint: result.endpoint,
          secret: result.secret,
          notice:
            'Copy this secret now. The previous one keeps working for 24 hours so you can migrate.',
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    '/webhooks/:endpointId',
    withWorkspace,
    requireCapability('settings.delivery.write'),
    async (req, res, next) => {
      try {
        const { scope } = context(req);
        const parsed = validate(updateWebhookSchema, req.body);
        if (!parsed.ok) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Invalid change', parsed.errors);
        }
        if (parsed.data.enabled === undefined) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Nothing to change');
        }
        const updated = await admin.setWebhookEnabled(
          scope,
          objectId(pathParam(req.params.endpointId), 'Endpoint'),
          parsed.data.enabled,
        );
        if (!updated) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Endpoint not found');
        res.status(200).json({ status: 'ok' });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/webhooks/:endpointId',
    withWorkspace,
    requireCapability('settings.delivery.write'),
    async (req, res, next) => {
      try {
        const { scope, actor } = context(req);
        const removed = await admin.deleteWebhook(
          scope,
          objectId(pathParam(req.params.endpointId), 'Endpoint'),
          actor,
        );
        if (!removed) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Endpoint not found');
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  // ------------------------------------------ per-widget notification setup

  router.get(
    '/widgets/:widgetId/notifications',
    withWorkspace,
    requireCapability('settings.delivery.write'),
    async (req, res, next) => {
      try {
        const { scope } = context(req);
        const settings = await admin.notificationSettings(
          scope,
          objectId(pathParam(req.params.widgetId), 'Widget'),
        );
        if (settings === null) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Widget not found');
        res.status(200).json(settings);
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/widgets/:widgetId/notifications',
    withWorkspace,
    requireCapability('settings.delivery.write'),
    async (req, res, next) => {
      try {
        const { scope, actor } = context(req);
        const parsed = validate(updateNotificationSettingsSchema, req.body);
        if (!parsed.ok) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Invalid settings', parsed.errors);
        }
        const result = await admin.updateNotificationSettings(
          scope,
          objectId(pathParam(req.params.widgetId), 'Widget'),
          {
            ...(parsed.data.template === undefined ? {} : { template: parsed.data.template }),
            ...(parsed.data.confirmationEnabled === undefined
              ? {}
              : { confirmationEnabled: parsed.data.confirmationEnabled }),
          },
          actor,
        );
        if (result.kind === 'invalid') {
          throw new ApiError(
            ERROR_CODES.VALIDATION_FAILED,
            `Unknown placeholder: ${result.unknown.join(', ')}`,
            result.unknown.map((name) => ({
              path: 'template',
              message: `{{${name}}} is not a variable you can use here`,
            })),
          );
        }
        res.status(200).json({ status: 'ok' });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/widgets/:widgetId/recipients',
    withWorkspace,
    requireCapability('settings.delivery.write'),
    async (req, res, next) => {
      try {
        const { scope, actor } = context(req);
        const parsed = validate(addRecipientSchema, req.body);
        if (!parsed.ok) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Invalid address', parsed.errors);
        }
        const result = await admin.addRecipient(
          scope,
          objectId(pathParam(req.params.widgetId), 'Widget'),
          parsed.data.email,
          actor,
        );
        if (result.kind === 'duplicate') {
          throw new ApiError(ERROR_CODES.CONFLICT, 'That address is already on this list');
        }
        res.status(201).json({ recipient: result.recipient });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/recipients/:recipientId',
    withWorkspace,
    requireCapability('settings.delivery.write'),
    async (req, res, next) => {
      try {
        const { scope, actor } = context(req);
        const removed = await admin.removeRecipient(
          scope,
          objectId(pathParam(req.params.recipientId), 'Recipient'),
          actor,
        );
        if (!removed) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Recipient not found');
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

/**
 * Turn an SSRF rejection into something a customer can act on.
 *
 * Each message names what is wrong with THEIR url, and none of them describes
 * our network - "that address is inside a private network" is actionable and
 * tells an attacker nothing they did not already supply.
 */
function describeRejection(reason: string): string {
  switch (reason) {
    case 'https_required':
      return 'Webhook URLs must use https';
    case 'invalid_url':
      return 'That is not a valid URL';
    case 'scheme_not_allowed':
      return 'Only http and https URLs are supported';
    case 'credentials_in_url':
      return 'Remove the username and password from the URL, and use the signing secret instead';
    case 'port_not_allowed':
      return 'Only ports 80, 443, 8080, and 8443 are allowed';
    case 'hostname_not_resolvable':
      return 'That hostname does not resolve';
    case 'loopback_address':
      return 'That address points back at the server itself';
    case 'link_local_address':
    case 'metadata_service':
      return 'That address is reserved for internal infrastructure';
    case 'private_address':
      return 'That address is inside a private network we cannot reach';
    default:
      return 'That destination is not allowed';
  }
}
