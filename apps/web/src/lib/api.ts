import { API_PREFIX, type ApiErrorPayload, type ApiFieldError } from '@lcp/contracts';

/**
 * Typed client for the Stage 3a/3b auth API.
 *
 * Two things it always does, so no page has to remember:
 *
 *  - sends cookies, since the session is a cookie and never a bearer token;
 *  - fetches and echoes the CSRF token on every state-changing request, which
 *    is the flow the server established in Stage 3a.
 *
 * It never enforces a rule of its own. Everything it checks is already enforced
 * server-side; this layer only shapes the response for the UI.
 */

export interface ApiSuccess<T> {
  readonly ok: true;
  readonly status: number;
  readonly data: T;
}

export interface ApiFailure {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly fieldErrors: readonly ApiFieldError[];
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

/** In dev the Vite server proxies /api to the Express server; see vite.config. */
const BASE = API_PREFIX;

let cachedCsrfToken: string | null = null;

async function fetchCsrfToken(): Promise<string> {
  if (cachedCsrfToken !== null) return cachedCsrfToken;

  const response = await fetch(`${BASE}/auth/csrf`, { credentials: 'same-origin' });
  const body = (await response.json()) as { csrfToken: string };
  cachedCsrfToken = body.csrfToken;
  return cachedCsrfToken;
}

/**
 * Drop the cached token.
 *
 * The token is bound to the session identifier, so it stops being valid
 * whenever the session changes: sign-in, sign-out, and session rotation after
 * an MFA change.
 */
export function invalidateCsrfToken(): void {
  cachedCsrfToken = null;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { retryOnCsrfFailure?: boolean } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (method !== 'GET' && method !== 'HEAD') {
    headers['X-CSRF-Token'] = await fetchCsrfToken();
  }

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 204) {
    return { ok: true, status: 204, data: undefined as T };
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (response.ok) {
    return { ok: true, status: response.status, data: parsed as T };
  }

  const payload = parsed as ApiErrorPayload | null;
  const code = payload?.error.code ?? 'internal_error';

  // A rotated session invalidates the cached token. Refresh once and retry, so
  // a stale token surfaces as a retry rather than a spurious error.
  if (code === 'csrf_invalid' && options.retryOnCsrfFailure !== false) {
    invalidateCsrfToken();
    return request<T>(method, path, body, { retryOnCsrfFailure: false });
  }

  return {
    ok: false,
    status: response.status,
    code,
    message: payload?.error.message ?? 'Something went wrong. Try again.',
    fieldErrors: payload?.error.details ?? [],
  };
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

/** Pull the message for one field out of a failure, for inline display. */
export function fieldError(failure: ApiFailure, path: string): string | undefined {
  return failure.fieldErrors.find((error) => error.path === path)?.message;
}
