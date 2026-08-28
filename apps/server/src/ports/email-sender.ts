/**
 * Outbound email port.
 *
 * Blueprint section 5.3 splits the provider allowance by priority:
 * authentication and privacy-critical mail always outranks side-effect mail.
 * The priority travels with the message so the budget guard can enforce that
 * without knowing what the message is for.
 */

export const EMAIL_PRIORITIES = ['critical', 'side_effect'] as const;
export type EmailPriority = (typeof EMAIL_PRIORITIES)[number];

export interface OutboundEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /**
   * `critical` covers authentication and privacy flows and draws on the
   * reserved allowance. Stage 9 introduces the first `side_effect` mail.
   */
  readonly priority: EmailPriority;
}

export type EmailSendResult =
  | { readonly status: 'sent'; readonly providerId: string | null }
  | { readonly status: 'deferred'; readonly reason: 'budget_exhausted' }
  | { readonly status: 'failed'; readonly permanent: boolean; readonly reason: string };

export interface EmailSender {
  readonly name: string;
  send(message: OutboundEmail): Promise<EmailSendResult>;
}
