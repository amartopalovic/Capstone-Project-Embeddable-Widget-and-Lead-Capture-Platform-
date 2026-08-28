/**
 * Authentication contracts (blueprint sections 4.2 and 10.3).
 *
 * Request schemas and response shapes shared between the server and, from
 * Stage 3b, the React application. Keeping them here means the UI cannot drift
 * from what the API actually validates.
 */

import * as z from 'zod';

// ---------------------------------------------------------------------------
// Password policy (blueprint section 4.2)
// ---------------------------------------------------------------------------

/** Minimum length is a locked decision: 12 characters. */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * An upper bound exists because every candidate password is Argon2id-hashed,
 * and hashing an unbounded string is a cheap denial-of-service vector.
 */
export const PASSWORD_MAX_LENGTH = 200;

/** Coarse strength band shown to the user as feedback, never used as a gate. */
export const PASSWORD_STRENGTH_BANDS = ['weak', 'fair', 'good', 'strong'] as const;
export type PasswordStrength = (typeof PASSWORD_STRENGTH_BANDS)[number];

export interface PasswordAssessment {
  readonly acceptable: boolean;
  readonly strength: PasswordStrength;
  /** Safe, actionable reasons. Never echoes the password itself. */
  readonly problems: readonly string[];
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

// Zod 4 moved format validators to the top level; `z.string().email()` is
// deprecated in favour of `z.email()`.
export const emailSchema = z.email('Enter a valid email address').trim().min(3).max(254);

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${String(PASSWORD_MIN_LENGTH)} characters`)
  .max(PASSWORD_MAX_LENGTH);

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  // Deliberately NOT passwordSchema: a login attempt with a short password must
  // fail as invalid credentials, not as a policy violation, or the error itself
  // reveals whether a stored password meets the current policy.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const verifyEmailRequestSchema = z.object({
  token: z.string().min(1).max(512),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const resendVerificationRequestSchema = z.object({ email: emailSchema });
export type ResendVerificationRequest = z.infer<typeof resendVerificationRequestSchema>;

export const requestPasswordResetSchema = z.object({ email: emailSchema });
export type RequestPasswordReset = z.infer<typeof requestPasswordResetSchema>;

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(1).max(512),
  password: passwordSchema,
});
export type ConfirmPasswordReset = z.infer<typeof confirmPasswordResetSchema>;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

/**
 * Safe session metadata for the device list (blueprint section 4.2).
 *
 * There is no session identifier here that could be replayed: `id` is an opaque
 * per-session handle usable only for revocation by the owning user, and the
 * session secret itself never leaves Redis and the cookie.
 */
export interface SessionSummary {
  readonly id: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  /** Coarse, non-identifying client hint. Never a raw IP (section 9.4). */
  readonly userAgentSummary: string;
  readonly current: boolean;
}

/**
 * The single response body used by registration, verification resend, and
 * reset-request, whatever actually happened underneath. See blueprint
 * section 10.3: generic responses prevent account enumeration.
 */
export interface GenericAcknowledgement {
  readonly status: 'accepted';
  readonly message: string;
}

export const GENERIC_ACK: GenericAcknowledgement = {
  status: 'accepted',
  message: 'If that email address can receive this request, a message has been sent to it.',
};
