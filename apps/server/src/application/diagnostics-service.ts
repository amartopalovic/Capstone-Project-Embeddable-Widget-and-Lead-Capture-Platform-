import type { Db } from 'mongodb';
import type Redis from 'ioredis';
import { COLLECTIONS } from '@lcp/database';
import type { QueueRegistry, QueueName } from '../infrastructure/queue/queues.js';
import { QUEUE_NAMES } from '../infrastructure/queue/queues.js';
import type { RedisEmailBudget } from '../infrastructure/redis/email-budget.js';
import { BREVO_DAILY_BUDGET, SIDE_EFFECT_CAP } from '../infrastructure/redis/email-budget.js';
import type { DemoService } from './demo/demo-service.js';
import type { DependencyProbe, DependencyProbeResult } from '../ports/dependency-probe.js';
import type { Clock } from '../ports/clock.js';

/**
 * The platform-operator diagnostics surface (blueprint 16.4).
 *
 * Section 16.4 asks for two views. The workspace-level one - "Owner/Admin
 * dashboard views their workspace delivery health" - has existed since Stage 9
 * in `DeliveryAdminService`. This is the other one: the platform-wide view,
 * which crosses every tenant and therefore belongs to nobody's workspace.
 *
 * That is exactly why it is NOT a workspace-scoped service and does not take a
 * `WorkspaceScope`. Every number here is deliberately an aggregate across all
 * tenants - a queue depth, a dead-letter count, a daily provider budget - and
 * not one of them names a contact, a lead value, or a workspace's contents. The
 * tenancy invariant in blueprint 9.1 is not weakened by this file; it is simply
 * not the question it answers.
 *
 * Everything degrades rather than throws. A diagnostics page that 500s because
 * Redis is unreachable is useless precisely when it is needed.
 */

export interface QueueDiagnostics {
  readonly name: string;
  readonly waiting: number;
  readonly active: number;
  readonly delayed: number;
  readonly failed: number;
  readonly completed: number;
  /** Age of the oldest waiting job, which is the number that means "behind". */
  readonly oldestWaitingAgeMs: number | null;
}

export interface DiagnosticsSnapshot {
  readonly release: string;
  readonly timestamp: string;
  readonly queues: readonly QueueDiagnostics[];
  readonly deadLetters: { readonly total: number; readonly unalerted: number };
  readonly email: {
    readonly usedToday: number;
    readonly sideEffectUsedToday: number;
    readonly dailyBudget: number;
    readonly sideEffectCap: number;
  };
  /**
   * Upstash bills per command, so the trend matters more than the value
   * (blueprint 21). Reported as the counter Redis itself keeps since its last
   * restart; two readings a minute apart are the trend.
   */
  readonly redis: {
    readonly commandsProcessed: number | null;
    readonly connectedClients: number | null;
    readonly usedMemoryBytes: number | null;
  };
  readonly mongo: readonly DependencyProbeResult[];
  readonly retention: { readonly lastSweepAt: string | null; readonly lastSweepResult: string };
  readonly demo: { readonly seededAt: string | null; readonly resetsAt: string | null };
}

export interface DiagnosticsDeps {
  readonly db: Db;
  readonly redis: Redis;
  readonly queues: QueueRegistry;
  readonly budget: RedisEmailBudget;
  readonly demo: DemoService;
  readonly mongoProbes: readonly DependencyProbe[];
  readonly release: string;
  readonly clock: Clock;
}

export class DiagnosticsService {
  readonly #deps: DiagnosticsDeps;

  constructor(deps: DiagnosticsDeps) {
    this.#deps = deps;
  }

