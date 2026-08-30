import type { Logger } from '@lcp/contracts';
import { QUEUE_NAMES, type QueueRegistry } from '../../infrastructure/queue/queues.js';
import type { DemoService } from './demo-service.js';

/**
 * The hourly sandbox reset (blueprint 12.1, 14.3, 5.2).
 *
 * "Data resets hourly." The schedule is the whole feature: a public sandbox
 * that never forgets accumulates a permanent, unmoderated record of whatever
 * strangers chose to type into it, on a page anybody can read.
 *
 * There is deliberately no route that triggers this. A public endpoint that
 * wipes a tenant is a public endpoint that wipes a tenant, and the fact that
 * this particular tenant is meant to be wiped does not make the endpoint safe
 * to have - it would be one configuration mistake away from pointing at a real
 * workspace. The only callers are this scheduler and startup.
 */
export interface DemoWorkersDeps {
  readonly registry: QueueRegistry;
  readonly demo: DemoService;
  readonly logger: Logger;
}

export class DemoWorkers {
  readonly #deps: DemoWorkersDeps;
  #started = false;

  constructor(deps: DemoWorkersDeps) {
    this.#deps = deps;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;

    this.#deps.registry.work(
      QUEUE_NAMES.sandboxReset,
      async () => {
        await this.#deps.demo.reset();
      },
      1,
    );
  }

  /**
   * Schedule it, and make sure the sandbox exists now.
   *
   * The startup seed is not the same job as the schedule, and both are needed
   * for the same reason retention needed both in Stage 11: a BullMQ scheduler
   * holds one pending iteration and re-arms from the upsert, so a process that
   * has just started may be up to an hour from its first run. Without the seed,
   * a freshly deployed instance would serve an empty demo page for that hour -
   * which is the first hour anybody looks at it.
   *
   * Failure is swallowed. A sandbox that cannot seed must not stop a web
   * process from coming up and serving real customers.
   */
  async scheduleReset(everyMs = 3_600_000): Promise<void> {
    try {
      const workspace = await this.#deps.demo.findWorkspace();
      if (workspace === null) await this.#deps.demo.reset();
    } catch (error) {
      this.#deps.logger.error('demo.seed_failed', {
        result: 'degraded',
        reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      });
    }

    try {
      const queue = this.#deps.registry.queue(QUEUE_NAMES.sandboxReset);
      await queue.upsertJobScheduler(
        'sandbox-reset',
        { every: everyMs },
        {
          name: 'reset',
          opts: { removeOnComplete: { count: 20 }, removeOnFail: { count: 50 } },
        },
      );
    } catch (error) {
      this.#deps.logger.warn('demo.schedule_failed', {
        result: 'degraded',
        reason: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      });
    }
  }
}
