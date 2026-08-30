import { ObjectId, type Db } from 'mongodb';
import {
  COLLECTIONS,
  workspaceScope,
  type ConsentEventRecord,
  type ContactRecord,
  type SuppressionRepository,
  type WorkspaceRecord,
  type WorkspaceScope,
} from '@lcp/database';
import type { ConsentLinkResult, Logger } from '@lcp/contracts';
import type { Clock } from '../../ports/clock.js';
import { consentTextVersion, nextConsent } from '../../domain/privacy/consent.js';
import { signConsentLink, verifyConsentLink } from '../../domain/privacy/links.js';
import { suppressionKey } from '../../domain/privacy/suppression.js';

/**
 * Unsubscribe and double opt-in (blueprint 4.8).
 *
 * Both arrive as a signed token from an emailed link, from somebody with no
 * session, so this service is the whole authorization boundary: the signature
 * proves the link came from us, and the claims inside it name the exact
 * workspace and contact the caller may act on. Nothing is read from the request
 * beyond that token.
 *
 * Every failure answers identically. An unknown token, a bad signature, a
 * contact that has since been purged, and a workspace that has been deleted all
 * produce `invalid` with the same wording - because a response that
 * distinguished them would tell a stranger whether a given address is a lead in
 * a given workspace, one guess at a time.
 */

export interface ConsentServiceDeps {
  readonly db: Db;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly suppressions: SuppressionRepository;
  /** Master secret for the link signature and the suppression key (9.4). */
  readonly ipHmacSecret: string;
}

/** The wording used when a link cannot be acted on. Deliberately uniform. */
const INVALID_MESSAGE = 'This link is no longer valid. It may have already been used.';

export class ConsentService {
  readonly #deps: ConsentServiceDeps;

  constructor(deps: ConsentServiceDeps) {
    this.#deps = deps;
  }

