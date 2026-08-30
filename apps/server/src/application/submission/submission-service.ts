import { ObjectId, type ClientSession, type Db, type WithId } from 'mongodb';
import {
  COLLECTIONS,
  workspaceScope,
  type AbuseEventRecord,
  type ConsentEventRecord,
  type ContactRecord,
  type GeoSnapshot,
  type OptInMode,
  type OutboxEventRecord,
  type SubmissionEventRecord,
  type WidgetRecord,
  type WorkspaceRecord,
  type WorkspaceScope,
} from '@lcp/database';
import {
  SUBMISSION_MAX_FIELDS,
  SUBMISSION_MAX_VALUE_LENGTH,
  isOriginAllowed,
  type ApiFieldError,
  type Logger,
  type SubmissionPayload,
  type SuccessOutcome,
  type WidgetConfig,
} from '@lcp/contracts';
import type { Clock } from '../../ports/clock.js';
import type { GeoProvider } from '../../ports/geo-provider.js';
import type { EventPublisher } from '../../ports/event-publisher.js';
import { classifySubmission, type AbuseReason } from '../../domain/submission/heuristics.js';
import { ipPseudonym } from '../../domain/submission/ip-pseudonym.js';
import { monthStartInZone, submissionQuota } from '../../domain/submission/quota.js';
import { consentTextVersion, nextConsent } from '../../domain/privacy/consent.js';
import { GeoChain } from '../../infrastructure/geo/providers.js';

/**
 * The public submission path (blueprint 7.3).
 *
 * The steps are in the blueprint's own order, and the order is load-bearing:
 * Origin and widget checks before anything is parsed, schema and heuristics
 * before anything is written, geo before the commit, then one transaction, then
 * side effects that can never reverse it.
 *
 * Two rules run through the whole file.
 *
 * A visitor never learns why. Step 10 requires "a uniform generic 2xx response
 * that does not reveal spam classification", so a discarded submission and an
 * accepted one are indistinguishable from outside - same status, same body,
 * same timing shape.
 *
 * The raw IP never lands. Step 7 and section 9.4 allow it transiently for rate
 * limiting and geo; what gets persisted is a rotating HMAC pseudonym, and the
 * address is not carried past this service.
 */

export type SubmissionOutcome =
  /** Stored, or replayed from an earlier identical request. */
  | { readonly kind: 'accepted'; readonly outcome: SuccessOutcome }
  /**
   * Silently discarded: a bot. The caller answers exactly as for `accepted`.
   * Modelled separately only so the route can avoid re-enqueuing side effects.
   */
  | { readonly kind: 'discarded'; readonly outcome: SuccessOutcome }
  | { readonly kind: 'widget_unavailable' }
  | { readonly kind: 'origin_not_allowed' }
  | { readonly kind: 'invalid'; readonly errors: readonly ApiFieldError[] }
  | { readonly kind: 'quota_exceeded' };

export interface SubmissionRequest {
  readonly publicId: string;
  readonly origin: string | undefined;
  /** Transient. Used for rate limiting and geo, never persisted. */
  readonly ip: string;
  readonly payload: SubmissionPayload;
}

