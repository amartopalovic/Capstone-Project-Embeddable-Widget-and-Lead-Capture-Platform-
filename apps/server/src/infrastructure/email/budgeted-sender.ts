import type { Logger } from '@lcp/contracts';
import type { EmailSendResult, EmailSender, OutboundEmail } from '../../ports/email-sender.js';
import type { Clock } from '../../ports/clock.js';
import type { RedisEmailBudget } from '../redis/email-budget.js';

/**
 * Wraps any EmailSender with the daily budget guard from blueprint section 5.3.
 *
 * The guard runs BEFORE the provider call, so a refused message costs no
 * provider allowance. A deferred message is reported as such rather than as a
 * failure, because section 5.3 says excess non-critical mail waits for the next
 * allowance window instead of erroring.
 */
export class BudgetedEmailSender implements EmailSender {
  readonly #inner: EmailSender;
  readonly #budget: RedisEmailBudget;
  readonly #clock: Clock;
  readonly #logger: Logger;

  constructor(inner: EmailSender, budget: RedisEmailBudget, clock: Clock, logger: Logger) {
    this.#inner = inner;
    this.#budget = budget;
    this.#clock = clock;
    this.#logger = logger;
  }

  get name(): string {
    return `budgeted(${this.#inner.name})`;
  }

  async send(message: OutboundEmail): Promise<EmailSendResult> {
    const decision = await this.#budget.tryConsume(message.priority, this.#clock.now());

    if (!decision.allowed) {
      this.#logger.warn('email.deferred', {
        priority: message.priority,
        usedToday: decision.usedToday,
        sideEffectUsedToday: decision.sideEffectUsedToday,
        result: 'degraded',
      });
      return { status: 'deferred', reason: 'budget_exhausted' };
    }

    const result = await this.#inner.send(message);

    this.#logger.info('email.dispatched', {
      priority: message.priority,
      provider: this.#inner.name,
      outcome: result.status,
      usedToday: decision.usedToday,
      result: result.status === 'sent' ? 'success' : 'degraded',
    });

    return result;
  }
}
