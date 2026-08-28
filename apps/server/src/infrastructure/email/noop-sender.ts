import type { EmailSendResult, EmailSender, OutboundEmail } from '../../ports/email-sender.js';

/**
 * Deterministic capture sender.
 *
 * Used when no provider is configured, and by unit tests that need to assert
 * what would have been sent. It never performs I/O, so it cannot make a test
 * flaky or accidentally contact a provider.
 */
export class CapturingEmailSender implements EmailSender {
  readonly name = 'capturing';
  readonly sent: OutboundEmail[] = [];

  async send(message: OutboundEmail): Promise<EmailSendResult> {
    this.sent.push(message);
    return { status: 'sent', providerId: `captured-${String(this.sent.length)}` };
  }

  clear(): void {
    this.sent.length = 0;
  }
}