export interface SubmissionServiceDeps {
  /**
   * The application's database handle.
   *
   * Taken explicitly rather than derived from the client: `client.db()` with no
   * argument returns the connection string's DEFAULT database, which is not
   * necessarily the one the rest of the app is using - and in the test harness,
   * where every run gets its own database, it definitively is not. Sessions come
   * from `db.client`, so one handle still gives both.
   */
  readonly db: Db;
  readonly findWidgetByPublicId: (publicId: string) => Promise<WithId<WidgetRecord> | null>;
  readonly findWorkspace: (widget: WithId<WidgetRecord>) => Promise<WithId<WorkspaceRecord> | null>;
  readonly findPublishedConfig: (
    scope: WorkspaceScope,
    widget: WithId<WidgetRecord>,
  ) => Promise<{ config: WidgetConfig; revisionNumber: number } | null>;
  readonly geoProviders: readonly GeoProvider[];
  readonly ipHmacSecret: string;
  /**
   * Live dashboard fan-out (blueprint 13.1), added in Stage 8a.
   *
   * A port, and one that never throws: the announcement happens strictly AFTER
   * the commit, so a fan-out failure cannot reverse an accepted submission -
   * the same rule blueprint 12.2 states for the queue.
   */
  readonly events: EventPublisher;
  /**
   * Ask for a double opt-in confirmation email (blueprint 4.8, 12.1).
   *
   * A port, and one that never throws - same contract as `events`. It runs
   * after the commit, so a queue failure cannot reverse an accepted
   * submission; the contact simply stays `pending` and is asked again the next
   * time they submit with the box ticked.
   */
  readonly requestOptInConfirmation: (workspaceId: ObjectId, contactId: ObjectId) => Promise<void>;
  /**
   * Side-effect dispatch (blueprint 12.2), added in Stage 9.
   *
   * Called strictly AFTER the commit and awaited only for ordering. It never
   * throws: the outbox row is already durable, so a dispatch failure is
   * recovered by reconciliation rather than surfaced to a visitor whose
   * submission was already accepted.
   */
  readonly dispatchOutbox: (workspaceId: ObjectId, outboxEventId: ObjectId) => Promise<void>;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class SubmissionService {
  readonly #deps: SubmissionServiceDeps;
  readonly #geo: GeoChain;

  constructor(deps: SubmissionServiceDeps) {
    this.#deps = deps;
    this.#geo = new GeoChain(deps.geoProviders, deps.logger);
  }

  async submit(request: SubmissionRequest): Promise<SubmissionOutcome> {
    const { findWidgetByPublicId, findWorkspace, findPublishedConfig, clock } = this.#deps;
    const now = clock.now();

    // --- steps 1 and 4: the widget, its state, and the Origin ---------------

    const widget = await findWidgetByPublicId(request.publicId);
    if (widget === null || widget.status !== 'active' || widget.publishedRevisionId === null) {
      return { kind: 'widget_unavailable' };
    }

    const workspace = await findWorkspace(widget);
    if (workspace === null || workspace.status !== 'active') return { kind: 'widget_unavailable' };

    const scope = workspaceScope(widget.workspaceId);
    const published = await findPublishedConfig(scope, widget);
    if (published === null) return { kind: 'widget_unavailable' };

    /**
     * Blueprint 7.3 step 1 and the closing note of 7.3: authorization uses the
     * validated request Origin and fresh server-owned settings. The domain and
     * page URL the widget SENT are stored as source metadata and are never
     * consulted here.
     */
    if (request.origin === undefined) return { kind: 'origin_not_allowed' };
    if (!isOriginAllowed(published.config.targeting.allowedDomains, request.origin)) {
      return { kind: 'origin_not_allowed' };
    }

    // --- step 4 continued: validate against the SERVER-owned field schema ---

    const errors = validateAgainstSchema(published.config, request.payload);
    if (errors.length > 0) return { kind: 'invalid', errors };

    const pseudonym = ipPseudonym(this.#deps.ipHmacSecret, request.ip, now);

    // --- step 5: idempotency ------------------------------------------------

    const existing = await this.#deps.db
      .collection<SubmissionEventRecord>(COLLECTIONS.submissionEvents)
      .findOne({ workspaceId: scope.workspaceId, idempotencyKey: request.payload.idempotencyKey });

    if (existing !== null) {
      /**
       * A retry returns the original generic result and creates nothing.
       *
       * Deliberately checked against the durable record rather than only a
       * Redis marker: Redis is a cache that can be flushed, and "creates no
       * duplicate event" has to survive that.
       */
      return { kind: 'accepted', outcome: published.config.success };
    }

    // --- step 6: honeypot and timing ---------------------------------------

    const verdict = classifySubmission({
      honeypot: request.payload.honeypot,
      renderedAt: request.payload.renderedAt,
      receivedAt: now.getTime(),
    });

    if (!verdict.accepted) {
      await this.#recordAbuse(scope, widget, verdict.reason, pseudonym, request.origin, now);
      // Identical to the accepted answer. That is the point.
      return { kind: 'discarded', outcome: published.config.success };
    }

    // --- blueprint 4.10: the workspace's monthly submission quota -----------

    const monthStart = monthStartInZone(now, workspace.timezone);
    const usedThisMonth = await this.#deps.db
      .collection<SubmissionEventRecord>(COLLECTIONS.submissionEvents)
      .countDocuments({ workspaceId: scope.workspaceId, submittedAt: { $gte: monthStart } });

    const quota = submissionQuota(usedThisMonth);
    if (!quota.allowed) {
      await this.#recordAbuse(scope, widget, 'quota', pseudonym, request.origin, now);
      return { kind: 'quota_exceeded' };
    }

    // --- step 8: geo, which may fail entirely without stopping the write ----

    const geo = await this.#geo.lookup(request.ip);

    // --- step 9: one commit --------------------------------------------------

    const committed = await this.#commit({
      scope,
      widget,
      config: published.config,
      revisionNumber: published.revisionNumber,
      optInMode: workspace.optInMode,
      payload: request.payload,
      origin: request.origin,
      geo,
      pseudonym,
      now,
    });

    // --- step 10: side effects, strictly after the commit --------------------

    /**
     * Announce the lead to the workspace's live dashboards (blueprint 13.1).
     *
     * After the commit, and unable to fail it: the publisher swallows its own
     * errors, and nothing here is awaited for its result beyond ordering. A
     * dashboard that misses the announcement still sees the contact on its next
     * load, because the durable record was written before this line ran.
     *
     * Only a NEW contact raises `contact.created`. A repeat submission from an
     * address already in the inbox updated an existing row, and telling the UI
     * a contact was created would make it insert a duplicate.
     */
    await this.#deps.events.publish(
      scope.workspaceId.toHexString(),
      committed.contactCreated ? 'contact.created' : 'contact.updated',
      {
        contactId: committed.contactId.toHexString(),
        submissionEventId: committed.submissionId.toHexString(),
        widgetId: widget._id.toHexString(),
        // Structural detail only. The submitted values are never broadcast:
        // an SSE frame is not the place to re-publish a lead's PII to every
        // open browser tab, and the client fetches what it needs by id.
        email: null,
      },
      now,
    );

