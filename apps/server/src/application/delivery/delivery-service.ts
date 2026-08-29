import type { Db, WithId } from 'mongodb';
import type { ObjectId } from 'mongodb';
import {
  COLLECTIONS,
  type DeliveryAttempt,
  type DeliveryRecord,
  type DeliveryStatus,
  type DeliveryType,
  type NotificationRecipientRecord,
  type SubmissionEventRecord,
  type WebhookEndpointRecord,
  type WidgetRecord,
  type WorkspaceScope,
  type ContactRecord,
  type WorkspaceRecord,
  type DeliveryRepository,
  type NotificationRecipientRepository,
  type OutboxRepository,
  type WebhookEndpointRepository,
} from '@lcp/database';
import type { Logger } from '@lcp/contracts';
import {
  classifyHttpStatus,
  classifyTransportError,
  nextAttemptAt,
  shouldRetry,
  terminalStatus,
  MAX_ATTEMPTS,
  type FailureKind,
} from '../../domain/delivery/retry.js';
import {
  confirmationKey,
  maskEmail,
  notificationKey,
  replayKey,
  webhookKey,
} from '../../domain/delivery/keys.js';
import {
  DEFAULT_NOTIFICATION_TEMPLATE,
  renderTemplate,
  type TemplateValues,
} from '../../domain/delivery/templates.js';
import {
  signPayload,
  signatureHeader,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '../../domain/delivery/signing.js';
import type { EmailSender } from '../../ports/email-sender.js';
import type { WebhookClient } from '../../ports/webhook-client.js';
import type { SecretCipher } from '../../ports/secret-cipher.js';
import type { Clock } from '../../ports/clock.js';
import type { EventPublisher } from '../../ports/event-publisher.js';

/**
 * The side-effect engine (blueprint 12.1-12.4).
 *
 * Everything here is STRICTLY downstream of an already-committed submission.
 * Stage 7 writes the Contact, the immutable SubmissionEvent, and the durable
 * OutboxEvent in one transaction and returns 202 to the visitor; nothing in
 * this file can reach back and change any of that. That is not a convention -
 * it is why the exit gate's first clause ("forced provider failures never fail
 * a submission") is structurally true rather than carefully maintained.
 */

/** Blueprint 9.5: delivery logs are kept 90 days. */
const RETENTION_DAYS = 90;

export interface DeliveryPlanItem {
  readonly type: DeliveryType;
  readonly idempotencyKey: string;
  readonly target: string;
  readonly recipientEmail: string | null;
  readonly webhookEndpointId: ObjectId | null;
}

export interface DeliveryServiceDeps {
  readonly db: Db;
  readonly deliveries: DeliveryRepository;
  readonly outbox: OutboxRepository;
  readonly recipients: NotificationRecipientRepository;
  readonly webhooks: WebhookEndpointRepository;
  readonly email: EmailSender;
  readonly webhookClient: WebhookClient;
  readonly cipher: SecretCipher;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly appBaseUrl: string;
  /**
   * Live dashboard fan-out (blueprint 13.1), added in Stage 10a.
   *
   * A port that never throws: a delivery's outcome is already durable in Mongo
   * before this is called, so a fan-out failure must not turn a recorded
   * attempt into a thrown one.
   */
  readonly events: EventPublisher;
}

export type DeliveryExecution =
  | { readonly kind: 'delivered' }
  | { readonly kind: 'deferred'; readonly reason: string }
  | {
      readonly kind: 'failed';
      readonly failure: FailureKind;
      readonly detail: string;
      readonly statusCode: number | null;
    };

export class DeliveryService {
  readonly #deps: DeliveryServiceDeps;

  constructor(deps: DeliveryServiceDeps) {
    this.#deps = deps;
  }

  // ------------------------------------------------------------ planning

  /**
   * Work out every side effect one accepted submission owes.
   *
   * Fan-out happens HERE rather than inside a single job, so each recipient and
   * each endpoint gets its own Delivery row with its own idempotency key and
   * its own retry budget. A team notification that bounces for one colleague
   * must not stop the other three from arriving, and a webhook receiver that is
   * down must not hold up the email.
   */
  async planFor(
    scope: WorkspaceScope,
    submission: WithId<SubmissionEventRecord>,
    widget: WithId<WidgetRecord>,
  ): Promise<readonly DeliveryPlanItem[]> {
    const plan: DeliveryPlanItem[] = [];
    const submissionId = submission._id.toHexString();

    const verified = await this.#deps.recipients.listVerifiedForWidget(scope, widget._id);
    for (const recipient of verified) {
      plan.push({
        type: 'workspace_notification',
        idempotencyKey: notificationKey(submissionId, recipient.normalizedEmail),
        target: maskEmail(recipient.email),
        recipientEmail: recipient.email,
        webhookEndpointId: null,
      });
    }

    /**
     * The visitor's own confirmation.
     *
     * Only when the widget asks for it AND the submission actually carried an
     * email - a CTA widget may not collect one, and sending to an empty string
     * would be a guaranteed permanent failure per submission.
     */
    const visitorEmail = (submission.values['email'] ?? '').trim();
    if (widget.confirmationEnabled && visitorEmail !== '') {
      plan.push({
        type: 'visitor_confirmation',
        idempotencyKey: confirmationKey(submissionId),
        target: maskEmail(visitorEmail),
        recipientEmail: visitorEmail,
        webhookEndpointId: null,
      });
    }

    const endpoints = await this.#deps.webhooks.listForWidget(scope, widget._id);
    for (const endpoint of endpoints) {
      plan.push({
        type: 'webhook',
        idempotencyKey: webhookKey(submissionId, endpoint._id.toHexString()),
        target: hostOf(endpoint.url),
        recipientEmail: null,
        webhookEndpointId: endpoint._id,
      });
    }

    return plan;
  }

  /**
   * Create a Delivery row, or return the one that already exists.
   *
   * The unique index on `(workspaceId, idempotencyKey)` is what makes this
   * safe to call from three places that cannot see each other: the submission
   * path, a queue retry, and the outbox reconciler. A duplicate insert is
   * caught and the existing row returned, so re-running reconciliation over
   * work that already happened is a no-op rather than a second email.
   */
  async ensureDelivery(
    scope: WorkspaceScope,
    item: DeliveryPlanItem,
    context: {
      readonly outboxEventId: ObjectId | null;
      readonly contactId: ObjectId | null;
      readonly submissionEventId: ObjectId | null;
      readonly widgetId: ObjectId | null;
      readonly replayOfId?: ObjectId;
    },
  ): Promise<{ readonly delivery: WithId<DeliveryRecord>; readonly created: boolean }> {
    const now = this.#deps.clock.now();
    const existing = await this.#deps.deliveries.findByIdempotencyKey(scope, item.idempotencyKey);
    if (existing !== null) return { delivery: existing, created: false };

    const record: Omit<DeliveryRecord, '_id' | 'workspaceId'> = {
      type: item.type,
      status: 'queued',
      outboxEventId: context.outboxEventId,
      contactId: context.contactId,
      submissionEventId: context.submissionEventId,
      widgetId: context.widgetId,
      webhookEndpointId: item.webhookEndpointId,
      idempotencyKey: item.idempotencyKey,
      target: item.target,
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      nextAttemptAt: now,
      deliveredAt: null,
      lastError: null,
      history: [],
      alertedAt: null,
      replayOfId: context.replayOfId ?? null,
      expiresAt: new Date(now.getTime() + RETENTION_DAYS * 86_400_000),
      createdAt: now,
      updatedAt: now,
    };

    try {
      const inserted = await this.#deps.deliveries.insert(scope, record);
      return { delivery: inserted, created: true };
    } catch (error) {
      // A concurrent insert won the unique index. That is the index doing its
      // job, not an error: re-read and use the row that landed.
      if (isDuplicateKey(error)) {
        const raced = await this.#deps.deliveries.findByIdempotencyKey(scope, item.idempotencyKey);
        if (raced !== null) return { delivery: raced, created: false };
      }
      throw error;
    }
  }

  // ----------------------------------------------------------- execution

  /**
   * Attempt one delivery and record what happened.
   *
   * Never throws for a delivery failure - it returns the outcome, and the
   * caller (the worker) decides whether to tell BullMQ to retry. Throwing
   * would conflate "the receiver said no" with "this process broke".
   */
  async attempt(scope: WorkspaceScope, deliveryId: ObjectId): Promise<DeliveryExecution> {
    const now = this.#deps.clock.now();
    const claimed = await this.#deps.deliveries.claimForAttempt(scope, deliveryId, now);
    if (claimed === null) {
      // Already delivered or permanently failed. A duplicate job for settled
      // work is exactly what idempotency is supposed to absorb.
      return { kind: 'delivered' };
    }
    if (claimed.status === 'delivered') return { kind: 'delivered' };

    const execution = await this.#execute(scope, claimed);
    await this.#record(scope, claimed, execution, now);
    return execution;
  }

  async #execute(
    scope: WorkspaceScope,
    delivery: WithId<DeliveryRecord>,
  ): Promise<DeliveryExecution> {
    try {
      if (delivery.type === 'webhook') return await this.#sendWebhook(scope, delivery);
      return await this.#sendEmail(scope, delivery);
    } catch (error) {
      return {
        kind: 'failed',
        failure: classifyTransportError(error),
        detail: error instanceof Error ? error.message.slice(0, 160) : 'unknown error',
        statusCode: null,
      };
    }
  }

  async #record(
    scope: WorkspaceScope,
    delivery: WithId<DeliveryRecord>,
    execution: DeliveryExecution,
    now: Date,
  ): Promise<void> {
    const attemptNumber = delivery.attempts + 1;

    if (execution.kind === 'delivered') {
      await this.#deps.deliveries.recordAttempt(
        scope,
        delivery._id,
        { attempt: attemptNumber, at: now, outcome: 'delivered', detail: 'ok', statusCode: null },
        { status: 'delivered', nextAttemptAt: null, deliveredAt: now, lastError: null },
      );
      await this.#announce(scope, delivery, 'delivered', attemptNumber, now);
      await this.#settleOutbox(scope, delivery);
      return;
    }

    if (execution.kind === 'deferred') {
      /**
       * The daily budget is spent (blueprint 5.3). This is not a failure and
       * must not consume a retry attempt: "excess non-critical email remains
       * queued until the next provider allowance window". The row goes back to
       * delayed with tomorrow's window as its next attempt, and `attempts` is
       * left where it was.
       */
      await this.#deps.deliveries.recordAttempt(
        scope,
        delivery._id,
        {
          attempt: delivery.attempts,
          at: now,
          outcome: 'deferred',
          detail: execution.reason,
          statusCode: null,
        },
        {
          status: 'delayed',
          nextAttemptAt: nextBudgetWindow(now),
          deliveredAt: null,
          lastError: execution.reason,
        },
      );
      await this.#announce(scope, delivery, 'delayed', delivery.attempts, now);
      return;
    }

    const retrying = shouldRetry(execution.failure, attemptNumber);
    const status: DeliveryStatus = retrying ? 'delayed' : terminalStatus(execution.failure);

    const attempt: DeliveryAttempt = {
      attempt: attemptNumber,
      at: now,
      outcome: execution.failure === 'permanent' ? 'permanent_failure' : 'transient_failure',
      detail: execution.detail,
      statusCode: execution.statusCode,
    };

    await this.#deps.deliveries.recordAttempt(scope, delivery._id, attempt, {
      status,
      nextAttemptAt: retrying ? nextAttemptAt(attemptNumber, now) : null,
      deliveredAt: null,
      lastError: execution.detail,
    });

    await this.#announce(scope, delivery, status, attemptNumber, now);

    if (!retrying) {
      this.#deps.logger.warn('delivery.terminal', {
        result: 'server_error',
        deliveryType: delivery.type,
        status,
        attempts: attemptNumber,
        // Target is already masked; detail is provider text, never lead data.
        target: delivery.target,
        reason: execution.detail,
      });
      await this.#settleOutbox(scope, delivery);
    }
  }

  /**
   * Tell the workspace's open dashboards that a delivery moved
   * (blueprint 13.1: "delivery status changed").
   *
   * Structural detail only - the id, the kind, the state, and the attempt
   * count. The masked target is deliberately left out: an SSE frame reaches
   * every open tab in the workspace, and a recipient address does not need to
   * be broadcast to be useful there. The dashboard fetches what it needs by id.
   */
  async #announce(
    scope: WorkspaceScope,
    delivery: WithId<DeliveryRecord>,
    status: DeliveryStatus,
    attempts: number,
    now: Date,
  ): Promise<void> {
    await this.#deps.events.publish(
      scope.workspaceId.toHexString(),
      'delivery.status_changed',
      {
        deliveryId: delivery._id.toHexString(),
        type: delivery.type,
        status,
        attempts,
      },
      now,
    );
  }

  /**
   * Close out the outbox row once every delivery it promised has settled.
   *
   * The outbox row is the PROMISE; the deliveries are the attempts to keep it.
   * It stays `processing` while any sibling is still in flight, so the
   * reconciler does not re-enqueue work that is merely slow.
   */
  async #settleOutbox(scope: WorkspaceScope, delivery: WithId<DeliveryRecord>): Promise<void> {
    if (delivery.outboxEventId === null) return;
    const siblings = await this.#deps.deliveries.findMany(scope, {
      outboxEventId: delivery.outboxEventId,
    });
    const unsettled = siblings.filter(
      (row) =>
        row.status !== 'delivered' && row.status !== 'failed' && row.status !== 'dead_letter',
    );
    if (unsettled.length > 0) return;
    await this.#deps.outbox.markSent(scope, delivery.outboxEventId, this.#deps.clock.now());
  }

  // -------------------------------------------------------------- email

  async #sendEmail(
    scope: WorkspaceScope,
    delivery: WithId<DeliveryRecord>,
  ): Promise<DeliveryExecution> {
    const context = await this.#loadContext(scope, delivery);
    if (context === null) {
      return {
        kind: 'failed',
        failure: 'permanent',
        detail: 'the submission this notification referred to no longer exists',
        statusCode: null,
      };
    }

    const recipient = await this.#resolveRecipient(scope, delivery, context);
    if (recipient === null) {
      return {
        kind: 'failed',
        failure: 'permanent',
        detail: 'no verified recipient for this delivery',
        statusCode: null,
      };
    }

    const message =
      delivery.type === 'visitor_confirmation'
        ? buildConfirmationEmail(recipient, context)
        : buildNotificationEmail(recipient, context, this.#deps.appBaseUrl);

    const result = await this.#deps.email.send(message);

    switch (result.status) {
      case 'sent':
        return { kind: 'delivered' };
      case 'deferred':
        return { kind: 'deferred', reason: result.reason };
      case 'failed':
        return {
          kind: 'failed',
          failure: result.permanent ? 'permanent' : 'transient',
          detail: result.reason.slice(0, 160),
          statusCode: null,
        };
    }
  }

  async #resolveRecipient(
    scope: WorkspaceScope,
    delivery: WithId<DeliveryRecord>,
    context: DeliveryContext,
  ): Promise<string | null> {
    if (delivery.type === 'visitor_confirmation') {
      const email = (context.submission.values['email'] ?? '').trim();
      return email === '' ? null : email;
    }

    /**
     * The recipient is re-resolved from the CURRENT verified list rather than
     * stored on the delivery row. A colleague removed from the workspace, or an
     * external address whose verification was revoked, must stop receiving
     * leads immediately - including on a replay of a delivery created while
     * they were still allowed.
     */
    if (context.widget === null) return null;
    const verified = await this.#deps.recipients.listVerifiedForWidget(scope, context.widget._id);
    const match = verified.find(
      (row: WithId<NotificationRecipientRecord>) =>
        notificationKey(context.submission._id.toHexString(), row.normalizedEmail) ===
        delivery.idempotencyKey,
    );
    return match?.email ?? null;
  }

  // ------------------------------------------------------------ webhook

  async #sendWebhook(
    scope: WorkspaceScope,
    delivery: WithId<DeliveryRecord>,
  ): Promise<DeliveryExecution> {
    const context = await this.#loadContext(scope, delivery);
    if (context === null) {
      return {
        kind: 'failed',
        failure: 'permanent',
        detail: 'the submission this webhook referred to no longer exists',
        statusCode: null,
      };
    }

    if (delivery.webhookEndpointId === null) {
      return { kind: 'failed', failure: 'permanent', detail: 'unknown endpoint', statusCode: null };
    }
    const endpoint = await this.#deps.webhooks.findById(scope, delivery.webhookEndpointId);
    if (endpoint === null || !endpoint.enabled) {
      return {
        kind: 'failed',
        failure: 'permanent',
        detail: 'the endpoint was removed or disabled',
        statusCode: null,
      };
    }

    const body = JSON.stringify(buildWebhookPayload(delivery, context));
    const timestamp = Math.floor(this.#deps.clock.now().getTime() / 1000);

    const signatures = this.#signaturesFor(endpoint, timestamp, body);
    if (signatures.length === 0) {
      return {
        kind: 'failed',
        failure: 'permanent',
        detail: 'the signing secret could not be read',
        statusCode: null,
      };
    }

    const result = await this.#deps.webhookClient.send({
      url: endpoint.url,
      body,
      headers: {
        [SIGNATURE_HEADER]: signatureHeader(signatures),
        [TIMESTAMP_HEADER]: String(timestamp),
        'user-agent': 'LeadCapture-Webhook/1',
      },
    });

    switch (result.outcome) {
      case 'delivered':
        return { kind: 'delivered' };
      case 'http_error':
        return {
          kind: 'failed',
          failure: classifyHttpStatus(result.statusCode),
          detail: `receiver returned ${String(result.statusCode)}`,
          statusCode: result.statusCode,
        };
      case 'timeout':
        return {
          kind: 'failed',
          failure: 'transient',
          detail: 'the receiver did not respond in time',
          statusCode: null,
        };
      case 'network_error':
        return {
          kind: 'failed',
          failure: 'transient',
          detail: result.reason,
          statusCode: null,
        };
      case 'blocked':
        /**
         * WE refused, so this is permanent by definition: retrying a blocked
         * destination four more times would just be four more refusals.
         */
        return {
          kind: 'failed',
          failure: 'permanent',
          detail: `destination refused: ${result.reason}`,
          statusCode: null,
        };
    }
  }

  /**
   * Current secret, plus the previous one while a rotation overlap is live.
   *
   * Sending BOTH signatures is what makes rotation non-breaking (blueprint
   * 12.4): a receiver that has already switched to the new secret finds a
   * match, and one that has not yet switched finds the old one, so nobody has
   * to coordinate a cutover instant.
   */
  #signaturesFor(
    endpoint: WithId<WebhookEndpointRecord>,
    timestamp: number,
    body: string,
  ): readonly string[] {
    const signatures: string[] = [];
    const current = this.#deps.cipher.decrypt(endpoint.secret);
    if (current !== null) signatures.push(signPayload(current, timestamp, body));

    const overlapLive =
      endpoint.previousSecret !== null &&
      endpoint.previousSecretRetiresAt !== null &&
      endpoint.previousSecretRetiresAt.getTime() > this.#deps.clock.now().getTime();

    if (overlapLive && endpoint.previousSecret !== null) {
      const previous = this.#deps.cipher.decrypt(endpoint.previousSecret);
      if (previous !== null) signatures.push(signPayload(previous, timestamp, body));
    }
    return signatures;
  }

  /**
   * Claim dead letters that have not yet raised an operator alert.
   *
   * Blueprint 12.2: "A new dead-letter failure raises an operator alert and
   * remains visible in workspace delivery health." The two halves are
   * different: the ALERT is about the transition, so it fires once, and the
   * VISIBILITY is about the state, so it persists. Claiming the rows as they
   * are read is what separates them - without it, every sweep would re-alert
   * on the same backlog and the alert would stop meaning anything.
   *
   * Returns the rows so a caller can notify; the logging here is the current
   * implementation, and a pager integration would attach at the same point.
   */
  async claimDeadLetterAlerts(): Promise<readonly WithId<DeliveryRecord>[]> {
    const claimed = await this.#deps.deliveries.claimUnalertedDeadLetters(this.#deps.clock.now());
    for (const row of claimed) {
      this.#deps.logger.error('delivery.dead_letter_alert', {
        result: 'server_error',
        deliveryType: row.type,
        attempts: row.attempts,
        target: row.target,
        reason: row.lastError ?? 'unknown',
      });
    }
    return claimed;
  }

  // ------------------------------------------------------------- replay

  /**
   * Manually replay a dead letter (blueprint 12.2).
   *
   * Only a dead letter. A `failed` row was rejected permanently - the address
   * does not exist, the receiver returned 400 - and replaying it would spend
   * the allowance to be told the same thing. The UI hides the button for those
   * rows and this refuses them anyway, because the button is not the guard.
   */
  async replay(
    scope: WorkspaceScope,
    deliveryId: ObjectId,
  ): Promise<{ readonly delivery: WithId<DeliveryRecord> } | { readonly error: string }> {
    const original = await this.#deps.deliveries.findById(scope, deliveryId);
    if (original === null) return { error: 'not_found' };
    if (original.status !== 'dead_letter') return { error: 'not_replayable' };

    const replayNumber = (await this.#deps.deliveries.count(scope, { replayOfId: deliveryId })) + 1;
    const { delivery } = await this.ensureDelivery(
      scope,
      {
        type: original.type,
        idempotencyKey: replayKey(deliveryId.toHexString(), replayNumber),
        target: original.target,
        recipientEmail: null,
        // Carried across, or the replay would not know where to send.
        webhookEndpointId: original.webhookEndpointId,
      },
      {
        outboxEventId: original.outboxEventId,
        contactId: original.contactId,
        submissionEventId: original.submissionEventId,
        widgetId: original.widgetId,
        replayOfId: deliveryId,
      },
    );
    return { delivery };
  }

  // ------------------------------------------------------------ context

  async #loadContext(
    scope: WorkspaceScope,
    delivery: WithId<DeliveryRecord>,
  ): Promise<DeliveryContext | null> {
    if (delivery.submissionEventId === null) return null;
    const submission = await this.#deps.db
      .collection<SubmissionEventRecord>(COLLECTIONS.submissionEvents)
      .findOne({ _id: delivery.submissionEventId, workspaceId: scope.workspaceId });
    if (submission === null) return null;

    const [contact, widget, workspace] = await Promise.all([
      delivery.contactId === null
        ? Promise.resolve(null)
        : this.#deps.db
            .collection<ContactRecord>(COLLECTIONS.contacts)
            .findOne({ _id: delivery.contactId, workspaceId: scope.workspaceId }),
      delivery.widgetId === null
        ? Promise.resolve(null)
        : this.#deps.db
            .collection<WidgetRecord>(COLLECTIONS.widgets)
            .findOne({ _id: delivery.widgetId, workspaceId: scope.workspaceId }),
      this.#deps.db
        .collection<WorkspaceRecord>(COLLECTIONS.workspaces)
        .findOne({ _id: scope.workspaceId }),
    ]);

    return { submission, contact, widget, workspace };
  }
}

