/**
 * TOTP port (RFC 6238), per blueprint 4.2: optional authenticator-app MFA.
 */

export interface TotpEnrollment {
  /** Base32 secret. Shown once for manual entry, then encrypted at rest. */
  readonly secret: string;
  /** otpauth:// URI the authenticator app scans. */
  readonly otpauthUri: string;
}

export interface TotpVerification {
  readonly valid: boolean;
  /**
   * Counter the accepted code belongs to.
   *
   * The caller persists this and refuses anything at or below it, which is what
   * stops the same code being replayed inside its 30-second window.
   */
  readonly counter: number | null;
}

export interface TotpService {
  /** Generate a new secret and its enrollment URI for this account. */
  enroll(accountLabel: string): TotpEnrollment;
  /** Verify a submitted code against a secret, allowing for clock drift. */
  verify(secret: string, code: string, now: Date): TotpVerification;
  /** Generate the current code. Test-only; never called by a request path. */
  generate(secret: string, now: Date): string;
}
