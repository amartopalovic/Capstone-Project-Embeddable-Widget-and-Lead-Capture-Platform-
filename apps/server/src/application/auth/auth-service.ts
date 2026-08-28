import type { ObjectId } from 'mongodb';
import type { Logger } from '@lcp/contracts';
import type { AuditEventRepository, UserRepository, WithIdUser } from './types.js';
import type { PasswordHasher } from '../../ports/password-hasher.js';
import type { BreachChecker } from '../../ports/breach-checker.js';
import type { EmailSender } from '../../ports/email-sender.js';
import type { Clock } from '../../ports/clock.js';
import { assessPassword } from '../../domain/auth/password-policy.js';
import {
  EMAIL_VERIFICATION_TTL_HOURS,
  PASSWORD_RESET_TTL_HOURS,
  expiryFromNow,
  generateToken,
  hashToken,
  isExpired,
} from '../../domain/auth/tokens.js';
import {
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from '../../infrastructure/email/templates.js';

/**
 * Authentication application service (blueprint sections 4.2, 10.3).
 *
 * Two rules shape almost every method here:
 *
 *  1. **Generic responses.** Registration, verification resend, and reset
 *     request return the SAME result whether or not the account exists, and
 *     login returns the same failure whether the account is unknown, the
 *     password is wrong, or the account is locked. Section 10.3 requires this
 *     so an attacker cannot enumerate accounts.
 *  2. **No credential material escapes.** Passwords, plaintext tokens, and
 *     session identifiers never enter a log, an audit record, or a returned
 *     error (section 16.1).
 *
 * No Express type appears here; the HTTP layer adapts these results into
 * responses (section 6.2).
 */

export const MAX_FAILED_LOGINS = 10;
export const LOCKOUT_MINUTES = 15;

export type RegisterOutcome = { readonly kind: 'accepted' };

export type LoginOutcome =
  | { readonly kind: 'success'; readonly user: WithIdUser }
  | { readonly kind: 'invalid_credentials' };

export type VerifyOutcome =
  { readonly kind: 'verified'; readonly userId: ObjectId } | { readonly kind: 'invalid_token' };

export type ResetConfirmOutcome =
  | { readonly kind: 'reset'; readonly userId: ObjectId }
  | { readonly kind: 'invalid_token' }
  | { readonly kind: 'weak_password'; readonly problems: readonly string[] };

export type PasswordCheckOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'weak_password'; readonly problems: readonly string[] };

export interface AuthServiceDeps {
  readonly users: UserRepository;
  readonly auditEvents: AuditEventRepository;
  readonly hasher: PasswordHasher;
  readonly breachChecker: BreachChecker;
  readonly email: EmailSender;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly appBaseUrl: string;
}

export class AuthService {
  readonly #deps: AuthServiceDeps;

  constructor(deps: AuthServiceDeps) {
    this.#deps = deps;
  }

  // -------------------------------------------------------------- passwords

  /** Offline policy plus the breach check. Never echoes the password. */
  async checkPassword(password: string, email?: string): Promise<PasswordCheckOutcome> {
    const assessment = assessPassword(password, email);
    if (!assessment.acceptable) {
      return { kind: 'weak_password', problems: assessment.problems };
    }
    if (await this.#deps.breachChecker.isBreached(password)) {
      return {
        kind: 'weak_password',
        problems: ['This password has appeared in a known data breach. Choose a different one.'],
      };
    }
    return { kind: 'ok' };
  }

  // ----------------------------------------------------------- registration

