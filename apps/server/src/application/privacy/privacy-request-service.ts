import type { Db, ObjectId } from 'mongodb';
import {
  COLLECTIONS,
  workspaceScope,
  type ConsentEventRecord,
  type ContactRecord,
  type PrivacyRequestRecord,
  type PrivacyRequestRepository,
  type SubmissionEventRecord,
  type WidgetRecord,
  type WorkspaceRecord,
  type WorkspaceScope,
} from '@lcp/database';
import type {
  Logger,
  PrivacyExport,
  PrivacyRequestCompleted,
  PrivacyRequestKindValue,
  StartPrivacyRequestInput,
} from '@lcp/contracts';
import type { Clock } from '../../ports/clock.js';
import { expiryFromNow, generateToken, hashToken, isExpired } from '../../domain/auth/tokens.js';
import type { ConsentService } from './consent-service.js';

/**
 * Contact self-service: email-verified export and deletion (blueprint 4.8).
 *
 * "Email-verified flow to export data or request deletion within one
 * workspace." Two things in that sentence do the work.
 *
 * **Email-verified.** The token is the authorization and there is no other way
 * in - no session, no secondary check, no support override. It is the account
 * verification token construction reused verbatim: 32 random bytes, stored only
 * as a SHA-256 hash, single-use, with an expiry. Anything weaker would let
 * somebody who guesses an address read or destroy another person's lead record,
 * which is a worse outcome than the flow prevents.
 *
 * **Within one workspace.** A contact who filled in forms for two customers has
 * two separate records held by two separate controllers, and this answers for
 * one of them. The workspace is identified by the public widget id from the
 * page they actually filled in, because that is the only identifier they have
 * ever seen.
 */

/**
 * How long a verification link lives.
 *
 * Matched to account email verification rather than to the one-hour password
 * reset: this is a "confirm it was you" step for somebody who may check their
 * email tomorrow, not a credential change to be done immediately.
 */
export const PRIVACY_REQUEST_TTL_HOURS = 24;

export interface PrivacyRequestServiceDeps {
  readonly db: Db;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly privacyRequests: PrivacyRequestRepository;
  readonly consent: ConsentService;
  /** Sends the verification email. Never throws; a send failure is logged. */
  readonly sendVerification: (input: {
    readonly to: string;
    readonly token: string;
    readonly kind: PrivacyRequestKindValue;
    readonly workspaceName: string;
  }) => Promise<void>;
}

export class PrivacyRequestService {
  readonly #deps: PrivacyRequestServiceDeps;

  constructor(deps: PrivacyRequestServiceDeps) {
    this.#deps = deps;
  }

