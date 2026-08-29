import type { Db, WithId } from 'mongodb';
import { ObjectId } from 'mongodb';
import {
  COLLECTIONS,
  workspaceScope,
  type OutboxEventRecord,
  type OutboxRepository,
  type SubmissionEventRecord,
  type WidgetRecord,
} from '@lcp/database';
import type { Logger } from '@lcp/contracts';
import { nextAttemptAt, MAX_ATTEMPTS } from '../../domain/delivery/retry.js';
import type { Clock } from '../../ports/clock.js';
import type { DeliveryService } from './delivery-service.js';

/**
 * Outbox reconciliation (blueprint 12.2, 18.4).
 *
 * "A durable OutboxEvent prevents a temporary Redis enqueue failure from losing
 * promised work."
 *
 * The submission path writes the outbox row inside the same transaction as the
 * Contact and the SubmissionEvent, then tries to enqueue. If that enqueue fails
 * - Redis is down, the process is killed between the two - the promise is still
 * on disk and nobody is coming back for it. This is what comes back for it.
 *
 * It is deliberately a SWEEP rather than a listener. A listener would have to
 * be told about the failure, and the failure case is precisely the one where
 * telling anything is unreliable. A sweep needs to know nothing: it reads rows
 * that are pending and due, and acts on them.
 */

export interface OutboxReconcilerDeps {
  readonly db: Db;
  readonly outbox: OutboxRepository;
  readonly deliveries: DeliveryService;
  readonly enqueue: (workspaceId: string, deliveryId: string, type: string) => Promise<void>;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface ReconcileSummary {
  readonly examined: number;
  readonly dispatched: number;
  readonly deadLettered: number;
  readonly failed: number;
}

export class OutboxReconciler {
  readonly #deps: OutboxReconcilerDeps;

  constructor(deps: OutboxReconcilerDeps) {
    this.#deps = deps;
  }