  async snapshot(): Promise<DiagnosticsSnapshot> {
    const now = this.#deps.clock.now();

    const [queues, deadLetters, email, redis, mongo, retention, demo] = await Promise.all([
      this.#queues(),
      this.#deadLetters(),
      this.#email(now),
      this.#redis(),
      Promise.all(this.#deps.mongoProbes.map((probe) => probe.check())),
      this.#retention(),
      this.#demo(),
    ]);

    return {
      release: this.#deps.release,
      timestamp: now.toISOString(),
      queues,
      deadLetters,
      email,
      redis,
      mongo,
      retention,
      demo,
    };
  }

  async #queues(): Promise<readonly QueueDiagnostics[]> {
    const names = Object.values(QUEUE_NAMES) as readonly QueueName[];
    return Promise.all(
      names.map(async (name): Promise<QueueDiagnostics> => {
        try {
          const queue = this.#deps.queues.queue(name);
          const counts = await queue.getJobCounts(
            'waiting',
            'active',
            'delayed',
            'failed',
            'completed',
          );
          /**
           * The oldest WAITING job, asked for as one job rather than a page.
           *
           * BullMQ returns the waiting list in insertion order, so index 0 is
           * the oldest thing that has not been picked up - which is the honest
           * measure of "how far behind is this queue", in a way a depth alone
           * is not. A queue of 500 that drains in a second is fine; a queue of
           * one that has waited an hour is not.
           */
          const [oldest] = await queue.getJobs(['waiting'], 0, 0, true);
          const timestamp = oldest?.timestamp;
          return {
            name,
            waiting: counts['waiting'] ?? 0,
            active: counts['active'] ?? 0,
            delayed: counts['delayed'] ?? 0,
            failed: counts['failed'] ?? 0,
            completed: counts['completed'] ?? 0,
            oldestWaitingAgeMs: timestamp === undefined ? null : Date.now() - timestamp,
          };
        } catch {
          return {
            name,
            waiting: 0,
            active: 0,
            delayed: 0,
            failed: 0,
            completed: 0,
            oldestWaitingAgeMs: null,
          };
        }
      }),
    );
  }

  async #deadLetters(): Promise<{ total: number; unalerted: number }> {
    try {
      const deliveries = this.#deps.db.collection(COLLECTIONS.deliveries);
      const [total, unalerted] = await Promise.all([
        deliveries.countDocuments({ status: 'dead_letter' }),
        deliveries.countDocuments({ status: 'dead_letter', alertedAt: null }),
      ]);
      return { total, unalerted };
    } catch {
      return { total: -1, unalerted: -1 };
    }
  }

  async #email(now: Date): Promise<DiagnosticsSnapshot['email']> {
    try {
      const usage = await this.#deps.budget.usage(now);
      return {
        usedToday: usage.total,
        sideEffectUsedToday: usage.sideEffect,
        dailyBudget: BREVO_DAILY_BUDGET,
        sideEffectCap: SIDE_EFFECT_CAP,
      };
    } catch {
      return {
        usedToday: -1,
        sideEffectUsedToday: -1,
        dailyBudget: BREVO_DAILY_BUDGET,
        sideEffectCap: SIDE_EFFECT_CAP,
      };
    }
  }

  async #redis(): Promise<DiagnosticsSnapshot['redis']> {
    try {
      const info = await this.#deps.redis.info();
      return {
        commandsProcessed: readInfoNumber(info, 'total_commands_processed'),
        connectedClients: readInfoNumber(info, 'connected_clients'),
        usedMemoryBytes: readInfoNumber(info, 'used_memory'),
      };
    } catch {
      // Upstash implements a subset of INFO. A missing section is not a fault.
      return { commandsProcessed: null, connectedClients: null, usedMemoryBytes: null };
    }
  }

  /**
   * When the retention sweep last ran.
   *
   * Read from the queue's own completed set rather than a status document
   * written alongside it. There is no second record to keep in step, and the
   * answer cannot claim a sweep happened that the queue has no memory of.
   */
  async #retention(): Promise<DiagnosticsSnapshot['retention']> {
    try {
      const queue = this.#deps.queues.queue(QUEUE_NAMES.retentionPurge);
      const [latest] = await queue.getJobs(['completed'], 0, 0, false);
      if (latest === undefined) {
        return { lastSweepAt: null, lastSweepResult: 'no completed sweep in the retained history' };
      }
      const finishedOn = latest.finishedOn;
      return {
        lastSweepAt: finishedOn === undefined ? null : new Date(finishedOn).toISOString(),
        lastSweepResult: 'completed',
      };
    } catch {
      return { lastSweepAt: null, lastSweepResult: 'queue unreadable' };
    }
  }

  async #demo(): Promise<DiagnosticsSnapshot['demo']> {
    try {
      const config = await this.#deps.demo.config();
      if (config === null) return { seededAt: null, resetsAt: null };
      return { seededAt: config.seededAt, resetsAt: config.resetsAt };
    } catch {
      return { seededAt: null, resetsAt: null };
    }
  }
}

/** Pull one `key:value` line out of a Redis INFO block. */
function readInfoNumber(info: string, key: string): number | null {
  const match = new RegExp(`^${key}:(\\d+)`, 'm').exec(info);
  if (match === null) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}
