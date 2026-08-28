/**
 * Breached-password checking port (blueprint section 4.2).
 *
 * An implementation must be safe to call on every registration and password
 * change, and must never receive or transmit the plaintext password to a third
 * party in a recoverable form.
 */
export interface BreachChecker {
  readonly name: string;
  /**
   * True when the password is known to be breached.
   *
   * An implementation that cannot reach its data source must return false
   * rather than throw: a network failure must not block a legitimate password
   * change. The offline list always runs regardless, so a failure here degrades
   * the check rather than removing it.
   */
  isBreached(plaintext: string): Promise<boolean>;
}
