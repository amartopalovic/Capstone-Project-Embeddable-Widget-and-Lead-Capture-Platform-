/**
 * Shared error contract (blueprint section 10.1).
 *
 * Every API error uses the same envelope: a machine-readable code, a safe
 * message, optional field-level details, and the request correlation ID.
 *
 * Messages here must stay safe to show a client: no stack traces, no driver
 * text, no identifiers belonging to another tenant, no secrets.
 */

export const ERROR_CODES = {
  VALIDATION_FAILED: 'validation_failed',
  MALFORMED_REQUEST: 'malformed_request',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  STALE_REVISION: 'stale_revision',
  RATE_LIMITED: 'rate_limited',
  // --- Authentication (Stage 3a) -------------------------------------------
  /**
   * Deliberately generic. Returned for a wrong password, an unknown account,
   * and a locked account alike, so a caller cannot distinguish them
   * (blueprint section 10.3, generic responses prevent account enumeration).
   */
  INVALID_CREDENTIALS: 'invalid_credentials',
  /** The password failed the policy in blueprint section 4.2. */
  WEAK_PASSWORD: 'weak_password',
  /** A verification or reset token is unknown, expired, or already used. */
  INVALID_TOKEN: 'invalid_token',
  /** The action requires a verified email address (blueprint section 4.1). */
  EMAIL_NOT_VERIFIED: 'email_not_verified',
  /** The CSRF token was missing or did not validate. */
  CSRF_INVALID: 'csrf_invalid',
  /** Password accepted, but a second factor is still required. */
  MFA_REQUIRED: 'mfa_required',
  /** The submitted TOTP or recovery code did not verify. */
  MFA_INVALID: 'mfa_invalid',
  QUOTA_EXCEEDED: 'quota_exceeded',
  INTERNAL_ERROR: 'internal_error',
  SERVICE_UNAVAILABLE: 'service_unavailable',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * HTTP status for each error code.
 *
 * Blueprint section 10.1 requires that expected client failures return a
 * suitable 4xx and that malformed or oversized input never becomes a 500.
 * Keeping the mapping in one table is what makes that checkable.
 */
const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  [ERROR_CODES.VALIDATION_FAILED]: 400,
  [ERROR_CODES.MALFORMED_REQUEST]: 400,
  [ERROR_CODES.PAYLOAD_TOO_LARGE]: 413,
  [ERROR_CODES.UNAUTHENTICATED]: 401,
  [ERROR_CODES.FORBIDDEN]: 403,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.CONFLICT]: 409,
  [ERROR_CODES.STALE_REVISION]: 409,
  [ERROR_CODES.RATE_LIMITED]: 429,
  [ERROR_CODES.INVALID_CREDENTIALS]: 401,
  [ERROR_CODES.WEAK_PASSWORD]: 400,
  [ERROR_CODES.INVALID_TOKEN]: 400,
  [ERROR_CODES.EMAIL_NOT_VERIFIED]: 403,
  [ERROR_CODES.CSRF_INVALID]: 403,
  [ERROR_CODES.MFA_REQUIRED]: 401,
  [ERROR_CODES.MFA_INVALID]: 401,
  [ERROR_CODES.QUOTA_EXCEEDED]: 429,
  [ERROR_CODES.INTERNAL_ERROR]: 500,
  [ERROR_CODES.SERVICE_UNAVAILABLE]: 503,
};

export function httpStatusForErrorCode(code: ErrorCode): number {
  return ERROR_STATUS[code];
}

/** True when the code represents a client mistake rather than a server fault. */
export function isClientError(code: ErrorCode): boolean {
  const status = ERROR_STATUS[code];
  return status >= 400 && status < 500;
}

export interface ApiFieldError {
  /** Dot/bracket path to the offending field, for example `contact.email`. */
  readonly path: string;
  readonly message: string;
}

export interface ApiErrorBody {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: readonly ApiFieldError[];
  readonly requestId: string;
}

export interface ApiErrorPayload {
  readonly error: ApiErrorBody;
}

export function createErrorPayload(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: readonly ApiFieldError[],
): ApiErrorPayload {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details !== undefined && details.length > 0 ? { details } : {}),
    },
  };
}