    /**
     * Side effects, strictly after the commit (blueprint 12.2, 7.3 step 10).
     *
     * The outbox row is already durable, so this is an OPTIMISATION - it keeps
     * the promise now instead of waiting for the next reconciliation sweep. It
     * cannot fail the submission: `dispatchOutbox` swallows its own errors, and
     * the row stays pending for the sweep either way. This ordering is what
     * makes "forced provider failures never fail a submission" structural.
     */
    await this.#deps.dispatchOutbox(scope.workspaceId, committed.outboxId);

    /**
     * The double opt-in confirmation, if the consent machine asked for one.
     *
     * After the commit, like every other side effect (blueprint 12.2): the
     * contact is already `pending` on disk, so the request to send is a promise
     * about a fact that exists rather than part of establishing it.
     */
    if (committed.confirmationNeeded) {
      await this.#deps.requestOptInConfirmation(scope.workspaceId, committed.contactId);
    }

    /**
     * The submissions meter moved (blueprint 13.1, 4.10).
     *
     * Announced per accepted submission rather than per hundred, unlike the
     * interaction meter: 2,000 a month is a bounded, low-frequency number, and
     * a workspace watching its quota wants to see it move.
     */
    await this.#deps.events.publish(
      scope.workspaceId.toHexString(),
      'usage.changed',
      { meter: 'submissions', submissionsThisMonth: quota.used + 1, limit: quota.limit },
      now,
    );

    return { kind: 'accepted', outcome: published.config.success };
  }

  /**
   * Contact upsert, immutable submission event, consent evidence, and a durable
   * outbox record - committed together (blueprint 7.3 step 9).
   *
   * A transaction is used where the deployment supports one. Mongo requires a
   * replica set for transactions, which this project runs everywhere including
   * locally, so this is the normal path rather than an optimistic one; a
   * standalone server falls back to sequential writes in the same order, which
   * is the best available answer rather than a silent lie about atomicity.
   */
  async #commit(input: CommitInput): Promise<CommitOutcome> {
    const session = this.#deps.db.client.startSession();
    try {
      let outcome: CommitOutcome | null = null;
      await session.withTransaction(async () => {
        outcome = await this.#writeAll(input, session);
      });
      if (outcome === null) throw new Error('Commit produced no outcome');
      return outcome;
    } catch (error) {
      if (isTransactionUnsupported(error)) {
        this.#deps.logger.warn('submission.no_transaction', {
          result: 'degraded',
          reason: 'deployment does not support transactions; writing sequentially',
        });
        return this.#writeAll(input, null);
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async #writeAll(input: CommitInput, session: ClientSession | null): Promise<CommitOutcome> {
    const db = this.#deps.db;
    const options = session === null ? {} : { session };
    const {
      scope,
      widget,
      config,
      revisionNumber,
      optInMode,
      payload,
      origin,
      geo,
      pseudonym,
      now,
    } = input;

    const email = (payload.values['email'] ?? '').trim();
    const normalizedEmail = email.toLowerCase();

    const contacts = db.collection<ContactRecord>(COLLECTIONS.contacts);
    const existing = await contacts.findOne(
      { workspaceId: scope.workspaceId, normalizedEmail, recordStatus: 'active' },
      options,
    );

    let contactId: ObjectId;

    if (existing === null) {
      contactId = new ObjectId();
      await contacts.insertOne(
        {
          _id: contactId,
          workspaceId: scope.workspaceId,
          email,
          normalizedEmail,
          name: payload.values['name'] ?? null,
          phone: payload.values['phone'] ?? null,
          company: payload.values['company'] ?? null,
          manuallyEditedFields: [],
          status: 'new',
          assigneeUserId: null,
          tags: [],
          firstSubmissionAt: now,
          lastSubmissionAt: now,
          submissionCount: 1,
          /**
           * Consent starts at `none` and is decided below, once the widget's
           * consent field and the workspace's opt-in mode are both known
           * (blueprint 4.8).
           */
          consentState: 'none',
          consentUpdatedAt: null,
          /** Retention counts from this submission (blueprint 9.5). */
          retentionAnchorAt: now,
          version: 0,
          recordStatus: 'active',
          deletedAt: null,
          purgeAfter: null,
          mergedIntoContactId: null,
          createdAt: now,
          updatedAt: now,
        },
        options,
      );
    } else {
      contactId = existing._id;

      /**
       * Refresh canonical values, except the ones a human has corrected.
       *
       * Blueprint 4.6: "Manually edited canonical values are not silently
       * overwritten by a later submission; the new raw values remain visible in
       * its immutable event." So a submission updates what nobody has touched,
       * and the submission event below keeps the raw values either way.
       */
      const locked = new Set(existing.manuallyEditedFields);
      const refreshed: Record<string, unknown> = {
        lastSubmissionAt: now,
        submissionCount: existing.submissionCount + 1,
        // A new submission is exactly what blueprint 9.5 measures retention
        // from, so the clock on this contact starts again.
        retentionAnchorAt: now,
        updatedAt: now,
      };
      for (const field of ['name', 'phone', 'company'] as const) {
        const value = payload.values[field];
        if (value !== undefined && value.trim() !== '' && !locked.has(field)) {
          refreshed[field] = value;
        }
      }

      await contacts.updateOne(
        { _id: contactId, workspaceId: scope.workspaceId },
        { $set: refreshed, $inc: { version: 1 } },
        options,
      );
    }

    const submissionId = new ObjectId();
    await db.collection<SubmissionEventRecord>(COLLECTIONS.submissionEvents).insertOne(
      {
        _id: submissionId,
        workspaceId: scope.workspaceId,
        contactId,
        widgetId: widget._id,
        widgetRevisionNumber: revisionNumber,
        values: payload.values,
        source: {
          origin,
          domain: hostOf(origin),
          pageUrl: payload.pageUrl ?? null,
          referrer: payload.referrer ?? null,
        },
        geo,
        ipPseudonym: pseudonym.value,
        ipPseudonymPeriod: pseudonym.period,
        idempotencyKey: payload.idempotencyKey,
        submittedAt: now,
      },
      options,
    );

    /**
     * Consent evidence, when the widget asked for it (blueprint 4.8).
     *
     * The wording is snapshotted from the published revision's consent field
     * label, because proving consent later means proving what the visitor
     * agreed TO - a boolean on its own proves nothing. The version beside it is
     * a fingerprint of that wording, so two contacts who saw the same sentence
     * are provably in the same cohort.
     *
     * The state transition is decided by the pure machine in
     * `domain/privacy/consent`, not here: whether a ticked box means subscribed
     * or merely pending depends on the workspace's opt-in mode, and whether it
     * can override an earlier unsubscribe is a policy question that belongs
     * somewhere testable without a database.
     */
    let confirmationNeeded = false;
    const consentField = config.fields.find((field) => field.type === 'consent');
    if (consentField !== undefined) {
      const granted = (payload.values['consent'] ?? '').toLowerCase() === 'true';
      const currentState = existing?.consentState ?? 'none';
      const outcome = nextConsent(
        currentState,
        { kind: granted ? 'form_opt_in' : 'form_declined' },
        optInMode,
      );
      confirmationNeeded = outcome.sendConfirmation;

      await db.collection<ConsentEventRecord>(COLLECTIONS.consentEvents).insertOne(
        {
          _id: new ObjectId(),
          workspaceId: scope.workspaceId,
          contactId,
          submissionEventId: submissionId,
          type: 'opt_in',
          granted,
          text: consentField.label,
          textVersion: consentTextVersion(consentField.label),
          source: 'widget_form',
          widgetRevisionNumber: revisionNumber,
          ipPseudonym: pseudonym.value,
          occurredAt: now,
        },
        options,
      );

      if (outcome.state !== currentState) {
        await contacts.updateOne(
          { _id: contactId, workspaceId: scope.workspaceId },
          { $set: { consentState: outcome.state, consentUpdatedAt: now } },
          options,
        );
      }
    }

    /**
     * The durable promise of side-effect work (blueprint 12.2).
     *
     * "A durable OutboxEvent prevents a temporary Redis enqueue failure from
     * losing promised work." Stage 9 processes these into email and webhook
     * jobs; Stage 7's obligation is that the record exists inside the same
     * commit as the submission, so a crash between the two is impossible.
     *
     * The idempotency key is derived from the submission id, so a replayed
     * outbox row cannot become a second notification.
     */
    const outboxId = new ObjectId();
    await db.collection<OutboxEventRecord>(COLLECTIONS.outboxEvents).insertOne(
      {
        _id: outboxId,
        workspaceId: scope.workspaceId,
        type: 'submission.received',
        payload: {
          submissionEventId: submissionId.toHexString(),
          contactId: contactId.toHexString(),
          widgetId: widget._id.toHexString(),
        },
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now,
        idempotencyKey: `submission:${submissionId.toHexString()}`,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      },
      options,
    );

    return {
      contactId,
      submissionId,
      outboxId,
      contactCreated: existing === null,
      confirmationNeeded,
    };
  }

  /** Minimal evidence only (blueprint 7.4): never a captured field value. */
  async #recordAbuse(
    scope: WorkspaceScope,
    widget: WithId<WidgetRecord>,
    type: AbuseReason | 'rate_limit' | 'quota',
    pseudonym: { value: string; period: string },
    origin: string | undefined,
    now: Date,
  ): Promise<void> {
    await this.#deps.db.collection<AbuseEventRecord>(COLLECTIONS.abuseEvents).insertOne({
      _id: new ObjectId(),
      workspaceId: scope.workspaceId,
      widgetId: widget._id,
      type,
      ipPseudonym: pseudonym.value,
      ipPseudonymPeriod: pseudonym.period,
      domain: hostOf(origin),
      occurredAt: now,
    });
  }

  /**
   * Record a throttled attempt as evidence (blueprint 7.4 names `rate limit`
   * as one of the event types).
   *
   * Takes the public id rather than a widget, because the route refuses the
   * request before doing any lookups - and resolving one here keeps that fast
   * path free of work that only exists for bookkeeping. An unknown id is
   * ignored rather than raised: a limiter that started throwing under load
   * would be worse than a missing evidence row.
   */
  async recordRateLimited(publicId: string, ip: string, origin: string | undefined): Promise<void> {
    try {
      const widget = await this.#deps.findWidgetByPublicId(publicId);
      if (widget === null) return;

      const now = this.#deps.clock.now();
      await this.#recordAbuse(
        workspaceScope(widget.workspaceId),
        widget,
        'rate_limit',
        ipPseudonym(this.#deps.ipHmacSecret, ip, now),
        origin,
        now,
      );
    } catch (error) {
      this.#deps.logger.warn('submission.abuse_record_failed', {
        result: 'degraded',
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
}

interface CommitOutcome {
  readonly contactId: ObjectId;
  readonly submissionId: ObjectId;
  readonly outboxId: ObjectId;
  /** True when this submission created the Contact rather than updating one. */
  readonly contactCreated: boolean;
  /**
   * True when double opt-in put the contact into `pending` and a confirmation
   * email is now owed to them (blueprint 4.8, 12.1).
   */
  readonly confirmationNeeded: boolean;
}

interface CommitInput {
  readonly scope: WorkspaceScope;
  readonly widget: WithId<WidgetRecord>;
  readonly config: WidgetConfig;
  readonly revisionNumber: number;
  /** The workspace's single/double opt-in setting (blueprint 4.8). */
  readonly optInMode: OptInMode;
  readonly payload: SubmissionPayload;
  readonly origin: string;
  readonly geo: GeoSnapshot | null;
  readonly pseudonym: { readonly value: string; readonly period: string };
  readonly now: Date;
}

/**
 * Validate the payload against the published revision's own field schema
 * (blueprint 7.3 step 4).
 *
 * "Server-owned" is the operative phrase: the shape a submission must satisfy
 * comes from what was published, not from anything the request carries. A field
 * the widget does not declare is rejected rather than stored, so a crafted
 * request cannot smuggle extra values into the event.
 */
export function validateAgainstSchema(
  config: WidgetConfig,
  payload: SubmissionPayload,
): readonly ApiFieldError[] {
  const errors: ApiFieldError[] = [];
  const declared = new Map(config.fields.map((field) => [field.type, field]));
  const keys = Object.keys(payload.values);

  if (keys.length > SUBMISSION_MAX_FIELDS) {
    errors.push({
      path: 'values',
      message: `Send at most ${String(SUBMISSION_MAX_FIELDS)} fields`,
    });
    return errors;
  }

  for (const key of keys) {
    const field = declared.get(key as never);
    if (field === undefined) {
      errors.push({ path: `values.${key}`, message: 'This form does not have that field' });
      continue;
    }

    const value = payload.values[key] ?? '';

    /**
     * A consent field is a checkbox, and its value is the word `true` or
     * `false`. Its configured maximum length describes a text box and defaults
     * to 1, so applying it here would reject every ticked consent box - which
     * is exactly what an integration test caught.
     */
    if (field.type === 'consent') continue;

    if (value.length > Math.min(field.maxLength, SUBMISSION_MAX_VALUE_LENGTH)) {
      errors.push({ path: `values.${key}`, message: 'This answer is too long' });
    }
  }

  for (const field of config.fields) {
    if (!field.required) continue;
    const value = (payload.values[field.type] ?? '').trim();

    if (field.type === 'consent') {
      // A required consent checkbox must actually be ticked.
      if (value.toLowerCase() !== 'true') {
        errors.push({ path: `values.${field.type}`, message: 'This needs to be agreed to' });
      }
      continue;
    }

    if (value === '') {
      errors.push({ path: `values.${field.type}`, message: 'This field is required' });
    }
  }

  // A contact is identified by email, so one is always needed to store a lead.
  const email = (payload.values['email'] ?? '').trim();
  if (email === '' || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    errors.push({ path: 'values.email', message: 'Enter a valid email address' });
  }

  return errors;
}

function hostOf(origin: string | undefined): string | null {
  if (origin === undefined) return null;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** A standalone Mongo deployment refuses to start a transaction. */
function isTransactionUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Transaction numbers are only allowed') ||
    message.includes('replica set') ||
    message.includes('not supported')
  );
}
