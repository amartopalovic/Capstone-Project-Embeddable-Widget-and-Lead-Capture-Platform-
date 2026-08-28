/**
 * Password hashing port (blueprint section 4.2 locks Argon2id).
 *
 * Behind an interface so the application service never imports a hashing
 * library directly, and so a parameter upgrade is one adapter change.
 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  /** Constant-time verification. Returns false rather than throwing. */
  verify(digest: string, plaintext: string): Promise<boolean>;
  /** True when the stored digest uses weaker parameters than current policy. */
  needsRehash(digest: string): boolean;
}
