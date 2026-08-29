import { randomBytes, createHash } from 'node:crypto';
import type { WithId } from 'mongodb';
import { ObjectId } from 'mongodb';
import {
  COLLECTIONS,
  type DeliveryRecord,
  type DeliveryRepository,
  type DeliveryStatus,
  type DeliveryType,
  type NotificationRecipientRecord,
  type NotificationRecipientRepository,
  type UserRepository,
  type WebhookEndpointRecord,
  type WebhookEndpointRepository,
  type WidgetRecord,
  type WorkspaceScope,
} from '@lcp/database';
import type {
  DeliveryHealth,
  DeliveryQuery,
  DeliverySummary,
  Logger,
  NotificationSettings,
  NotificationTemplateInput,
  RecipientSummary,
  WebhookEndpointSummary,
} from '@lcp/contracts';
import {
  DEFAULT_NOTIFICATION_TEMPLATE,
  TEMPLATE_VARIABLES,
  unknownVariables,
} from '../../domain/delivery/templates.js';
import { checkDestination } from '../../domain/delivery/ssrf.js';
import type { Resolver } from '../../domain/delivery/ssrf.js';
import type { SecretCipher } from '../../ports/secret-cipher.js';
import type { Clock } from '../../ports/clock.js';
import type { RedisEmailBudget } from '../../infrastructure/redis/email-budget.js';
import { BREVO_DAILY_BUDGET, SIDE_EFFECT_CAP } from '../../infrastructure/redis/email-budget.js';
import type { EmailSender } from '../../ports/email-sender.js';
import type { WorkspaceAuditPort } from '../workspace/types.js';
import type { Db } from 'mongodb';

/**
 * Delivery configuration and the workspace health view (blueprint 12.3, 12.4,
 * 16.4).
 *
 * The workspace-level half of 16.4 only. The platform-operator diagnostics -
 * Upstash usage trend, Mongo migration state, retention sweep status - depend
 * on stages that do not exist yet and are deliberately absent rather than
 * faked.
 */

/** How long a rotated-out webhook secret keeps working (blueprint 12.4). */
export const SECRET_OVERLAP_HOURS = 24;

/** How long an external recipient has to confirm their address. */
const RECIPIENT_TOKEN_TTL_HOURS = 48;

export interface DeliveryAdminDeps {
  readonly db: Db;
  readonly deliveries: DeliveryRepository;
  readonly webhooks: WebhookEndpointRepository;
  readonly recipients: NotificationRecipientRepository;
  readonly users: UserRepository;
  readonly budget: RedisEmailBudget;
  readonly email: EmailSender;
  readonly cipher: SecretCipher;
  readonly audit: WorkspaceAuditPort;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly appBaseUrl: string;
  readonly requireHttps: boolean;
  readonly resolver: Resolver;
}

export interface Actor {
  readonly userId: ObjectId;
  readonly correlationId: string;
}

export class DeliveryAdminService {
  readonly #deps: DeliveryAdminDeps;

  constructor(deps: DeliveryAdminDeps) {
    this.#deps = deps;
  }

  // ------------------------------------------------------------- health

  async health(
    scope: WorkspaceScope,
    query: DeliveryQuery,
    canManage: boolean,
  ): Promise<DeliveryHealth> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter['status'] = query.status;
    if (query.type !== undefined) filter['type'] = query.type;

    const [rows, counts, byType, usage] = await Promise.all([
      this.#deps.deliveries.listRecent(scope, filter, query.limit),
      this.#deps.deliveries.countsByStatus(scope),
      this.#deps.deliveries.countsByType(scope),
      this.#deps.budget.usage(this.#deps.clock.now()),
    ]);

