import * as OTPAuth from 'otpauth';
import { TOTP_DIGITS, TOTP_PERIOD_SECONDS } from '@lcp/contracts';
import type { TotpEnrollment, TotpService, TotpVerification } from '../../ports/totp.js';

/**
 * TOTP via `otpauth` (RFC 6238).
 *
 * Parameters are the authenticator-app defaults - SHA1, 6 digits, 30-second
 * period - and that is deliberate rather than lazy: Google Authenticator and
 * several other popular apps silently ignore the algorithm and digits
 * parameters in the enrollment URI, so a "stronger" choice produces codes the
 * user's app cannot generate.
 *
 * The drift window is +/-1 period, which tolerates about 30 seconds of clock
 * skew each way. `otpauth` documentation warns to keep this small and to
 * throttle, both of which this project does: the MFA challenge is rate limited
 * like every other auth flow.
 */

const SECRET_BYTES = 20; // 160 bits, the RFC 4226 recommendation.
const DRIFT_WINDOW = 1;

export class OtpauthTotpService implements TotpService {
  readonly #issuer: string;

  constructor(issuer: string) {
    this.#issuer = issuer;
  }

  #totp(secret: string, label: string): OTPAuth.TOTP {
    return new OTPAuth.TOTP({
      issuer: this.#issuer,
      label,
      algorithm: 'SHA1',
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SECONDS,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
  }

  enroll(accountLabel: string): TotpEnrollment {
    const secret = new OTPAuth.Secret({ size: SECRET_BYTES });
    const totp = this.#totp(secret.base32, accountLabel);
    return { secret: secret.base32, otpauthUri: totp.toString() };
  }

  verify(secret: string, code: string, now: Date): TotpVerification {
    let totp: OTPAuth.TOTP;
    try {
      totp = this.#totp(secret, 'verification');
    } catch {
      // A malformed stored secret is a failed verification, not a crash.
      return { valid: false, counter: null };
    }

    const timestamp = now.getTime();
    const delta = totp.validate({ token: code, window: DRIFT_WINDOW, timestamp });
    if (delta === null) return { valid: false, counter: null };

    // The accepted code belongs to the current counter shifted by the delta.
    const currentCounter = Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS);
    return { valid: true, counter: currentCounter + delta };
  }

  generate(secret: string, now: Date): string {
    return this.#totp(secret, 'generation').generate({ timestamp: now.getTime() });
  }
}