// ---------------------------------------------------------------------------

interface DeliveryContext {
  readonly submission: WithId<SubmissionEventRecord>;
  readonly contact: WithId<ContactRecord> | null;
  readonly widget: WithId<WidgetRecord> | null;
  readonly workspace: WithId<WorkspaceRecord> | null;
}

/** The values a customer template may reference (blueprint 12.3). */
function templateValues(context: DeliveryContext): TemplateValues {
  const values = context.submission.values;
  return {
    'contact.name': context.contact?.name ?? values['name'] ?? '',
    'contact.email': context.contact?.email ?? values['email'] ?? '',
    'contact.phone': context.contact?.phone ?? values['phone'] ?? '',
    'contact.company': context.contact?.company ?? values['company'] ?? '',
    'submission.message': values['message'] ?? '',
    'submission.pageUrl': context.submission.source.pageUrl ?? '',
    'submission.domain': context.submission.source.domain ?? '',
    'submission.submittedAt': context.submission.submittedAt.toISOString(),
    'widget.name': context.widget?.name ?? '',
    'workspace.name': context.workspace?.name ?? '',
  };
}

function buildNotificationEmail(
  to: string,
  context: DeliveryContext,
  appBaseUrl: string,
): Parameters<EmailSender['send']>[0] {
  const template = context.widget?.notificationTemplate ?? null;
  const values = templateValues(context);

  const subject = renderTemplate(
    template?.subject ?? DEFAULT_NOTIFICATION_TEMPLATE.subject,
    values,
    false,
  );
  const bodyText = renderTemplate(
    template?.body ?? DEFAULT_NOTIFICATION_TEMPLATE.body,
    values,
    false,
  );
  const bodyHtml = renderTemplate(
    template?.body ?? DEFAULT_NOTIFICATION_TEMPLATE.body,
    values,
    true,
  ).replace(/\n/g, '<br>');
  const brand = template?.brandName ?? context.workspace?.name ?? 'Lead Capture';
  const inboxUrl = `${appBaseUrl}/workspace/contacts`;

  return {
    to,
    subject: subject === '' ? 'New lead' : subject,
    // Blueprint 5.3: side effects draw on the capped half of the allowance.
    priority: 'side_effect',
    text: `${bodyText}\n\nSee it in your inbox: ${inboxUrl}\n\n${brand}`,
    html: [
      '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">',
      `<p>${bodyHtml}</p>`,
      `<p><a href="${escapeAttribute(inboxUrl)}">Open your inbox</a></p>`,
      `<p style="color:#666;font-size:13px">${escapeText(brand)}</p>`,
      '</body></html>',
    ].join(''),
  };
}

