/**
 * The public sandbox contracts (blueprint 14.3).
 *
 * Two endpoints, both unauthenticated, both read-only. They exist so the demo
 * page can find the seeded widgets and show what has just happened, without the
 * page needing to know anything about workspaces, ids, or the dashboard.
 *
 * Everything here is deliberately narrow. The feed in particular returns the
 * least it can while still being interesting to look at - see `DemoFeedEntry`.
 */

/** How long the sandbox keeps anything, before the hourly job wipes it. */
export const DEMO_RESET_INTERVAL_MINUTES = 60;

export interface DemoWidgetSummary {
  readonly publicId: string;
  readonly type: 'contact_form' | 'email_signup' | 'cta_popover';
  readonly name: string;
  /** One line explaining what this example is for, shown beside it. */
  readonly blurb: string;
}

export interface DemoConfig {
  readonly widgets: readonly DemoWidgetSummary[];
  /** When the sandbox was last wiped and reseeded, ISO 8601. */
  readonly seededAt: string;
  /** When the next scheduled wipe is due, ISO 8601. */
  readonly resetsAt: string;
  /** Where the loader and public endpoints live, for the embed snippet. */
  readonly apiBaseUrl: string;
}

/**
 * One line of the public feed.
 *
 * What is NOT here is the point. No contact id, no workspace id, no submission
 * id, no email address, and none of the values the visitor typed - because this
 * is a public page and the person who filled the form in has no idea it exists.
 * A feed that echoed submitted text would publish whatever the last visitor
 * chose to type, to everyone.
 *
 * What remains is enough to show the system working: which example widget, what
 * kind of thing happened, and when.
 */
export interface DemoFeedEntry {
  readonly kind: 'submission' | 'view';
  readonly widgetName: string;
  readonly occurredAt: string;
  /**
   * How many fields the submission carried. A count, never the contents - it
   * shows something real arrived without publishing what it said.
   */
  readonly fieldCount: number | null;
}

export interface DemoFeed {
  readonly entries: readonly DemoFeedEntry[];
  /** Everything in the sandbox right now, so the page can say what resets. */
  readonly totals: {
    readonly submissions: number;
    readonly views: number;
  };
  readonly seededAt: string;
  readonly resetsAt: string;
}