  /**
   * One sweep.
   *
   * Bounded by `limit` so a large backlog is worked through over several runs
   * rather than in one burst that would blow through the Brevo allowance and
   * Upstash's command budget at once.
   */
  async reconcile(limit = 50): Promise<ReconcileSummary> {
    const now = this.#deps.clock.now();
    const due = await this.#deps.outbox.listDueAcrossWorkspaces(now, limit);

    let dispatched = 0;
    let deadLettered = 0;
    let failed = 0;

    for (const row of due) {
      const scope = workspaceScope(row.workspaceId);

      /**
       * Claim it first. Two web processes could sweep at once, and without the
       * claim both would fan out the same promise - which the delivery-level
       * unique index would then absorb, but only after doing the work twice.
       */
      const claimed = await this.#deps.outbox.markProcessing(scope, row._id, now);
      if (!claimed) continue;

      try {
        const count = await this.#dispatch(row);
        dispatched += count;
        if (count === 0) {
          /**
           * Nothing to deliver: no verified recipients, no webhooks, no
           * confirmation. The promise is kept vacuously, so it is settled
           * rather than retried forever.
           */
          await this.#deps.outbox.markSent(scope, row._id, now);
        }
      } catch (error) {
        const attempts = row.attempts + 1;
        const reason = error instanceof Error ? error.message.slice(0, 200) : 'unknown';

        if (attempts >= MAX_ATTEMPTS) {
          await this.#deps.outbox.markDeadLetter(scope, row._id, reason, now);
          deadLettered += 1;
          this.#deps.logger.error('outbox.dead_letter', {
            result: 'server_error',
            outboxType: row.type,
            attempts,
            reason,
          });
        } else {
          await this.#deps.outbox.markForRetry(
            scope,
            row._id,
            nextAttemptAt(attempts, now),
            reason,
            attempts,
            now,
          );
          failed += 1;
          this.#deps.logger.warn('outbox.requeued', {
            result: 'degraded',
            outboxType: row.type,
            attempts,
            reason,
          });
        }
      }
    }

    return { examined: due.length, dispatched, deadLettered, failed };
  }

  /**
   * Dispatch ONE outbox row immediately, right after its commit.
   *
   * This is the fast path: the submission has just been accepted, the promise
   * is on disk, and the natural thing is to try to keep it now rather than wait
   * up to two minutes for a sweep. It shares `#dispatch` with the sweep, so the
   * fast path and the recovery path cannot behave differently.
   *
   * Never throws. A failure here is precisely what the outbox is for - the row
   * stays pending and the next sweep finds it - and letting it propagate would
   * push a Redis outage into a request that has already answered 202.
   */
  async dispatchNow(workspaceId: ObjectId, outboxEventId: ObjectId): Promise<void> {
    const scope = workspaceScope(workspaceId);
    const now = this.#deps.clock.now();
    try {
      const row = await this.#deps.outbox.findById(scope, outboxEventId);
      if (row === null || row.status !== 'pending') return;
      if (!(await this.#deps.outbox.markProcessing(scope, row._id, now))) return;

      const count = await this.#dispatch(row);
      if (count === 0) await this.#deps.outbox.markSent(scope, row._id, now);
    } catch (error) {
      this.#deps.logger.warn('outbox.immediate_dispatch_failed', {
        result: 'degraded',
        reason: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      });
      // Hand it back so the sweep retries it.
      await this.#deps.outbox
        .markForRetry(
          scope,
          outboxEventId,
          nextAttemptAt(1, now),
          'immediate dispatch failed',
          1,
          now,
        )
        .catch(() => undefined);
    }
  }

  /**
   * Turn one outbox row into Delivery rows and queue jobs.
   *
   * `ensureDelivery` is idempotent on its unique index, so a row that was
   * already partly dispatched before a crash produces no duplicates on the
   * second pass - which is the whole reason the reconciler can be safely
   * aggressive.
   */
  async #dispatch(row: WithId<OutboxEventRecord>): Promise<number> {
    const scope = workspaceScope(row.workspaceId);
    const payload = row.payload as {
      submissionEventId?: string;
      contactId?: string;
      widgetId?: string;
    };

    const submissionEventId = payload.submissionEventId;
    const widgetId = payload.widgetId;
    if (submissionEventId === undefined || widgetId === undefined) {
      throw new Error(`outbox row ${row._id.toHexString()} has no submission reference`);
    }

    const submission = await this.#deps.db
      .collection<SubmissionEventRecord>(COLLECTIONS.submissionEvents)
      .findOne({ _id: new ObjectId(submissionEventId), workspaceId: row.workspaceId });
    const widget = await this.#deps.db
      .collection<WidgetRecord>(COLLECTIONS.widgets)
      .findOne({ _id: new ObjectId(widgetId), workspaceId: row.workspaceId });

    if (submission === null || widget === null) {
      // The thing this promised to notify about is gone - a purge, or a test
      // cleaning up. Nothing to keep promising.
      return 0;
    }

    const plan = await this.#deps.deliveries.planFor(scope, submission, widget);
    let queued = 0;

    for (const item of plan) {
      const { delivery, created } = await this.#deps.deliveries.ensureDelivery(scope, item, {
        outboxEventId: row._id,
        contactId: payload.contactId === undefined ? null : new ObjectId(payload.contactId),
        submissionEventId: submission._id,
        widgetId: widget._id,
      });

      // Only queue work that is actually waiting. A delivered or permanently
      // failed row is settled, and re-queueing it is the duplicate the
      // idempotency rule exists to prevent.
      if (delivery.status === 'delivered' || delivery.status === 'failed') continue;
      if (!created && delivery.status === 'retrying') continue;

      await this.#deps.enqueue(
        row.workspaceId.toHexString(),
        delivery._id.toHexString(),
        delivery.type,
      );
      queued += 1;
    }

    return queued;
  }
}
