import { ObjectId } from 'mongodb';
import { workspaceScope, type DeliveryType } from '@lcp/database';
import type { Logger } from '@lcp/contracts';
import {
  DELIVERY_JOB_OPTIONS,
  QUEUE_NAMES,
  UnrecoverableError,
  type QueueName,
  type QueueRegistry,
} from '../../infrastructure/queue/queues.js';
import { jobId } from '../../domain/delivery/keys.js';
import type { DeliveryService } from './delivery-service.js';
import type { OutboxReconciler } from './outbox-reconciler.js';

/**
 * The worker side of the delivery system (blueprint 12.1, 12.2).
 *
 * In production this starts inside the same Render process as the web server,
 * which blueprint 12.1 states explicitly. That is a free-tier constraint rather
 * than a design preference, and the code is arranged so it does not become one:
 * the worker talks to the same services an HTTP request would, so moving it to
 * its own process later is a deployment change, not a rewrite.
 */

export interface DeliveryJobData {
  readonly workspaceId: string;
  readonly deliveryId: string;
  readonly type: DeliveryType;
}

/** Which queue a delivery type belongs to. */
export function queueFor(type: DeliveryType): QueueName {
  switch (type) {
    case 'workspace_notification':
      return QUEUE_NAMES.workspaceNotification;
    case 'visitor_confirmation':
      return QUEUE_NAMES.visitorConfirmation;
    case 'webhook':
      return QUEUE_NAMES.webhookDelivery;
  }
}

export interface DeliveryWorkerDeps {
  readonly registry: QueueRegistry;
  readonly deliveries: DeliveryService;
  readonly logger: Logger;
  /**
   * The analytics sweep (blueprint 13.2 steps 3 and 5), added in Stage 10a.
   *
   * Runs on the same worker registry rather than its own process: blueprint
   * 12.1 puts every queue family in the web process, and a second scheduler
   * would be a second thing to deploy for one recurring job.
   */
  readonly analytics: {
    aggregatePending(limit?: number): Promise<{ days: number; slices: number }>;
    expireRawEvents(limit?: number): Promise<{
      daysDeleted: number;
      eventsDeleted: number;
      skipped: number;
    }>;
  };
}

export class DeliveryWorkers {
  readonly #deps: DeliveryWorkerDeps;
  #started = false;

  constructor(deps: DeliveryWorkerDeps) {
    this.#deps = deps;
  }

