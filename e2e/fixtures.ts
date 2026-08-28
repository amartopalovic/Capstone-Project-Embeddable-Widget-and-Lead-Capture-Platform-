import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';

/*
 * Playwright fixtures declare their dependencies by destructuring the first
 * parameter, so a fixture that needs none still has to write `{}`.
 */
/* eslint-disable no-empty-pattern */

/**
 * Shared E2E fixtures.
 *
 * `checkA11y` is configured once here so every page is scanned against the
 * same WCAG 2.2 AA tag set, rather than each test choosing its own bar.
 */

export const MAILPIT_API = process.env['MAILPIT_API'] ?? 'http://localhost:8025';

type Fixtures = {
  checkA11y: (page: Page) => Promise<void>;
  clearThrottles: void;
};

const REDIS_URL = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379';
/** Matches REDIS_KEY_PREFIX in the Playwright webServer config. */
const E2E_KEY_PREFIX = 'lcp:e2e';

export const test = base.extend<Fixtures>({
  /**
   * Clear this run's throttle counters before every test.
   *
   * Every request originates from 127.0.0.1, so without this the real per-IP
   * limits would make each test spend the next test's allowance. The production
   * limits are untouched; only the counters are reset.
   */
  clearThrottles: [
    async ({}, use) => {
      const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
      const keys = await redis.keys(`${E2E_KEY_PREFIX}:ratelimit:*`);
      if (keys.length > 0) await redis.del(...keys);
      redis.disconnect();
      await use();
    },
    { auto: true },
  ],

  checkA11y: async ({}, use) => {
    await use(async (page: Page) => {
      /**
       * Wait for the mount animation to settle before scanning.
       *
       * Mid-animation the panel is still partly transparent, so axe measures
       * blended colours that no user ever reads at rest. The settled page is
       * what has to meet contrast, and a reduced-motion user skips the
       * transition entirely.
       */
      await page.evaluate(async () => {
        await Promise.all(
          document.getAnimations().map(async (animation) => {
            try {
              await animation.finished;
            } catch {
              // A cancelled animation is fine; it is not running.
            }
          }),
        );
      });

      const results = await new AxeBuilder({ page })
        // wcag22aa is included explicitly; blueprint 14.1 targets WCAG 2.2 AA.
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();

      const critical = results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious',
      );

      // Report the rule AND the offending element, so a failure says exactly
      // what to fix rather than just naming a rule.
      const described = critical.flatMap((violation) =>
        violation.nodes.map(
          (node) =>
            `${violation.id} [${node.target.join(' ')}] ${node.failureSummary?.replace(/\s+/g, ' ').slice(0, 220) ?? ''}`,
        ),
      );

      expect(described, 'critical or serious accessibility violations').toEqual([]);
    });
  },
});

export { expect };

export function uniqueEmail(label: string): string {
  return `e2e-${label}-${randomBytes(5).toString('hex')}@example.invalid`;
}

export const STRONG_PASSWORD = 'ripe-avocado-lantern-7731';

// ---------------------------------------------------------------------------
// Mailpit
// ---------------------------------------------------------------------------

interface MailpitMessage {
  readonly ID: string;
  readonly Subject: string;
}

export async function waitForEmail(
  recipient: string,
  subjectContains: string,
  timeoutMs = 20_000,
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${MAILPIT_API}/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`,
    );
    if (response.ok) {
      const body = (await response.json()) as { messages?: MailpitMessage[] };
      const match = (body.messages ?? []).find((message) =>
        message.Subject.includes(subjectContains),
      );
      if (match !== undefined) return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No "${subjectContains}" email for ${recipient} within ${String(timeoutMs)}ms`);
}

/** Pull the single-use link out of a captured email. */
export async function linkFromEmail(messageId: string): Promise<string> {
  const response = await fetch(`${MAILPIT_API}/api/v1/message/${messageId}`);
  const body = (await response.json()) as { Text?: string; HTML?: string };
  const content = `${body.Text ?? ''}\n${body.HTML ?? ''}`;
  const match = /(https?:\/\/[^\s"'<>]*[?&]token=[A-Za-z0-9_-]+)/.exec(content);
  if (match?.[1] === undefined) throw new Error('No tokenised link found in email');
  return match[1];
}
