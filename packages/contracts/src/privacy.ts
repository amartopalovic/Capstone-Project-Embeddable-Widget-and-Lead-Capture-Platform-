/**
 * Consent, suppression, privacy requests, and retention contracts
 * (blueprint 4.8, 9.5).
 *
 * The public halves of this file are consumed by pages a visitor reaches from
 * an email link with no session, so the shapes are deliberately small: a token
 * goes in, an outcome comes out, and nothing about the workspace or the contact
 * leaks to somebody who guessed a URL.
 */

import * as z from 'zod';
import { emailSchema } from './auth.js';

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export const CONSENT_STATE_VALUES = ['none', 'pending', 'confirmed', 'withdrawn'] as const;
export type ConsentStateValue = (typeof CONSENT_STATE_VALUES)[number];

/** Wording for the inbox timeline and the contact detail page. */
export const CONSENT_STATE_LABELS: Readonly<Record<ConsentStateValue, string>> = {
  none: 'Not asked',
  pending: 'Awaiting confirmation',
  confirmed: 'Subscribed',
  withdrawn: 'Unsubscribed',
};

export const OPT_IN_MODE_VALUES = ['single', 'double'] as const;
export type OptInModeValue = (typeof OPT_IN_MODE_VALUES)[number];

export const OPT_IN_MODE_LABELS: Readonly<Record<OptInModeValue, string>> = {
  single: 'Single opt-in',
  double: 'Double opt-in',
};

export const OPT_IN_MODE_HINTS: Readonly<Record<OptInModeValue, string>> = {
  single: 'A ticked box subscribes the address straight away.',
  double: 'A ticked box sends a confirmation email. Only a confirmed address is subscribed.',
};

export interface ConsentEventSummary {
  readonly id: string;
  readonly type: 'opt_in' | 'confirmation' | 'withdrawal';
  readonly granted: boolean;
  readonly text: string;
  readonly textVersion: string;
  readonly source: 'widget_form' | 'double_opt_in_email' | 'unsubscribe_link';
  readonly widgetRevisionNumber: number;
  readonly occurredAt: string;
}

// ---------------------------------------------------------------------------
// Retention settings
// ---------------------------------------------------------------------------

/**
 * The four choices blueprint 4.8 exposes. Indefinite is 0, matching storage.
 */
export const RETENTION_CHOICES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '12 months' },
  { days: 0, label: 'Indefinitely' },
] as const;

export type RetentionChoiceDays = (typeof RETENTION_CHOICES)[number]['days'];

export interface WorkspacePrivacySettings {
  readonly retentionDays: number;
  readonly optInMode: OptInModeValue;
}

export const privacySettingsSchema = z.object({
  retentionDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.literal(0)]),
  optInMode: z.enum(['single', 'double']),
});

export type PrivacySettingsInput = z.infer<typeof privacySettingsSchema>;

// ---------------------------------------------------------------------------
// Public token-driven flows
// ---------------------------------------------------------------------------

/**
 * A token from an emailed link.
 *
 * Covers both kinds this product issues: the stored 32-byte random token used
 * for export and deletion, and the dotted `payload.signature` token used for
 * unsubscribe and opt-in confirmation. Bounded on both ends so an oversized
 * value is a 400 rather than something the database has to look at.
 */
export const linkTokenSchema = z
  .string()
  .min(20)
  .max(400)
  .regex(/^[A-Za-z0-9_.-]+$/, 'That link is not valid.');

export const unsubscribeSchema = z.object({ token: linkTokenSchema });
export const confirmOptInSchema = z.object({ token: linkTokenSchema });

/**
 * The outcome of following a consent link.
 *
 * Deliberately uniform: an expired token, an unknown token, and a token for a
 * contact that has since been deleted all produce the same `invalid` result
 * with the same wording. Distinguishing them would turn the endpoint into an
 * oracle for whether a given address is a lead in a given workspace.
 */
export interface ConsentLinkResult {
  readonly outcome: 'unsubscribed' | 'confirmed' | 'already' | 'invalid';
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Self-service export and deletion
// ---------------------------------------------------------------------------

export const PRIVACY_REQUEST_KIND_VALUES = ['export', 'deletion'] as const;
export type PrivacyRequestKindValue = (typeof PRIVACY_REQUEST_KIND_VALUES)[number];

export const PRIVACY_REQUEST_KIND_LABELS: Readonly<Record<PrivacyRequestKindValue, string>> = {
  export: 'Send me my data',
  deletion: 'Delete my data',
};

/**
 * Starting a request needs the address and the workspace it belongs to.
 *
 * The workspace is identified by a published widget's PUBLIC id rather than its
 * internal one, because that is the only identifier a visitor has ever seen -
 * it is in the embed snippet on the page they filled in.
 */
export const startPrivacyRequestSchema = z.object({
  publicWidgetId: z.string().min(8).max(64),
  email: emailSchema,
  kind: z.enum(['export', 'deletion']),
});

export type StartPrivacyRequestInput = z.infer<typeof startPrivacyRequestSchema>;

export const completePrivacyRequestSchema = z.object({ token: linkTokenSchema });

/**
 * What a verified export contains.
 *
 * One workspace's view of one contact, which is the boundary 4.8 draws:
 * "export data or request deletion within one workspace". A contact who
 * submitted to two customers gets two separate answers, because the two
 * workspaces are separate controllers of that data.
 */
export interface PrivacyExport {
  readonly workspace: string;
  readonly generatedAt: string;
  readonly contact: {
    readonly email: string;
    readonly name: string | null;
    readonly phone: string | null;
    readonly company: string | null;
    readonly firstSubmissionAt: string;
    readonly lastSubmissionAt: string;
    readonly consentState: ConsentStateValue;
  };
  readonly submissions: readonly {
    readonly submittedAt: string;
    readonly pageUrl: string | null;
    readonly values: Readonly<Record<string, string>>;
  }[];
  readonly consentEvents: readonly ConsentEventSummary[];
}

export interface PrivacyRequestStarted {
  /**
   * Always true, whatever happened.
   *
   * The endpoint answers identically for an address that is a lead and one that
   * is not. Anything else would let a stranger enumerate a workspace's contacts
   * one address at a time, which is a worse privacy failure than the one this
   * flow exists to fix.
   */
  readonly accepted: true;
  readonly message: string;
}

export interface PrivacyRequestCompleted {
  readonly kind: PrivacyRequestKindValue;
  readonly export: PrivacyExport | null;
  readonly message: string;
}
