import type { EmailSendResult, EmailSender, OutboundEmail } from '../../ports/email-sender.js';

/**
 * Brevo transactional email (blueprint section 5.1).
 *
 * Implemented directly against `POST https://api.brevo.com/v3/smtp/email` with
 * an `api-key` header rather than pulling in the vendor SDK: the payload is a
 * handful of fields, and a dependency-free adapter is easier to fake and to
 * keep free of surprising transitive packages.
 *
 * Failure classification matters for Stage 9 retries, so it is done correctly
 * now: 4xx other than 429 is PERMANENT and must never be retried as though it
 * were transient (blueprint section 5.3); 429 and 5xx are transient.
 */
export interface BrevoOptions {
  readonly apiKey: string;
  readonly fromEmail: string;
  readonly fromName: string;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
}

interface BrevoResponseBody {
  readonly messageId?: string;
}

export class BrevoEmailSender implements EmailSender {
  readonly name = 'brevo';
  readonly #options: BrevoOptions;

  constructor(options: BrevoOptions) {
    this.#options = options;
  }

  async send(message: OutboundEmail): Promise<EmailSendResult> {
    const endpoint = this.#options.endpoint ?? 'https://api.brevo.com/v3/smtp/email';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'api-key': this.#options.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: this.#options.fromEmail, name: this.#options.fromName },
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
        }),
        signal: AbortSignal.timeout(this.#options.timeoutMs ?? 10_000),
      });

      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as BrevoResponseBody;
        return { status: 'sent', providerId: body.messageId ?? null };
      }

      const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
      return {
        status: 'failed',
        permanent,
        // Status only. A provider body can echo the recipient address, and
        // blueprint section 16.1 keeps addresses out of logs and errors.
        reason: `brevo_http_${String(response.status)}`,
      };
    } catch (error) {
      return {
        status: 'failed',
        permanent: false,
        reason: error instanceof Error ? error.name : 'unknown_error',
      };
    }
  }
}
