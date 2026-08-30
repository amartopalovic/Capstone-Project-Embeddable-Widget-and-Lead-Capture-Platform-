import type { ObjectId } from 'mongodb';
import type { Logger } from '@lcp/contracts';
import type { Clock } from '../../ports/clock.js';
import type { AuditEventRepository, UserRepository, WithIdUser } from '../auth/types.js';
import {
  isRecoverable,
  purgeDeadline,
  RECOVERY_WINDOW_DAYS,
} from '../../domain/workspace/retention.js';

/**
 * Account deletion and recovery (blueprint 9.5, 10.2).
 *
 * The last of the four 30-day windows in the 9.5 table, and the only one that
 * had no route at all before this stage: contacts, widgets, and workspaces
 * could already be soft-deleted and restored, while an account could not be
 * deleted by its owner in any way.
 *
 * The window works exactly like the other three - a `deletedAt`, a `purgeAfter`
 * thirty days later, and a sweep that anonymises once the deadline passes. One
 * pattern, one piece of arithmetic in `domain/workspace/retention`, and no
 * second, looser deletion path.
 */

export type DeleteAccountOutcome =
  | { readonly kind: 'deleted'; readonly recoverableUntil: Date }
  | { readonly kind: 'owns_workspace' }
  | { readonly kind: 'not_found' };

export type RecoverAccountOutcome =
  | { readonly kind: 'recovered' }
  | { readonly kind: 'window_expired' }
  | { readonly kind: 'not_found' };

/** Verifies a password hash. The auth service's hasher, narrowed to one method. */
export interface PasswordVerifier {
  verify(hash: string, password: string): Promise<boolean>;
}

export interface AccountLifecycleDeps {
  readonly users: UserRepository;
  readonly auditEvents: AuditEventRepository;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly hasher: PasswordVerifier;
  /** Ends every session the account has open. */
  readonly revokeSessions: (userId: string) => Promise<void>;
  /** Whether this user still owns an active workspace. */
  readonly ownsWorkspace: (userId: ObjectId) => Promise<boolean>;
}

export class AccountLifecycleService {
  readonly #deps: AccountLifecycleDeps;

  constructor(deps: AccountLifecycleDeps) {
    this.#deps = deps;
  }

  /**
   * Soft-delete the caller's own account.
   *
   * Refused while they still own an active workspace. Blueprint 9.2 holds a
   * "one-owned-workspace invariant enforced with Workspace data", and a
   * workspace whose owner has been anonymised is a workspace nobody can
   * administer, invite to, or delete - its members would be stranded with no
   * route to an Owner. Transferring ownership or deleting the workspace first
   * is a deliberate step, not an obstacle: it makes the person decide what
   * happens to a tenant other people are working in.
   */
  async deleteOwnAccount(user: WithIdUser, correlationId: string): Promise<DeleteAccountOutcome> {
    if (user.status !== 'active') return { kind: 'not_found' };
    if (await this.#deps.ownsWorkspace(user._id)) return { kind: 'owns_workspace' };

    const now = this.#deps.clock.now();
    const recoverableUntil = purgeDeadline(now);

    const updated = await this.#deps.users.updateById(user._id, {
      status: 'deleted',
      deletedAt: now,
      purgeAfter: recoverableUntil,
      updatedAt: now,
    });
    if (!updated) return { kind: 'not_found' };

    /**
     * Sessions end immediately, before the window opens.
     *
     * The account is recoverable, but it is not usable in the meantime -
     * otherwise "deleted" would mean nothing for thirty days. Recovery goes
     * through signing in again, which the login path allows for an account
     * still inside its window.
     */
    await this.#deps.revokeSessions(user._id.toHexString());

    await this.#deps.auditEvents.insertAccountEvent({
      type: 'account.deleted',
      actorUserId: user._id,
      correlationId,
      occurredAt: now,
      metadata: {
        recoverableUntil: recoverableUntil.toISOString(),
        windowDays: RECOVERY_WINDOW_DAYS,
      },
    });

    this.#deps.logger.info('account.deleted', {
      result: 'success',
      userId: user._id.toHexString(),
    });

    return { kind: 'deleted', recoverableUntil };
  }

  /**
   * Restore an account inside its window, proving the password first.
   *
   * A deleted account cannot sign in - `findByEmail` filters to active users -
   * so recovery needs its own lookup, and that makes it a door into an account
   * that the normal login path does not offer. It is therefore held to the same
   * standard: the password is verified here with the same hasher, and a wrong
   * one is refused exactly as login refuses it.
   *
   * A failure answers `not_found` whether the address is unknown, active, or
   * the password is wrong. Distinguishing them would let somebody learn which
   * addresses have deleted accounts.
   */
  async recoverByCredentials(
    email: string,
    password: string,
    correlationId: string,
  ): Promise<RecoverAccountOutcome> {
    const user = await this.#deps.users.findDeletedByEmail(email);
    if (user === null || user.passwordHash === null) return { kind: 'not_found' };
    if (!(await this.#deps.hasher.verify(user.passwordHash, password))) {
      return { kind: 'not_found' };
    }
    return this.recoverAccount(user._id, correlationId);
  }

  /**
   * Restore an account inside its window.
   *
   * The window is checked with the same `isRecoverable` the widget and
   * workspace trash use, so all four windows close at the same instant relative
   * to their own deadline - and a change to that rule cannot apply to three of
   * them and miss the fourth.
   */
  async recoverAccount(userId: ObjectId, correlationId: string): Promise<RecoverAccountOutcome> {
    const user = await this.#deps.users.findById(userId);
    if (user === null) return { kind: 'not_found' };
    if (user.status !== 'deleted') return { kind: 'not_found' };

    const now = this.#deps.clock.now();
    if (!isRecoverable(user.purgeAfter, now)) return { kind: 'window_expired' };

    const restored = await this.#deps.users.updateById(user._id, {
      status: 'active',
      deletedAt: null,
      purgeAfter: null,
      updatedAt: now,
    });
    if (!restored) return { kind: 'not_found' };

    await this.#deps.auditEvents.insertAccountEvent({
      type: 'account.recovered',
      actorUserId: user._id,
      correlationId,
      occurredAt: now,
      metadata: {},
    });

    this.#deps.logger.info('account.recovered', {
      result: 'success',
      userId: user._id.toHexString(),
    });

    return { kind: 'recovered' };
  }
}