  /**
   * Enqueue one delivery.
   *
   * The BullMQ job id is derived from the delivery's idempotency key, so the
   * QUEUE also refuses an obvious duplicate - a second line of defence in front
   * of the unique index, which catches the case where Redis was flushed.
   *
   * Never throws. An enqueue failure is exactly the case the outbox exists for:
   * the promise is already on disk, the reconciler will find it, and letting
   * this reject would push a Redis outage back into a request that has already
   * been answered 202.
   */
  async enqueue(data: DeliveryJobData, idempotencyKey: string): Promise<boolean> {
    try {
      const queue = this.#deps.registry.queue(queueFor(data.type));
      await queue.add('deliver', data, {
        ...DELIVERY_JOB_OPTIONS,
        jobId: jobId(data.type, idempotencyKey),
      });
      return true;
    } catch (error) {
      this.#deps.logger.warn('delivery.enqueue_failed', {
        result: 'degraded',
        deliveryType: data.type,
        reason: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      });
      return false;
    }
  }

  /**
   * Start every worker this stage owns.
   *
   * The reconciler is a PARAMETER rather than a constructor dependency, and
   * that is what breaks an otherwise circular graph: the reconciler needs this
   * object's `enqueue`, and the sweep worker needs the reconciler. Passing it
   * at start time means neither has to be constructed half-built.
   *
   * Idempotent: calling twice does not start a second set, which matters
   * because the composition root is built once per process but the tests build
   * it per file.
   */
  start(reconciler: OutboxReconciler): void {
    if (this.#started) return;
    this.#started = true;

    for (const type of ['workspace_notification', 'visitor_confirmation', 'webhook'] as const) {
      this.#deps.registry.work(queueFor(type), async (job) => {
        const data = job.data as DeliveryJobData;
        await this.#process(data, job.attemptsMade);
      });
    }

    this.#deps.registry.work(QUEUE_NAMES.outboxReconciliation, async () => {
      await reconciler.reconcile();
    });

    /**
     * Aggregation first, then expiry, in one job at concurrency 1.
     *
     * The order is the safety property: expiry refuses to delete a day it
     * cannot aggregate, and running aggregation immediately before it means a
     * day that just crossed the 90-day line is rolled up in the same pass that
     * would retire it. Two separate jobs could interleave the other way round.
     */
    this.#deps.registry.work(
      QUEUE_NAMES.analyticsAggregation,
      async () => {
        const aggregated = await this.#deps.analytics.aggregatePending();
        const expired = await this.#deps.analytics.expireRawEvents();
        this.#deps.logger.info('analytics.sweep', {
          result: 'success',
          days: aggregated.days,
          slices: aggregated.slices,
          daysDeleted: expired.daysDeleted,
          eventsDeleted: expired.eventsDeleted,
          skipped: expired.skipped,
        });
      },
      1,
    );
  }

  /**
   * Run one delivery attempt and translate the outcome for BullMQ.
   *
   * The translation is the whole point of this method, and it is where
   * blueprint 12.2's "only transient failures retry" is enforced at the queue
   * boundary:
   *
   *  - delivered or deferred  -> RESOLVE. A deferred email is not a failure; it
   *    is waiting for tomorrow's allowance, and its Delivery row already
   *    carries the later `nextAttemptAt`. Failing the job would burn a retry
   *    attempt on a budget decision.
   *  - permanent failure      -> throw `UnrecoverableError`, which BullMQ
   *    documents as moving the job straight to the failed set, ignoring
   *    `attempts`.
   *  - transient failure      -> throw an ordinary Error, so the configured
   *    exponential-with-jitter backoff applies.
   */
  async #process(data: DeliveryJobData, attemptsMade: number): Promise<void> {
    const scope = workspaceScope(new ObjectId(data.workspaceId));
    const result = await this.#deps.deliveries.attempt(scope, new ObjectId(data.deliveryId));

    if (result.kind === 'delivered' || result.kind === 'deferred') return;

    if (result.failure === 'permanent') {
      throw new UnrecoverableError(result.detail);
    }

    this.#deps.logger.debug('delivery.transient_failure', {
      result: 'degraded',
      deliveryType: data.type,
      attemptsMade,
      reason: result.detail,
    });
    throw new Error(result.detail);
  }

  /**
   * Schedule the reconciliation sweep.
   *
   * A repeatable job rather than a `setInterval`, so it survives a restart and
   * does not multiply when more than one process runs. Every two minutes is
   * frequent enough that a lost enqueue is invisible to a customer and rare
   * enough to stay well inside Upstash's command budget.
   */
  /**
   * Schedule the analytics sweep.
   *
   * Hourly rather than every two minutes: aggregates are daily counters, and
   * recomputing them more often than that spends Upstash commands to arrive at
   * the same numbers. Blueprint 21 names Upstash command consumption as a real
   * risk on the free tier.
   */
  async scheduleAnalytics(everyMs = 3_600_000): Promise<void> {
    try {
      const queue = this.#deps.registry.queue(QUEUE_NAMES.analyticsAggregation);
      await queue.upsertJobScheduler(
        'analytics-sweep',
        { every: everyMs },
        {
          name: 'sweep',
          opts: { removeOnComplete: { count: 20 }, removeOnFail: { count: 50 } },
        },
      );
    } catch (error) {
      this.#deps.logger.warn('analytics.schedule_failed', {
        result: 'degraded',
        reason: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      });
    }
  }

  async scheduleReconciliation(everyMs = 120_000): Promise<void> {
    try {
      const queue = this.#deps.registry.queue(QUEUE_NAMES.outboxReconciliation);
      /**
       * `upsertJobScheduler`, not `add` with a `repeat` option: BullMQ 6
       * replaced repeatable-job options with job schedulers, and the upsert is
       * what makes restarting the process REPLACE the schedule rather than
       * accumulate a second one.
       */
      await queue.upsertJobScheduler(
        'outbox-sweep',
        { every: everyMs },
        {
          name: 'sweep',
          opts: { removeOnComplete: { count: 20 }, removeOnFail: { count: 50 } },
        },
      );
    } catch (error) {
      this.#deps.logger.warn('delivery.schedule_failed', {
        result: 'degraded',
        reason: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      });
    }
  }
}
