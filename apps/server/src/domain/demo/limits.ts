import type { RateLimitRule } from '../../ports/rate-limiter.js';

/**
 * The sandbox's own limits (blueprint 14.3).
 *
 * "Strict demo-specific rate and payload limits still apply." The sandbox is
 * the one surface on this platform that is advertised to strangers and needs no
 * account, which makes it the obvious thing to point a script at - and it
 * shares MongoDB, Redis, and the free-tier instance with every real workspace.
 * So its limits are not the production ones; they are tighter, and they are
 * checked in addition to rather than instead of the production rules.
 *
 * Every number here is lower than its counterpart in
 * `domain/submission/rate-rules`. That relationship is asserted in a test
 * rather than left to whoever edits one of the two files next, because a
 * sandbox limit that had quietly drifted looser than production's would be
 * worse than having none - it would look like a control and act like a hole.
 */

/** The submission body cap for a demo widget, well under the global 32 KB. */
export const DEMO_MAX_BODY_BYTES = 8 * 1024;

/**
 * Rate rules applied on top of the production ones for a demo widget.
 *
 * Keyed per visitor and per widget, the same two axes the production rules
 * use, so a single visitor cannot exhaust the sandbox for everybody and a
 * distributed attempt still meets the per-widget ceiling.
 */
export const DEMO_RATE_RULES = {
  /**
   * Stricter than production's 5-per-minute on every axis. Somebody trying the
   * sandbox submits two or three times to see what happens; somebody scripting
   * it does not stop at three.
   */
  perIpMinute: { name: 'demo-ip-min', limit: 3, windowSeconds: 60 },
  perIpHour: { name: 'demo-ip-hour', limit: 15, windowSeconds: 3600 },
  /** The ceiling for the whole sandbox, whoever is asking. Production allows 100. */
  perWidgetMinute: { name: 'demo-widget-min', limit: 30, windowSeconds: 60 },
  /** The public feed is a read, and cheap, but it is still a database query. */
  feedPerIpMinute: { name: 'demo-feed-min', limit: 30, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;
