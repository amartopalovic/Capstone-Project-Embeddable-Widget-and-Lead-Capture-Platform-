import type { ObjectId } from 'mongodb';
import type { Logger, MfaEnrollment, MfaStatus } from '@lcp/contracts';
import type { AuditEventRepository, UserRepository, WithIdUser } from './types.js';
import type { TotpService } from '../../ports/totp.js';
import type { SecretCipher } from '../../ports/secret-cipher.js';
import type { PasswordHasher } from '../../ports/password-hasher.js';
import type { Clock } from '../../ports/clock.js';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normaliseRecoveryCode,
} from '../../domain/auth/recovery-codes.js';

/**
 * TOTP multi-factor authentication (blueprint 4.2 and 17).
 *
 * MFA is OPTIONAL per section 4.2 and is never forced on. Three properties
 * shape this service:
 *
 *  1. **Enrollment is two-phase.** Generating a secret does not enable MFA. The
 *     user must return one valid code first, which proves their authenticator
 *     actually holds the secret. Enabling on generation alone would let someone
 *     lock themselves out of their own account with a half-finished setup.
 *  2. **Codes cannot be replayed.** A TOTP code stays valid for its whole
 *     period, so the highest accepted counter is stored and anything at or
 *     below it is refused.
 *  3. **Disabling requires re-authentication**, not a click: current password
 *     AND a current second factor.
 */

export type MfaBeginOutcome =
  | { readonly kind: 'enrollment'; readonly enrollment: MfaEnrollment }
  | { readonly kind: 'already_enabled' };

export type MfaConfirmOutcome =
  | { readonly kind: 'enabled'; readonly recoveryCodes: readonly string[] }
  | { readonly kind: 'no_pending_enrollment' }
  | { readonly kind: 'invalid_code' };

export type MfaVerifyOutcome = { readonly kind: 'verified' } | { readonly kind: 'invalid_code' };

export type MfaDisableOutcome =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'invalid_credentials' }
  | { readonly kind: 'not_enabled' };