function buildConfirmationEmail(
  to: string,
  context: DeliveryContext,
): Parameters<EmailSender['send']>[0] {
  const brand = context.widget?.notificationTemplate?.brandName ?? context.workspace?.name ?? '';
  const heading = brand === '' ? 'We received your message' : `${brand} received your message`;
  const body = 'Thanks for getting in touch. Somebody will reply to this address shortly.';
  return {
    to,
    subject: heading,
    priority: 'side_effect',
    text: `${heading}\n\n${body}`,
    html: [
      '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">',
      `<h1 style="font-size:18px">${escapeText(heading)}</h1>`,
      `<p>${escapeText(body)}</p>`,
      '</body></html>',
    ].join(''),
  };
}

/**
 * The webhook payload (blueprint 12.4).
 *
 * "an event ID, version, timestamp, workspace-safe data, and delivery-attempt
 * metadata". Workspace-safe means the lead's own submitted values - the
 * customer is entitled to those, it is their lead - but never another tenant's
 * anything, and never our internal ids beyond the ones they already hold.
 */
function buildWebhookPayload(
  delivery: WithId<DeliveryRecord>,
  context: DeliveryContext,
): Record<string, unknown> {
  return {
    id: delivery._id.toHexString(),
    version: '1',
    type: 'submission.received',
    createdAt: delivery.createdAt.toISOString(),
    attempt: delivery.attempts + 1,
    data: {
      submissionId: context.submission._id.toHexString(),
      contactId: context.contact?._id.toHexString() ?? null,
      widgetId: context.widget?._id.toHexString() ?? null,
      widgetName: context.widget?.name ?? null,
      submittedAt: context.submission.submittedAt.toISOString(),
      values: context.submission.values,
      source: {
        domain: context.submission.source.domain,
        pageUrl: context.submission.source.pageUrl,
      },
      geo: context.submission.geo,
    },
  };
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown host';
  }
}

/**
 * When a budget-deferred email should be tried again.
 *
 * The budget window is a UTC day (see `budgetDayKey`), so the next window
 * opens at the next UTC midnight. Blueprint 5.3: "excess non-critical email
 * remains queued until the next provider allowance window."
 */
function nextBudgetWindow(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: number }).code === 11000
  );
}
