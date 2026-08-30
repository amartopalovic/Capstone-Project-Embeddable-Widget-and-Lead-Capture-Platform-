import { Queue, UnrecoverableError, Worker, type JobsOptions, type Processor } from 'bullmq';
import type Redis from 'ioredis';
import type { Logger } from '@lcp/contracts';
import { BASE_DELAY_MS, JITTER, MAX_ATTEMPTS } from '../../domain/delivery/retry.js';
import { REDIS_DOMAINS, type RedisKeyBuilder } from '../redis/key-policy.js';

/**
 * BullMQ queue families (blueprint 12.1).
 *
 * Only the families THIS stage owns. Blueprint 12.1 lists nine; marketing
 * opt-in, analytics aggregation, retention/purge, and the hourly sandbox reset
 * belong to Stages 10-12 and are deliberately absent rather than stubbed - an
 * empty queue that nothing writes to is a worker slot and a Redis polling cost
 * for no benefit, and Upstash bills per command.
 *
 * Separate queues rather than one queue with a `type` field, because the
 * families have genuinely different characteristics: webhook delivery talks to
 * an arbitrary internet host and needs a low concurrency and a long timeout,
 * while email talks to one provider under a daily budget. One queue would make
 * a slow webhook receiver stall the notification emails behind it.
 */

export const QUEUE_NAMES = {
  workspaceNotification: 'workspace-notification',
  visitorConfirmation: 'visitor-confirmation',
  webhookDelivery: 'webhook-delivery',
  outboxReconciliation: 'outbox-reconciliation',
  /**
   * Analytics aggregation and raw-event expiry (blueprint 12.1, 13.2).
   *
   * One family for both, because they are two halves of the same schedule and
   * must not race: expiry deletes raw events, aggregation reads them, and a
   * shared queue with concurrency 1 means the sweep can never run while the
   * aggregator is mid-day.
   */
  analyticsAggregation: 'analytics-aggregation',
  /**
   * Marketing opt-in email (blueprint 12.1), added in Stage 11.
   *
   * Its own family rather than a variant of visitor confirmation, because the
   * two are governed by different rules: a confirmation is transactional and
   * always sent, while anything in here is marketing and is checked against the
   * workspace suppression list before it goes. Keeping them apart means the
   * suppression check has one place to live rather than a flag to remember.
   */
  marketingOptIn: 'marketing-opt-in',
  /**
   * Retention and purge (blueprint 12.1), added in Stage 11.
   *
   * Concurrency 1, and separate from analytics: this family deletes records
   * that the analytics sweep reads, and two sweeps interleaving over the same
   * tenant is the kind of race that only shows up in production.
   */
  retentionPurge: 'retention-purge',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * The retry policy every delivery job shares (blueprint 12.2).
 *
 * `attempts` is MAX_ATTEMPTS, and the backoff is exponential with jitter -
 * BullMQ implements both natively, so the queue's schedule and the outbox
 * reconciler's schedule come from the same two constants rather than from two
 * hand-rolled calculations that could drift.
 *
 * A permanent failure never reaches this policy: the worker throws
 * `UnrecoverableError`, which BullMQ documents as moving a job straight to the
 * failed set regardless of `attempts`.
 */
export const DELIVERY_JOB_OPTIONS: JobsOptions = {
  attempts: MAX_ATTEMPTS,
  backoff: { type: 'exponential', delay: BASE_DELAY_MS, jitter: JITTER },
  /**
   * Keep a bounded tail of finished jobs. The durable record of what happened
   * is the Delivery document in Mongo, so Redis only needs enough history to
   * debug the queue itself - and an unbounded completed set on Upstash is a
   * slow memory leak.
   */
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
};

export { UnrecoverableError };

/**
 * Queue and worker factory.
 *
 * Holds every queue and worker so one call can close them, which matters in
 * tests: a leaked worker keeps polling Redis and keeps the process alive.
 */
export class QueueRegistry {
  readonly #connection: Redis;
  readonly #prefix: string;
  readonly #logger: Logger;
  readonly #queues = new Map<string, Queue>();
  readonly #workers: Worker[] = [];

  /**
   * @param connection a Redis client dedicated to BullMQ. It must have
   *   `maxRetriesPerRequest: null`, which BullMQ requires of a blocking
   *   connection; the application client sets a finite value and cannot be
   *   reused here.
   */
  constructor(connection: Redis, keys: RedisKeyBuilder, logger: Logger) {
    this.#connection = connection;
    // Namespaced like every other Redis key in this project, so a shared
    // Upstash database can host more than one environment.
    this.#prefix = keys.key(REDIS_DOMAINS.queue);
    this.#logger = logger;
  }

  queue(name: QueueName): Queue {
    const existing = this.#queues.get(name);
    if (existing !== undefined) return existing;
    const created = new Queue(name, { connection: this.#connection, prefix: this.#prefix });
    this.#queues.set(name, created);
    return created;
  }

  /**
   * Start a worker.
   *
   * Concurrency is deliberately small. Blueprint 21 names Upstash command
   * consumption as a risk and asks for "conservative worker concurrency and
   * polling"; a portfolio deployment has no throughput problem that more
   * parallelism would solve.
   */
  work(name: QueueName, processor: Processor, concurrency = 2): Worker {
    const worker = new Worker(name, processor, {
      connection: this.#connection,
      prefix: this.#prefix,
      concurrency,
    });

    worker.on('failed', (job, error) => {
      this.#logger.warn('queue.job_failed', {
        result: 'degraded',
        queue: name,
        jobId: job?.id ?? 'unknown',
        attemptsMade: job?.attemptsMade ?? 0,
        // The message only - a job's data can name a workspace but never a
        // recipient or a lead value.
        reason: error.message.slice(0, 200),
      });
    });

    worker.on('error', (error) => {
      this.#logger.error('queue.worker_error', {
        result: 'server_error',
        queue: name,
        reason: error.message.slice(0, 200),
      });
    });

    this.#workers.push(worker);
    return worker;
  }

  async close(): Promise<void> {
    await Promise.all(this.#workers.map(async (worker) => worker.close()));
    await Promise.all([...this.#queues.values()].map(async (queue) => queue.close()));
    this.#queues.clear();
    this.#workers.length = 0;
  }
}