  /**
   * Begin a request.
   *
   * Returns nothing about what was found, always. If the address is not a lead
   * in that workspace, no record is created and no email is sent - and the
   * caller is told the same thing either way. Reporting "no such contact" would
   * turn this endpoint into a membership oracle: anyone could test addresses
   * against a workspace's lead list at the rate they could type them.
   *
   * The cost of that choice is that somebody who mistypes their address waits
   * for an email that never arrives. That is the right trade: the wording says
   * an email is on its way *if* the address has data here.
   */
  async start(input: StartPrivacyRequestInput): Promise<void> {
    const now = this.#deps.clock.now();

    const widget = await this.#deps.db
      .collection<WidgetRecord>(COLLECTIONS.widgets)
      .findOne({ publicId: input.publicWidgetId, status: 'active' });
    if (widget === null) return;

    const workspace = await this.#deps.db
      .collection<WorkspaceRecord>(COLLECTIONS.workspaces)
      .findOne({ _id: widget.workspaceId, status: 'active' });
    if (workspace === null) return;

    const normalizedEmail = input.email.trim().toLowerCase();
    const contact = await this.#deps.db
      .collection<ContactRecord>(COLLECTIONS.contacts)
      .findOne({ workspaceId: workspace._id, normalizedEmail, recordStatus: 'active' });
    if (contact === null) return;

    const scope = workspaceScope(workspace._id);
    const token = generateToken();

    await this.#deps.privacyRequests.insert(scope, {
      contactId: contact._id,
      email: contact.email,
      normalizedEmail,
      kind: input.kind,
      status: 'pending_verification',
      tokenHash: hashToken(token),
      expiresAt: expiryFromNow(now, PRIVACY_REQUEST_TTL_HOURS),
      verifiedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await this.#deps.sendVerification({
      to: contact.email,
      token,
      kind: input.kind,
      workspaceName: workspace.name,
    });

    this.#deps.logger.info('privacy.request_started', {
      result: 'success',
      workspaceId: workspace._id.toHexString(),
      kind: input.kind,
    });
  }

  /**
   * Complete a request against a verification token.
   *
   * Single-use by state transition, not by deletion: the record moves to
   * `completed`, and every status other than `pending_verification` is refused
   * below. A replayed token therefore fails closed, and the record still says
   * what happened and when - which a deleted row could not.
   */
  async complete(token: string): Promise<PrivacyRequestCompleted | null> {
    const now = this.#deps.clock.now();

    const request = await this.#deps.privacyRequests.findByTokenHashUnscoped(hashToken(token));
    if (request === null) return null;
    if (request.status !== 'pending_verification') return null;
    if (isExpired(request.expiresAt, now)) return null;

    const scope = workspaceScope(request.workspaceId);
    const contact = await this.#deps.db
      .collection<ContactRecord>(COLLECTIONS.contacts)
      .findOne({ _id: request.contactId, workspaceId: request.workspaceId });
    if (contact === null || contact.recordStatus !== 'active') return null;

    /**
     * Verified, then acted on, in that order and as separate writes.
     *
     * The record says the address proved itself even if the work below fails,
     * which is the honest sequence: verification is a fact about the person,
     * and the export or deletion is what we then owed them.
     */
    await this.#deps.privacyRequests.updateById(scope, request._id, {
      status: 'verified',
      verifiedAt: now,
      updatedAt: now,
    });

    const result =
      request.kind === 'export'
        ? await this.#export(scope, contact, now)
        : await this.#delete(scope, contact, request, now);

    await this.#deps.privacyRequests.updateById(scope, request._id, {
      status: 'completed',
      completedAt: now,
      updatedAt: now,
      // For a deletion, the address must not survive in the request that
      // performed it. For an export there is nothing left to send it to.
      email: null,
    });

    return result;
  }

  // ------------------------------------------------------------- internals

  /**
   * Everything this workspace holds about the contact (blueprint 4.8).
   *
   * Their own data, not the workspace's notes about them: the canonical record,
   * the values they themselves submitted, and the consent evidence. Internal
   * workflow - who it was assigned to, what a salesperson wrote in a note - is
   * the workspace's commentary rather than the contact's data, and is not here.
   */
  async #export(
    scope: WorkspaceScope,
    contact: ContactRecord,
    now: Date,
  ): Promise<PrivacyRequestCompleted> {
    const workspace = await this.#deps.db
      .collection<WorkspaceRecord>(COLLECTIONS.workspaces)
      .findOne({ _id: scope.workspaceId });

    const submissions = await this.#deps.db
      .collection<SubmissionEventRecord>(COLLECTIONS.submissionEvents)
      .find({ workspaceId: scope.workspaceId, contactId: contact._id })
      .sort({ submittedAt: 1 })
      .toArray();

    const consentEvents = await this.#deps.db
      .collection<ConsentEventRecord>(COLLECTIONS.consentEvents)
      .find({ workspaceId: scope.workspaceId, contactId: contact._id })
      .sort({ occurredAt: 1 })
      .toArray();

    const payload: PrivacyExport = {
      workspace: workspace?.name ?? 'Unknown workspace',
      generatedAt: now.toISOString(),
      contact: {
        email: contact.email,
        name: contact.name,
        phone: contact.phone,
        company: contact.company,
        firstSubmissionAt: contact.firstSubmissionAt.toISOString(),
        lastSubmissionAt: contact.lastSubmissionAt.toISOString(),
        consentState: contact.consentState,
      },
      submissions: submissions.map((event) => ({
        submittedAt: event.submittedAt.toISOString(),
        pageUrl: event.source.pageUrl,
        values: event.values,
      })),
      consentEvents: consentEvents.map((event) => ({
        id: event._id.toHexString(),
        type: event.type,
        granted: event.granted,
        text: event.text,
        textVersion: event.textVersion,
        source: event.source,
        widgetRevisionNumber: event.widgetRevisionNumber,
        occurredAt: event.occurredAt.toISOString(),
      })),
    };

    this.#deps.logger.info('privacy.export_completed', {
      result: 'success',
      workspaceId: scope.workspaceId.toHexString(),
      submissions: submissions.length,
    });

    return {
      kind: 'export',
      export: payload,
      message: 'Here is everything this workspace holds about you.',
    };
  }

  /**
   * Irreversible deletion (blueprint 4.8).
   *
   * "Permanently removes or irreversibly anonymizes the contact's PII and
   * submission values for that workspace." Note what this is NOT: it is not the
   * 30-day trash. A workspace deleting a lead can change its mind; a person
   * exercising a data right has already confirmed from their own inbox, and
   * making them wait thirty days to find out whether it worked would be a worse
   * answer than doing it.
   *
   * One thing deliberately survives: the suppression entry. 4.8 allows "minimal
   * suppression data ... to honor an unsubscribe", and it is what stops the
   * next form submission from that address quietly rebuilding the record that
   * was just deleted. It is a keyed hash, so it identifies nobody who is not
   * already known to the asker.
   */
  async #delete(
    scope: WorkspaceScope,
    contact: ContactRecord & { _id: ObjectId },
    request: PrivacyRequestRecord,
    now: Date,
  ): Promise<PrivacyRequestCompleted> {
    const db = this.#deps.db;

    // First, so a failure after this point still leaves them unmailable.
    await this.#deps.consent.suppressAddress(scope, request.normalizedEmail, 'privacy_deletion');

    await db.collection<ContactRecord>(COLLECTIONS.contacts).updateOne(
      { _id: contact._id, workspaceId: scope.workspaceId },
      {
        $set: {
          email: '',
          normalizedEmail: `erased-${contact._id.toHexString()}`,
          name: null,
          phone: null,
          company: null,
          tags: [],
          assigneeUserId: null,
          consentState: 'withdrawn',
          consentUpdatedAt: now,
          recordStatus: 'deleted',
          deletedAt: now,
          // No recovery window: this deletion is the point.
          purgeAfter: null,
          updatedAt: now,
        },
      },
    );

    await db
      .collection(COLLECTIONS.submissionEvents)
      .updateMany(
        { workspaceId: scope.workspaceId, contactId: contact._id },
        { $set: { values: {} } },
      );

    await db
      .collection(COLLECTIONS.contactActivities)
      .updateMany(
        { workspaceId: scope.workspaceId, contactId: contact._id, type: 'note_added' },
        { $set: { note: null } },
      );

    this.#deps.logger.info('privacy.deletion_completed', {
      result: 'success',
      workspaceId: scope.workspaceId.toHexString(),
      contactId: contact._id.toHexString(),
    });

    return {
      kind: 'deletion',
      export: null,
      message:
        'Your data has been deleted from this workspace. Your address is kept on a suppression list, as a one-way fingerprint, so nothing further is sent to you.',
    };
  }
}