export interface MfaServiceDeps {
  readonly users: UserRepository;
  readonly auditEvents: AuditEventRepository;
  readonly totp: TotpService;
  readonly cipher: SecretCipher;
  readonly hasher: PasswordHasher;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class MfaService {
  readonly #deps: MfaServiceDeps;

  constructor(deps: MfaServiceDeps) {
    this.#deps = deps;
  }

  status(user: WithIdUser): MfaStatus {
    return {
      enabled: user.mfaEnabled,
      recoveryCodesRemaining: user.recoveryCodes.filter((code) => code.usedAt === null).length,
    };
  }

  /**
   * Begin enrollment: mint a secret, store it encrypted, but leave MFA off.
   *
   * Re-running this before confirming replaces the pending secret, which is the
   * right behaviour if the user abandoned a setup or switched devices.
   */
  async beginEnrollment(user: WithIdUser, correlationId: string): Promise<MfaBeginOutcome> {
    if (user.mfaEnabled) return { kind: 'already_enabled' };

    const { totp, cipher, users, clock } = this.#deps;
    const now = clock.now();
    const enrollment = totp.enroll(user.email);

    await users.updateById(user._id, {
      totpSecret: cipher.encrypt(enrollment.secret),
      mfaEnabled: false,
      mfaEnabledAt: null,
      lastTotpCounter: null,
      updatedAt: now,
    });

    await this.#audit('auth.mfa_enrollment_started', user._id, correlationId);

    return {
      kind: 'enrollment',
      enrollment: {
        otpauthUri: enrollment.otpauthUri,
        manualEntryKey: enrollment.secret,
      },
    };
  }

  /**
   * Confirm enrollment with a valid code, enabling MFA and issuing recovery
   * codes. The plaintext codes are returned exactly once.
   */
  async confirmEnrollment(
    user: WithIdUser,
    code: string,
    correlationId: string,
  ): Promise<MfaConfirmOutcome> {
    const { totp, cipher, users, clock } = this.#deps;

    if (user.mfaEnabled || user.totpSecret === null) {
      return { kind: 'no_pending_enrollment' };
    }

    const secret = cipher.decrypt(user.totpSecret);
    if (secret === null) return { kind: 'no_pending_enrollment' };

    const now = clock.now();
    const verification = totp.verify(secret, code, now);
    if (!verification.valid) return { kind: 'invalid_code' };

    const plaintextCodes = generateRecoveryCodes();

    await users.updateById(user._id, {
      mfaEnabled: true,
      mfaEnabledAt: now,
      lastTotpCounter: verification.counter,
      recoveryCodes: plaintextCodes.map((value) => ({
        codeHash: hashRecoveryCode(value),
        usedAt: null,
      })),
      updatedAt: now,
    });

    await this.#audit('auth.mfa_enabled', user._id, correlationId);
    return { kind: 'enabled', recoveryCodes: plaintextCodes };
  }

  /**
   * Verify a second factor during login.
   *
   * Accepts either a TOTP code or one unused recovery code. Both paths mark
   * their credential spent so it cannot serve twice.
   */
  async verifyChallenge(
    user: WithIdUser,
    input: { totpCode?: string; recoveryCode?: string },
    correlationId: string,
  ): Promise<MfaVerifyOutcome> {
    if (!user.mfaEnabled) return { kind: 'invalid_code' };

    if (input.totpCode !== undefined) {
      return this.#verifyTotp(user, input.totpCode, correlationId);
    }
    if (input.recoveryCode !== undefined) {
      return this.#verifyRecoveryCode(user, input.recoveryCode, correlationId);
    }
    return { kind: 'invalid_code' };
  }

  async #verifyTotp(
    user: WithIdUser,
    code: string,
    correlationId: string,
  ): Promise<MfaVerifyOutcome> {
    const { totp, cipher, users, clock } = this.#deps;
    if (user.totpSecret === null) return { kind: 'invalid_code' };

    const secret = cipher.decrypt(user.totpSecret);
    if (secret === null) return { kind: 'invalid_code' };

    const now = clock.now();
    const verification = totp.verify(secret, code, now);
    if (!verification.valid || verification.counter === null) return { kind: 'invalid_code' };

    // Replay guard: a code is valid for a whole period, so accepting the same
    // counter twice would let an observed code be reused within that window.
    if (user.lastTotpCounter !== null && verification.counter <= user.lastTotpCounter) {
      this.#deps.logger.warn('auth.mfa.totp_replay_rejected', {
        correlationId,
        userId: user._id.toHexString(),
        result: 'client_error',
      });
      return { kind: 'invalid_code' };
    }

    await users.updateById(user._id, {
      lastTotpCounter: verification.counter,
      updatedAt: now,
    });
    return { kind: 'verified' };
  }

  async #verifyRecoveryCode(
    user: WithIdUser,
    code: string,
    correlationId: string,
  ): Promise<MfaVerifyOutcome> {
    const { users, clock } = this.#deps;
    const now = clock.now();
    const candidateHash = hashRecoveryCode(normaliseRecoveryCode(code));

    const index = user.recoveryCodes.findIndex(
      (entry) => entry.codeHash === candidateHash && entry.usedAt === null,
    );
    if (index < 0) return { kind: 'invalid_code' };

    // Rewrite the whole array with this entry spent. Single-use is the point:
    // a code that worked twice would be a standing backdoor.
    const updated = user.recoveryCodes.map((entry, position) =>
      position === index ? { ...entry, usedAt: now } : entry,
    );

    await users.updateById(user._id, { recoveryCodes: updated, updatedAt: now });
    await this.#audit('auth.mfa_recovery_code_used', user._id, correlationId);

    return { kind: 'verified' };
  }

  /** Disable MFA. Requires the current password AND a current TOTP code. */
  async disable(
    user: WithIdUser,
    password: string,
    totpCode: string,
    correlationId: string,
  ): Promise<MfaDisableOutcome> {
    const { hasher, users, clock } = this.#deps;

    if (!user.mfaEnabled) return { kind: 'not_enabled' };
    if (user.passwordHash === null) return { kind: 'invalid_credentials' };

    const passwordValid = await hasher.verify(user.passwordHash, password);
    if (!passwordValid) return { kind: 'invalid_credentials' };

    const factor = await this.#verifyTotp(user, totpCode, correlationId);
    if (factor.kind !== 'verified') return { kind: 'invalid_credentials' };

    await users.updateById(user._id, {
      totpSecret: null,
      mfaEnabled: false,
      mfaEnabledAt: null,
      lastTotpCounter: null,
      recoveryCodes: [],
      updatedAt: clock.now(),
    });

    await this.#audit('auth.mfa_disabled', user._id, correlationId);
    return { kind: 'disabled' };
  }

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