  /**
   * Register an account.
   *
   * Always resolves to `accepted`, even when the address is already in use.
   * In that case no second account is created and no verification mail is sent
   * to the new requester; the existing owner is notified nothing changed only
   * insofar as they receive no mail at all. The caller cannot tell the two
   * cases apart, which is the point.
   */
  async register(email: string, password: string, correlationId: string): Promise<RegisterOutcome> {
    const { users, hasher, clock, logger } = this.#deps;
    const now = clock.now();
    const normalized = email.trim().toLowerCase();

    const existing = await users.findByEmail(normalized);
    if (existing !== null) {
      logger.info('auth.register.duplicate', {
        correlationId,
        userId: existing._id.toHexString(),
        result: 'success',
      });
      // Deliberately identical outcome to a fresh registration.
      return { kind: 'accepted' };
    }

    const passwordHash = await hasher.hash(password);
    const token = generateToken();

    const created = await users.insert({
      email: email.trim(),
      normalizedEmail: normalized,
      emailVerifiedAt: null,
      status: 'active',
      deletedAt: null,
      purgeAfter: null,
      passwordHash,
      passwordUpdatedAt: now,
      emailVerification: {
        tokenHash: hashToken(token),
        expiresAt: expiryFromNow(now, EMAIL_VERIFICATION_TTL_HOURS),
        issuedAt: now,
      },
      passwordReset: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await this.#sendVerification(created.email, token);
    await this.#audit('auth.registered', created._id, correlationId);

    logger.info('auth.registered', {
      correlationId,
      userId: created._id.toHexString(),
      result: 'success',
    });

    return { kind: 'accepted' };
  }

  async #sendVerification(email: string, token: string): Promise<void> {
    const url = `${this.#deps.appBaseUrl}/auth/verify?token=${encodeURIComponent(token)}`;
    await this.#deps.email.send(verificationEmail(email, url));
  }

  /** Always reports acceptance, whether or not the address exists. */
  async resendVerification(email: string, correlationId: string): Promise<RegisterOutcome> {
    const { users, clock } = this.#deps;
    const now = clock.now();
    const user = await users.findByEmail(email);

    if (user !== null && user.emailVerifiedAt === null) {
      const token = generateToken();
      await users.updateById(user._id, {
        emailVerification: {
          tokenHash: hashToken(token),
          expiresAt: expiryFromNow(now, EMAIL_VERIFICATION_TTL_HOURS),
          issuedAt: now,
        },
        updatedAt: now,
      });
      await this.#sendVerification(user.email, token);
      await this.#audit('auth.verification_resent', user._id, correlationId);
    }

    return { kind: 'accepted' };
  }

  // ----------------------------------------------------------- verification

  async verifyEmail(token: string, correlationId: string): Promise<VerifyOutcome> {
    const { users, clock } = this.#deps;
    const now = clock.now();
    const tokenHash = hashToken(token);

    const user = await users.findByEmailVerificationTokenHash(tokenHash);
    if (user === null || user.emailVerification === null) {
      return { kind: 'invalid_token' };
    }
    if (isExpired(user.emailVerification.expiresAt, now)) {
      return { kind: 'invalid_token' };
    }

    // Atomic consume: a concurrent second redemption matches nothing.
    const consumed = await users.consumeEmailVerification(user._id, tokenHash, now);
    if (!consumed) return { kind: 'invalid_token' };

    await this.#audit('auth.email_verified', user._id, correlationId);
    return { kind: 'verified', userId: user._id };
  }

  // ------------------------------------------------------------------ login

  /**
   * Verify credentials.
   *
   * Every failure path returns the identical `invalid_credentials` outcome:
   * unknown account, wrong password, locked account, and an account with no
   * password set. A dummy hash verification runs when the account does not
   * exist so the response time does not reveal existence either.
   */
  async login(email: string, password: string, correlationId: string): Promise<LoginOutcome> {
    const { users, hasher, clock, logger } = this.#deps;
    const now = clock.now();

    const user = await users.findByEmail(email);

    if (user === null || user.passwordHash === null) {
      // Constant-ish work for an unknown account, so timing does not leak.
      await hasher.verify(DUMMY_ARGON2_HASH, password);
      logger.info('auth.login.failed', {
        correlationId,
        reason: 'unknown',
        result: 'client_error',
      });
      return { kind: 'invalid_credentials' };
    }

    if (user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime()) {
      logger.warn('auth.login.locked', {
        correlationId,
        userId: user._id.toHexString(),
        result: 'client_error',
      });
      return { kind: 'invalid_credentials' };
    }

    const valid = await hasher.verify(user.passwordHash, password);
    if (!valid) {
      const attempts = await users.recordFailedLogin(user._id, null);
      if (attempts >= MAX_FAILED_LOGINS) {
        await users.updateById(user._id, {
          lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000),
        });
        await this.#audit('auth.account_locked', user._id, correlationId);
      }
      logger.info('auth.login.failed', {
        correlationId,
        userId: user._id.toHexString(),
        reason: 'bad_password',
        result: 'client_error',
      });
      return { kind: 'invalid_credentials' };
    }

    await users.recordSuccessfulLogin(user._id, now);
    await this.#audit('auth.logged_in', user._id, correlationId);

    return { kind: 'success', user };
  }

