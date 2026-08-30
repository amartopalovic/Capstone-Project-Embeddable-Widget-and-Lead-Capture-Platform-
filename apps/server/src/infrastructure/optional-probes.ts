import type { DependencyProbe, DependencyProbeResult } from '../ports/dependency-probe.js';
import type { RedisEmailBudget } from './redis/email-budget.js';
import { SIDE_EFFECT_CAP } from './redis/email-budget.js';

/**
 * The optional providers, reported separately (blueprint 16.2).
 *
 * "Optional dependencies such as Brevo, geo providers, webhooks, and Sentry do
 * not make the API unready; their degraded state is reported separately."
 *
 * Every probe here answers from state this process can actually observe. None
 * of them calls the provider: a readiness endpoint that pinged Brevo would
 * spend the daily allowance blueprint 5.3 protects, on a check, and would make
 * the endpoint as slow and as flaky as the slowest third party.
 *
 * So what is reported is configuration and consumption - which is the honest
 * answer to "is this provider going to work right now", and is the pair of
 * facts an operator actually acts on.
 */

/**
 * The outbound email provider and its daily budget.
 *
 * `degraded` in two genuinely different situations, both of which mean
 * "transactional mail still works, marketing and notifications do not":
 * no provider is configured, or the side-effect share of the daily allowance is
 * spent. Blueprint 5.3 reserves the rest for critical mail, so this is never
 * `down` - a verification email still goes out.
 */
export class EmailProviderProbe implements DependencyProbe {
  readonly name = 'email';
  readonly #budget: RedisEmailBudget;
  readonly #provider: string;
  readonly #configured: boolean;

  constructor(options: { budget: RedisEmailBudget; provider: string; configured: boolean }) {
    this.#budget = options.budget;
    this.#provider = options.provider;
    this.#configured = options.configured;
  }

  async check(): Promise<DependencyProbeResult> {
    const startedAt = performance.now();
    if (!this.#configured) {
      return {
        name: this.name,
        status: 'degraded',
        durationMs: 0,
        detail: `${this.#provider}: not configured`,
      };
    }

    try {
      const usage = await this.#budget.usage(new Date());
      const spent = usage.sideEffect >= SIDE_EFFECT_CAP;
      return {
        name: this.name,
        status: spent ? 'degraded' : 'up',
        durationMs: Math.round(performance.now() - startedAt),
        detail: `${this.#provider}: ${String(usage.sideEffect)}/${String(SIDE_EFFECT_CAP)} side-effect messages used today`,
      };
    } catch {
      return {
        name: this.name,
        status: 'degraded',
        durationMs: Math.round(performance.now() - startedAt),
        detail: `${this.#provider}: budget unreadable`,
      };
    }
  }
}

/**
 * A provider whose state is settled at boot: it is configured or it is not.
 *
 * Geo enrichment and error monitoring are both like this. Neither is worth a
 * network call - a geo lookup would burn ip-api's 45-per-minute allowance on a
 * health check, and asking Sentry whether Sentry is up requires Sentry.
 */
export class ConfiguredProviderProbe implements DependencyProbe {
  readonly name: string;
  readonly #enabled: boolean;
  readonly #detail: string;

  constructor(name: string, enabled: boolean, detail: string) {
    this.name = name;
    this.#enabled = enabled;
    this.#detail = detail;
  }

  check(): Promise<DependencyProbeResult> {
    return Promise.resolve({
      name: this.name,
      status: this.#enabled ? ('up' as const) : ('degraded' as const),
      durationMs: 0,
      detail: this.#detail,
    });
  }
}