    return {
      counts: fill(counts, [
        'queued',
        'delayed',
        'retrying',
        'delivered',
        'failed',
        'dead_letter',
      ]) as DeliveryHealth['counts'],
      byType: fill(byType, [
        'workspace_notification',
        'visitor_confirmation',
        'webhook',
      ]) as DeliveryHealth['byType'],
      deliveries: rows.map(toSummary),
      emailBudget: {
        usedToday: usage.total,
        sideEffectUsedToday: usage.sideEffect,
        dailyLimit: BREVO_DAILY_BUDGET,
        sideEffectLimit: SIDE_EFFECT_CAP,
      },
      canManage,
    };
  }

  // ------------------------------------------------------------ webhooks

  async listWebhooks(scope: WorkspaceScope): Promise<readonly WebhookEndpointSummary[]> {
    const rows = await this.#deps.webhooks.listAll(scope);
    return rows.map((row) => this.#toWebhookSummary(row));
  }

  /**
   * Add an endpoint.
   *
   * The destination is validated at SAVE time as well as before every request.
   * Saving is where a customer can be told what is wrong; the pre-request check
   * is where safety is actually enforced, because DNS can change afterwards.
   */
  async createWebhook(
    scope: WorkspaceScope,
    url: string,
    widgetId: string | null | undefined,
    actor: Actor,
  ): Promise<
    | { readonly kind: 'ok'; readonly endpoint: WebhookEndpointSummary; readonly secret: string }
    | { readonly kind: 'rejected'; readonly reason: string }
  > {
    const check = await checkDestination(url, this.#deps.requireHttps, this.#deps.resolver);
    if (!check.ok) return { kind: 'rejected', reason: check.reason };

    const secret = generateSecret();
    const now = this.#deps.clock.now();

    const endpoint = await this.#deps.webhooks.insert(scope, {
      widgetId: widgetId === undefined || widgetId === null ? null : new ObjectId(widgetId),
      url: check.url.toString(),
      enabled: true,
      secret: this.#deps.cipher.encrypt(secret),
      secretVersion: 1,
      previousSecret: null,
      previousSecretRetiresAt: null,
      lastRotatedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await this.#deps.audit.record(scope, {
      type: 'webhook.created',
      actorUserId: actor.userId,
      correlationId: actor.correlationId,
      // The host, never the full URL - a path can carry a token.
      metadata: { host: check.url.host, endpointId: endpoint._id.toHexString() },
    });

    return { kind: 'ok', endpoint: this.#toWebhookSummary(endpoint), secret };
  }

  /**
   * Rotate a signing secret with an overlap window (blueprint 12.4).
   *
   * The OLD secret keeps working for 24 hours and both signatures are sent
   * during that window, so a receiver can redeploy at their own pace instead of
   * having to switch at the same instant we do. Without the overlap, rotation
   * would mean guaranteed dropped payloads for anyone not watching.
   */
  async rotateWebhookSecret(
    scope: WorkspaceScope,
    endpointId: ObjectId,
    actor: Actor,
  ): Promise<
    | { readonly kind: 'ok'; readonly endpoint: WebhookEndpointSummary; readonly secret: string }
    | { readonly kind: 'not_found' }
  > {
    const existing = await this.#deps.webhooks.findById(scope, endpointId);
    if (existing === null) return { kind: 'not_found' };

    const secret = generateSecret();
    const now = this.#deps.clock.now();
    const retiresAt = new Date(now.getTime() + SECRET_OVERLAP_HOURS * 3600_000);

    await this.#deps.webhooks.updateById(scope, endpointId, {
      secret: this.#deps.cipher.encrypt(secret),
      secretVersion: existing.secretVersion + 1,
      previousSecret: existing.secret,
      previousSecretRetiresAt: retiresAt,
      lastRotatedAt: now,
      updatedAt: now,
    });

    await this.#deps.audit.record(scope, {
      type: 'webhook.secret_rotated',
      actorUserId: actor.userId,
      correlationId: actor.correlationId,
      metadata: {
        endpointId: endpointId.toHexString(),
        newVersion: existing.secretVersion + 1,
        overlapUntil: retiresAt.toISOString(),
      },
    });

    const updated = await this.#deps.webhooks.findById(scope, endpointId);
    if (updated === null) return { kind: 'not_found' };
    return { kind: 'ok', endpoint: this.#toWebhookSummary(updated), secret };
  }

  async setWebhookEnabled(
    scope: WorkspaceScope,
    endpointId: ObjectId,
    enabled: boolean,
  ): Promise<boolean> {
    return this.#deps.webhooks.updateById(scope, endpointId, {
      enabled,
      updatedAt: this.#deps.clock.now(),
    });
  }

  async deleteWebhook(scope: WorkspaceScope, endpointId: ObjectId, actor: Actor): Promise<boolean> {
    const removed = await this.#deps.webhooks.deleteById(scope, endpointId);
    if (removed) {
      await this.#deps.audit.record(scope, {
        type: 'webhook.deleted',
        actorUserId: actor.userId,
        correlationId: actor.correlationId,
        metadata: { endpointId: endpointId.toHexString() },
      });
    }
    return removed;
  }

  #toWebhookSummary(row: WithId<WebhookEndpointRecord>): WebhookEndpointSummary {
    const overlapLive =
      row.previousSecretRetiresAt !== null &&
      row.previousSecretRetiresAt.getTime() > this.#deps.clock.now().getTime();
    return {
      id: row._id.toHexString(),
      url: row.url,
      widgetId: row.widgetId?.toHexString() ?? null,
      enabled: row.enabled,
      secretVersion: row.secretVersion,
      rotationInProgress: overlapLive,
      previousSecretRetiresAt: row.previousSecretRetiresAt?.toISOString() ?? null,
      lastRotatedAt: row.lastRotatedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------- notification setup

  async notificationSettings(
    scope: WorkspaceScope,
    widgetId: ObjectId,
  ): Promise<NotificationSettings | null> {
    const widget = await this.#deps.db
      .collection<WidgetRecord>(COLLECTIONS.widgets)
      .findOne({ _id: widgetId, workspaceId: scope.workspaceId });
    if (widget === null) return null;

    const recipients = await this.#deps.recipients.listForWidget(scope, widgetId);
    const stored = widget.notificationTemplate;

    /**
     * A widget that was never configured shows the DEFAULT copy rather than an
     * empty form. That is what the send path would actually use, so the page
     * shows the truth instead of implying nothing is set - and somebody who
     * wants to tweak the wording starts from working text, not a blank box.
     *
     * The record stores `null` for the optional fields; the wire contract omits
     * them, because a form posts an empty string and never a null.
     */
    const template =
      stored === null
        ? DEFAULT_NOTIFICATION_TEMPLATE
        : {
            subject: stored.subject,
            body: stored.body,
            ...(stored.replyTo === null ? {} : { replyTo: stored.replyTo }),
            ...(stored.brandName === null ? {} : { brandName: stored.brandName }),
          };

    return {
      template,
      recipients: recipients.map(toRecipientSummary),
      availableVariables: [...TEMPLATE_VARIABLES],
      confirmationEnabled: widget.confirmationEnabled,
    };
  }

  async updateNotificationSettings(
    scope: WorkspaceScope,
    widgetId: ObjectId,
    input: { template?: NotificationTemplateInput; confirmationEnabled?: boolean },
    actor: Actor,
  ): Promise<
    { readonly kind: 'ok' } | { readonly kind: 'invalid'; readonly unknown: readonly string[] }
  > {
    if (input.template !== undefined) {
      /**
       * Reject an unknown placeholder rather than rendering it as empty.
       *
       * At SAVE time a customer is present to be told; at SEND time they are
       * not, and an email that silently dropped `{{contact.nmae}}` would look
       * like the product losing data.
       */
      const unknown = [
        ...unknownVariables(input.template.subject),
        ...unknownVariables(input.template.body),
      ];
      if (unknown.length > 0) return { kind: 'invalid', unknown: [...new Set(unknown)] };
    }

    const set: Record<string, unknown> = { updatedAt: this.#deps.clock.now() };
    if (input.template !== undefined) {
      set['notificationTemplate'] = {
        subject: input.template.subject,
        body: input.template.body,
        replyTo: input.template.replyTo ?? null,
        brandName: input.template.brandName ?? null,
      };
    }
    if (input.confirmationEnabled !== undefined) {
      set['confirmationEnabled'] = input.confirmationEnabled;
    }

    await this.#deps.db
      .collection<WidgetRecord>(COLLECTIONS.widgets)
      .updateOne({ _id: widgetId, workspaceId: scope.workspaceId }, { $set: set as never });

    await this.#deps.audit.record(scope, {
      type: 'delivery.settings_changed',
      actorUserId: actor.userId,
      correlationId: actor.correlationId,
      metadata: { widgetId: widgetId.toHexString(), fields: Object.keys(set) },
    });

    return { kind: 'ok' };
  }

  // ------------------------------------------------------------ recipients

  /**
   * Add a recipient (blueprint 12.3).
   *
   * A workspace member's address is trusted immediately - they already proved
   * it to join. Any other address gets a hashed, expiring confirmation token
   * and is NOT emailed leads until it is confirmed. Without that, the settings
   * form would be a way to point a stream of somebody else's leads at any
   * address an attacker typed.
   */
  async addRecipient(
    scope: WorkspaceScope,
    widgetId: ObjectId,
    email: string,
    actor: Actor,
  ): Promise<
    { readonly kind: 'ok'; readonly recipient: RecipientSummary } | { readonly kind: 'duplicate' }
  > {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.#deps.recipients.findByNormalizedEmail(
      scope,
      widgetId,
      normalizedEmail,
    );
    if (existing !== null) return { kind: 'duplicate' };

    const member = await this.#deps.users.findByEmail(normalizedEmail);
    const isMember =
      member !== null &&
      member.emailVerifiedAt !== null &&
      (await this.#deps.db.collection(COLLECTIONS.memberships).countDocuments({
        workspaceId: scope.workspaceId,
        userId: member._id,
      })) > 0;

    const now = this.#deps.clock.now();

    if (isMember && member !== null) {
      const record = await this.#deps.recipients.insert(scope, {
        widgetId,
        email: member.email,
        normalizedEmail,
        kind: 'workspace_user',
        userId: member._id,
        verifiedAt: now,
        verification: null,
        createdAt: now,
        updatedAt: now,
      });
      return { kind: 'ok', recipient: toRecipientSummary(record) };
    }

    const token = randomBytes(32).toString('base64url');
    const record = await this.#deps.recipients.insert(scope, {
      widgetId,
      email: email.trim(),
      normalizedEmail,
      kind: 'external',
      userId: null,
      verifiedAt: null,
      verification: {
        tokenHash: sha256(token),
        issuedAt: now,
        expiresAt: new Date(now.getTime() + RECIPIENT_TOKEN_TTL_HOURS * 3600_000),
      },
      createdAt: now,
      updatedAt: now,
    });

    const confirmUrl = `${this.#deps.appBaseUrl}/workspace/delivery/confirm?token=${token}`;
    /**
     * Critical priority: this is a verification email, not a side effect, and
     * blueprint 5.3 reserves the allowance for exactly that. Sending it as a
     * side effect would let a busy day of lead notifications stop people
     * confirming their address.
     */
    await this.#deps.email.send({
      to: email.trim(),
      subject: 'Confirm you want lead notifications',
      priority: 'critical',
      text: `Confirm this address to start receiving lead notifications.\n\n${confirmUrl}\n\nIf you did not expect this, ignore this email and nothing will be sent.`,
      html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5"><p>Confirm this address to start receiving lead notifications.</p><p><a href="${confirmUrl}">Confirm this address</a></p><p style="color:#666;font-size:13px">If you did not expect this, ignore this email and nothing will be sent.</p></body></html>`,
    });

    await this.#deps.audit.record(scope, {
      type: 'delivery.recipient_added',
      actorUserId: actor.userId,
      correlationId: actor.correlationId,
      metadata: { widgetId: widgetId.toHexString(), kind: 'external' },
    });

    return { kind: 'ok', recipient: toRecipientSummary(record) };
  }

  /** Redeem a recipient confirmation token. */
  async confirmRecipient(token: string): Promise<boolean> {
    const tokenHash = sha256(token);
    const now = this.#deps.clock.now();
    const result = await this.#deps.db
      .collection<NotificationRecipientRecord>(COLLECTIONS.notificationRecipients)
      .findOneAndUpdate(
        {
          'verification.tokenHash': tokenHash,
          'verification.expiresAt': { $gt: now },
          verifiedAt: null,
        },
        { $set: { verifiedAt: now, verification: null, updatedAt: now } as never },
      );
    return result !== null;
  }

  async removeRecipient(
    scope: WorkspaceScope,
    recipientId: ObjectId,
    actor: Actor,
  ): Promise<boolean> {
    const removed = await this.#deps.recipients.deleteById(scope, recipientId);
    if (removed) {
      await this.#deps.audit.record(scope, {
        type: 'delivery.recipient_removed',
        actorUserId: actor.userId,
        correlationId: actor.correlationId,
        metadata: { recipientId: recipientId.toHexString() },
      });
    }
    return removed;
  }
}