  /** The unsubscribe URL that goes into every marketing email. */
  unsubscribeToken(workspaceId: ObjectId, contactId: ObjectId): string {
    return signConsentLink(this.#deps.ipHmacSecret, {
      purpose: 'unsubscribe',
      workspaceId: workspaceId.toHexString(),
      contactId: contactId.toHexString(),
    });
  }

  /** The confirmation URL that goes into a double opt-in email. */
  confirmToken(workspaceId: ObjectId, contactId: ObjectId): string {
    return signConsentLink(this.#deps.ipHmacSecret, {
      purpose: 'confirm',
      workspaceId: workspaceId.toHexString(),
      contactId: contactId.toHexString(),
    });
  }

  /**
   * Stop all marketing mail for this address, workspace-wide (blueprint 4.8).
   *
   * Two writes, and the order is the point. The SUPPRESSION goes in first,
   * because it is what actually stops mail and it survives the contact being
   * deleted later; the contact's own state follows as the human-readable
   * version of the same fact. A crash between them leaves the address
   * suppressed with a stale contact state, which is the harmless way round.
   */
  async unsubscribe(token: string): Promise<ConsentLinkResult> {
    const found = await this.#resolve(token, 'unsubscribe');
    if (found === null) return { outcome: 'invalid', message: INVALID_MESSAGE };

    const { scope, contact } = found;
    const now = this.#deps.clock.now();

    if (contact.consentState === 'withdrawn') {
      return {
        outcome: 'already',
        message: 'You are already unsubscribed. No further marketing email will be sent.',
      };
    }

    const outcome = nextConsent(contact.consentState, { kind: 'withdrawn' }, 'double');

    await this.#deps.suppressions.suppress(
      scope,
      this.#keyFor(scope, contact.normalizedEmail),
      'unsubscribed',
      now,
    );
    await this.#setState(scope, contact, outcome.state, now);
    await this.#recordEvent(scope, contact, {
      type: 'withdrawal',
      granted: false,
      text: 'Unsubscribed from marketing email',
      source: 'unsubscribe_link',
      now,
    });

    this.#deps.logger.info('consent.unsubscribed', {
      result: 'success',
      workspaceId: scope.workspaceId.toHexString(),
      contactId: contact._id.toHexString(),
    });

    return {
      outcome: 'unsubscribed',
      message: 'You have been unsubscribed. No further marketing email will be sent.',
    };
  }

  /**
   * Confirm a double opt-in (blueprint 4.8).
   *
   * Only a `pending` contact can be confirmed - the state machine refuses every
   * other starting point, so a link followed twice, or followed after an
   * unsubscribe, cannot quietly resurrect consent.
   */
  async confirmOptIn(token: string): Promise<ConsentLinkResult> {
    const found = await this.#resolve(token, 'confirm');
    if (found === null) return { outcome: 'invalid', message: INVALID_MESSAGE };

    const { scope, contact } = found;
    const now = this.#deps.clock.now();

    if (contact.consentState === 'confirmed') {
      return { outcome: 'already', message: 'Your subscription is already confirmed.' };
    }

    const outcome = nextConsent(contact.consentState, { kind: 'confirmed' }, 'double');
    if (outcome.state !== 'confirmed') {
      // Withdrawn, or never asked. Answered as an invalid link rather than
      // explaining which, for the reason at the top of this file.
      return { outcome: 'invalid', message: INVALID_MESSAGE };
    }

    await this.#setState(scope, contact, 'confirmed', now);
    if (outcome.release) {
      await this.#deps.suppressions.release(scope, this.#keyFor(scope, contact.normalizedEmail));
    }
    await this.#recordEvent(scope, contact, {
      type: 'confirmation',
      granted: true,
      text: 'Confirmed subscription from the emailed link',
      source: 'double_opt_in_email',
      now,
    });

    this.#deps.logger.info('consent.confirmed', {
      result: 'success',
      workspaceId: scope.workspaceId.toHexString(),
      contactId: contact._id.toHexString(),
    });

    return { outcome: 'confirmed', message: 'Thank you. Your subscription is confirmed.' };
  }

  /**
   * Whether a marketing message may be sent to this contact.
   *
   * Both halves are checked: the contact's own consent state AND the workspace
   * suppression list. They are usually the same answer, and the one case where
   * they differ is the one that matters - an address that unsubscribed, had its
   * contact deleted, and then submitted a new form. The new contact starts at
   * `none` with no memory of the unsubscribe; the suppression list remembers.
   */
  async mayReceiveMarketing(scope: WorkspaceScope, contact: ContactRecord): Promise<boolean> {
    if (contact.consentState !== 'confirmed') return false;
    return !(await this.#deps.suppressions.isSuppressed(
      scope,
      this.#keyFor(scope, contact.normalizedEmail),
    ));
  }

  /** Whether this address is on the workspace suppression list. */
  async isSuppressed(scope: WorkspaceScope, normalizedEmail: string): Promise<boolean> {
    return this.#deps.suppressions.isSuppressed(scope, this.#keyFor(scope, normalizedEmail));
  }

  /** Suppress an address with no contact behind it - used after a deletion. */
  async suppressAddress(
    scope: WorkspaceScope,
    normalizedEmail: string,
    reason: 'unsubscribed' | 'privacy_deletion',
  ): Promise<void> {
    await this.#deps.suppressions.suppress(
      scope,
      this.#keyFor(scope, normalizedEmail),
      reason,
      this.#deps.clock.now(),
    );
  }

  // ------------------------------------------------------------- internals

  #keyFor(scope: WorkspaceScope, normalizedEmail: string): string {
    return suppressionKey(
      this.#deps.ipHmacSecret,
      scope.workspaceId.toHexString(),
      normalizedEmail,
    );
  }

  /**
   * Turn a token into a live contact, or null.
   *
   * The scope is derived from the SIGNED claims, never from the request, so a
   * token for one workspace cannot be pointed at another's contact by editing a
   * URL - the signature covers both ids together.
   */
  async #resolve(
    token: string,
    purpose: 'unsubscribe' | 'confirm',
  ): Promise<{ scope: WorkspaceScope; contact: ContactRecord & { _id: ObjectId } } | null> {
    const claims = verifyConsentLink(this.#deps.ipHmacSecret, token);
    if (claims === null || claims.purpose !== purpose) return null;

    const workspaceId = new ObjectId(claims.workspaceId);
    const workspace = await this.#deps.db
      .collection<WorkspaceRecord>(COLLECTIONS.workspaces)
      .findOne({ _id: workspaceId, status: 'active' });
    if (workspace === null) return null;

    const scope = workspaceScope(workspaceId);
    const contact = await this.#deps.db
      .collection<ContactRecord>(COLLECTIONS.contacts)
      .findOne({ _id: new ObjectId(claims.contactId), workspaceId, recordStatus: 'active' });
    if (contact === null) return null;

    return { scope, contact };
  }

  async #setState(
    scope: WorkspaceScope,
    contact: { readonly _id: ObjectId },
    state: ContactRecord['consentState'],
    now: Date,
  ): Promise<void> {
    await this.#deps.db
      .collection<ContactRecord>(COLLECTIONS.contacts)
      .updateOne(
        { _id: contact._id, workspaceId: scope.workspaceId },
        { $set: { consentState: state, consentUpdatedAt: now, updatedAt: now } },
      );
  }

  /**
   * Append consent evidence (blueprint 4.8: the event is immutable).
   *
   * `widgetRevisionNumber` is 0 for an event raised from an emailed link, which
   * did not come from a widget at all. Zero rather than null because the field
   * is the revision a visitor saw, and "no revision" is a real, distinguishable
   * answer that every reader can handle without a nullable branch.
   */
  async #recordEvent(
    scope: WorkspaceScope,
    contact: { readonly _id: ObjectId },
    input: {
      readonly type: ConsentEventRecord['type'];
      readonly granted: boolean;
      readonly text: string;
      readonly source: ConsentEventRecord['source'];
      readonly now: Date;
    },
  ): Promise<void> {
    await this.#deps.db.collection<ConsentEventRecord>(COLLECTIONS.consentEvents).insertOne({
      _id: new ObjectId(),
      workspaceId: scope.workspaceId,
      contactId: contact._id,
      submissionEventId: null,
      type: input.type,
      granted: input.granted,
      text: input.text,
      textVersion: consentTextVersion(input.text),
      source: input.source,
      widgetRevisionNumber: 0,
      ipPseudonym: null,
      occurredAt: input.now,
    });
  }
}
