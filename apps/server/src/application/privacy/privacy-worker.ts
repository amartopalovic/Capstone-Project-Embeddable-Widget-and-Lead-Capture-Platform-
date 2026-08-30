import { ObjectId, type Db } from 'mongodb';
import {
  COLLECTIONS,
  type ContactRecord,
  type WorkspaceRecord,
  workspaceScope,
} from '@lcp/database';
import type { Logger } from '@lcp/contracts';
import type { EmailSender } from '../../ports/email-sender.js';
import { optInConfirmationEmail } from '../../infrastructure/email/templates.js';
import { QUEUE_NAMES, type QueueRegistry } from '../../infrastructure/queue/queues.js';
import type { ConsentService } from './consent-service.js';
import type { RetentionService } from './retention-service.js';

/**
 * The two queue families Stage 11 owns (blueprint 12.1): marketing opt-in
 * email, and retention and purge.
 *
 * Kept apart from `DeliveryWorkers` because they answer to different rules.
 * Delivery work retries five times with backoff and can dead-letter; a
 * retention sweep is idempotent and simply runs again on its schedule, so
 * dead-lettering one would add an operator alert for something that fixes
 * itself. And marketing mail is the only family here that consults the
 * suppression list before sending.
 */

export interface OptInJobData {
  readonly workspaceId: string;
  readonly contactId: string;
}

export interface PrivacyWorkersDeps {
  readonly db: Db;
  readonly registry: QueueRegistry;
  readonly logger: Logger;
  readonly emailSender: EmailSender;
  readonly consent: ConsentService;
  readonly retention: RetentionService;
  readonly appUrl: string;
}

export class PrivacyWorkers {
  readonly #deps: PrivacyWorkersDeps;
  #started = false;

  constructor(deps: PrivacyWorkersDeps) {
    this.#deps = deps;
  }

  /**
   * Ask for a double opt-in confirmation to be sent.
   *
   * Never throws, for the same reason `DeliveryWorkers.enqueue` does not: this
   * is called after a submission has already been accepted and answered, and a
   * Redis outage must not retroactively fail it.
   *
   * A lost enqueue is recoverable without an outbox row, which is why this
   * family does not have one. The contact stays in `pending`, and the consent
   * machine re-sends the confirmation the next time that address submits a form
   * with the box ticked. The cost of a lost job is a subscription that is not
   * confirmed - which is the safe direction to fail in, since an unconfirmed
   * address receives nothing.
   */
  async requestConfirmation(workspaceId: ObjectId, contactId: ObjectId): Promise<void> {
    try {
      const queue = this.#deps.registry.queue(QUEUE_NAMES.marketingOptIn);
      const data: OptInJobData = {
        workspaceId: workspaceId.toHexString(),
        contactId: contactId.toHexString(),
      };
      await queue.add('confirm', data, {
        // One pending confirmation per contact. A visitor who submits the same
        // form three times in a minute gets one email, not three.
        jobId: `optin:${data.workspaceId}:${data.contactId}`,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      });
    } catch (error) {
      this.#deps.logger.warn('consent.optin_enqueue_failed', {
        result: 'degraded',
        reason: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      });
    }
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;

    this.#deps.registry.work(QUEUE_NAMES.marketingOptIn, async (job) => {
      await this.deliverConfirmation(job.data as OptInJobData);
    });

    /**
     * Concurrency 1. The sweeps delete across collections that the other jobs
     * read, and a second concurrent pass would find the same records the first
     * one is mid-way through retiring.
     */
    this.#deps.registry.work(
      QUEUE_NAMES.retentionPurge,
      async () => {
        await this.#deps.retention.sweep();
      },
      1,
    );
  }

  /**
   * Send one double opt-in confirmation (blueprint 4.8).
   *
   * Public rather than private because it is the job's whole body, and the
   * integration tests drive it directly - the same way the Stage 9 delivery
   * tests call `attempt` rather than racing a background worker. It is a real
   * method the worker uses, not a hatch that exists only for tests.
   *
   * Re-reads the contact rather than trusting the job payload, and re-checks
   * consent, because a job can sit in the queue while the world moves: the
   * contact may have confirmed from another email, unsubscribed, or been
   * deleted since it was enqueued. Sending to somebody who unsubscribed in the
   * interval is exactly the failure this stage exists to prevent, so the check
   * happens at the moment of sending rather than the moment of queueing.
   */
  async deliverConfirmation(data: OptInJobData): Promise<void> {
    const workspaceId = new ObjectId(data.workspaceId);
    const scope = workspaceScope(workspaceId);

    const contact = await this.#deps.db
      .collection<ContactRecord>(COLLECTIONS.contacts)
      .findOne({ _id: new ObjectId(data.contactId), workspaceId, recordStatus: 'active' });
    if (contact === null || contact.consentState !== 'pending') return;

    const workspace = await this.#deps.db
      .collection<WorkspaceRecord>(COLLECTIONS.workspaces)
      .findOne({ _id: workspaceId, status: 'active' });
    if (workspace === null) return;

    /**
     * The suppression check, at the last possible moment.
     *
     * A `pending` contact should not normally be suppressed, but the two can
     * disagree: an address that unsubscribed, had its contact deleted, and then
     * submitted a new form arrives here as a fresh `pending` contact with no
     * memory of the unsubscribe. The suppression list remembers, and it wins.
     */
    if (await this.#deps.consent.isSuppressed(scope, contact.normalizedEmail)) {
      this.#deps.logger.info('consent.optin_suppressed', {
        result: 'success',
        workspaceId: data.workspaceId,
      });
      return;
    }

    const confirmUrl = `${this.#deps.appUrl}/consent/confirm?token=${this.#deps.consent.confirmToken(workspaceId, contact._id)}`;
    const unsubscribeUrl = `${this.#deps.appUrl}/consent/unsubscribe?token=${this.#deps.consent.unsubscribeToken(workspaceId, contact._id)}`;

    await this.#deps.emailSender.send(
      optInConfirmationEmail(contact.email, workspace.name, confirmUrl, unsubscribeUrl),
    );

    this.#deps.logger.info('consent.optin_sent', {
      result: 'success',
      workspaceId: data.workspaceId,
    });
  }

  /**
   * Schedule the retention sweep (blueprint 9.5, 12.1).
   *
   * Daily. Every window in the 9.5 table is measured in days or months, so
   * running more often would spend Upstash commands to arrive at the same
   * answer - blueprint 21 names command consumption as a real free-tier risk.
   *
   * The schedule alone is not the guarantee. A BullMQ job scheduler holds one
   * pending iteration and re-arms from the moment it is upserted, so a process
   * that slept through several daily slots wakes to one late run rather than
   * several - and an upsert during boot can push the next slot past a deadline
   * that has already passed. `RetentionService.catchUp` at startup is what
   * closes that, which is why 9.5 asks for both.
   */
  async scheduleRetention(everyMs = 86_400_000): Promise<void> {
    try {
      const queue = this.#deps.registry.queue(QUEUE_NAMES.retentionPurge);
      await queue.upsertJobScheduler(
        'retention-sweep',
        { every: everyMs },
        {
          name: 'sweep',
          opts: { removeOnComplete: { count: 20 }, removeOnFail: { count: 50 } },
        },
      );
    } catch (error) {
      this.#deps.logger.warn('retention.schedule_failed', {
        result: 'degraded',
        reason: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      });
    }
  }
}