// ---------------------------------------------------------------------------

function fill(counts: Record<string, number>, keys: readonly string[]): Record<string, number> {
  return Object.fromEntries(keys.map((key) => [key, counts[key] ?? 0]));
}

export function toSummary(row: WithId<DeliveryRecord>): DeliverySummary {
  return {
    id: row._id.toHexString(),
    type: row.type as DeliveryType,
    status: row.status as DeliveryStatus,
    target: row.target,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    contactId: row.contactId?.toHexString() ?? null,
    history: row.history.map((entry) => ({
      attempt: entry.attempt,
      at: entry.at.toISOString(),
      outcome: entry.outcome,
      detail: entry.detail,
      statusCode: entry.statusCode,
    })),
    /**
     * Decided by the SERVER, not by the UI reading a status string. Only a
     * dead letter - a transient failure that ran out of attempts - is worth
     * replaying; a permanent rejection would just be rejected again.
     */
    canReplay: row.status === 'dead_letter',
  };
}

function toRecipientSummary(row: WithId<NotificationRecipientRecord>): RecipientSummary {
  return {
    id: row._id.toHexString(),
    email: row.email,
    kind: row.kind,
    verified: row.verifiedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

function generateSecret(): string {
  // 32 bytes of entropy, prefixed so a leaked value is recognisable in a log
  // scan and can be revoked without guessing what it is.
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
