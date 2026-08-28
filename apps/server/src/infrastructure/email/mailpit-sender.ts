import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailSendResult, EmailSender, OutboundEmail } from '../../ports/email-sender.js';

/**
 * Local development and test email, delivered by SMTP to the Mailpit service
 * already present in docker-compose.yml (blueprint section 15.1: no developer
 * needs Brevo credentials for normal local development).
 *
 * Mailpit accepts any sender and requires no authentication, so there is no
 * credential to configure or leak.
 */
export interface MailpitOptions {
  readonly host: string;
  readonly port: number;
  readonly fromEmail: string;
  readonly fromName: string;
}

export class MailpitEmailSender implements EmailSender {
  readonly name = 'mailpit';
  readonly #transport: Transporter;
  readonly #from: string;

  constructor(options: MailpitOptions) {
    this.#transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: false,
      // Mailpit presents a self-signed certificate for STARTTLS; it is a local
      // capture service, so plain SMTP is correct here and never reachable
      // outside the compose network.
      ignoreTLS: true,
    });
    this.#from = `"${options.fromName}" <${options.fromEmail}>`;
  }

  async send(message: OutboundEmail): Promise<EmailSendResult> {
    try {
      const info = await this.#transport.sendMail({
        from: this.#from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { status: 'sent', providerId: info.messageId ?? null };
    } catch (error) {
      return {
        status: 'failed',
        // A local SMTP failure is an environment problem, so transient.
        permanent: false,
        reason: error instanceof Error ? error.name : 'unknown_error',
      };
    }
  }

  close(): void {
    this.#transport.close();
  }
}