  // --------------------------------------------------------- password reset

  /** Always reports acceptance, whether or not the address exists. */
  async requestPasswordReset(email: string, correlationId: string): Promise<RegisterOutcome> {
    const { users, clock } = this.#deps;
    const now = clock.now();
    const user = await users.findByEmail(email);

    if (user !== null) {
      const token = generateToken();
      await users.updateById(user._id, {
        passwordReset: {
          tokenHash: hashToken(token),
          expiresAt: expiryFromNow(now, PASSWORD_RESET_TTL_HOURS),
          issuedAt: now,
        },
        updatedAt: now,
      });

      const url = `${this.#deps.appBaseUrl}/auth/reset?token=${encodeURIComponent(token)}`;
      await this.#deps.email.send(passwordResetEmail(user.email, url));
      await this.#audit('auth.password_reset_requested', user._id, correlationId);
    }

    return { kind: 'accepted' };
  }

  async confirmPasswordReset(
    token: string,
    newPassword: string,
    correlationId: string,
  ): Promise<ResetConfirmOutcome> {
    const { users, hasher, clock } = this.#deps;
    const now = clock.now();
    const tokenHash = hashToken(token);

    const user = await users.findByPasswordResetTokenHash(tokenHash);
    if (user === null || user.passwordReset === null) return { kind: 'invalid_token' };
    if (isExpired(user.passwordReset.expiresAt, now)) return { kind: 'invalid_token' };

    const policy = await this.checkPassword(newPassword, user.normalizedEmail);
    if (policy.kind === 'weak_password') {
      return { kind: 'weak_password', problems: policy.problems };
    }

    const passwordHash = await hasher.hash(newPassword);
    const consumed = await users.consumePasswordReset(user._id, tokenHash, passwordHash, now);
    if (!consumed) return { kind: 'invalid_token' };

    await this.#deps.email.send(passwordChangedEmail(user.email, this.#deps.appBaseUrl));
    await this.#audit('auth.password_reset_completed', user._id, correlationId);

    return { kind: 'reset', userId: user._id };
  }

  // ------------------------------------------------------------------ audit

  /**
   * Append an audit record (blueprint section 9.3: actor plus correlation ID).
   *
   * AuditEvent is workspace-scoped, but authentication happens before any
   * workspace is selected and a user may belong to many. Account-level events
   * are therefore written against a fixed all-zero sentinel workspace id, which
   * belongs to no tenant and so cannot leak into a real workspace view. Stage 4
   * introduces workspace-scoped audit for membership events.
   */
  async #audit(type: string, actorUserId: ObjectId, correlationId: string): Promise<void> {
    await this.#deps.auditEvents.insertAccountEvent({
      type,
      actorUserId,
      correlationId,
      occurredAt: this.#deps.clock.now(),
      metadata: {},
    });
  }
}

/**
 * A real Argon2id digest of a random value, used only to spend comparable time
 * when an account does not exist. It authenticates nothing.
 */
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZS1maXhlZC1zYWx0LXZhbHVl$JDpQKMMxg5c3vJpVwq3wLdCJ4gTaHwCbEuiCoFxKKW0';
