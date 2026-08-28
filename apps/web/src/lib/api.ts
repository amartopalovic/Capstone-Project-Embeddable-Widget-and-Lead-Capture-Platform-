import {
  API_PREFIX,
  type ApiErrorPayload,
  type ApiFieldError,
  type AuditEntrySummary,
  type Capability,
  type InvitableRole,
  type InvitationSummary,
  type MemberSummary,
  type RecoverableWorkspaceSummary,
  type WorkspaceSummary,
  type WorkspaceUsage,
} from '@lcp/contracts';

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
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

/** Pull the message for one field out of a failure, for inline display. */
export function fieldError(failure: ApiFailure, path: string): string | undefined {
  return failure.fieldErrors.find((error) => error.path === path)?.message;
}

// ---------------------------------------------------------------------------
// Workspace endpoints (Stage 4a API)
// ---------------------------------------------------------------------------

/**
 * Typed calls for the workspace surface.
 *
 * These are thin: each one names an endpoint and its response shape and does
 * nothing else. In particular NONE of them decides what the caller may do. The
 * section 11 matrix lives on the server, and the UI asks the API what the
 * current user's role is rather than keeping a second copy of the policy that
 * could drift out of step with it.
 */
export const workspaceApi = {
  list: () =>
    api.get<{ workspaces: WorkspaceSummary[]; activeWorkspaceId: string | null }>('/workspaces'),

  /** The active workspace plus the capabilities the server derived for us. */
  current: () =>
    api.get<{ workspace: WorkspaceSummary; capabilities: Capability[] }>('/workspaces/current'),

  onboard: (name: string, timezone: string) =>
    api.post<{ workspace: WorkspaceSummary }>('/workspaces', { name, timezone }),

  switchTo: (workspaceId: string) =>
    api.post<{ workspace: WorkspaceSummary }>('/workspaces/switch', { workspaceId }),

  usage: () => api.get<WorkspaceUsage>('/workspaces/usage'),

  audit: () => api.get<{ events: AuditEntrySummary[] }>('/workspaces/audit'),

  transferOwnership: (toUserId: string) =>
    api.post<{ status: string }>('/workspaces/transfer-ownership', { toUserId }),

  softDelete: () => api.delete<{ status: string }>('/workspaces/current'),

  recoverable: () =>
    api.get<{ workspaces: RecoverableWorkspaceSummary[] }>('/workspaces/recoverable'),

  recover: (workspaceId: string) =>
    api.post<{ status: string }>(`/workspaces/${workspaceId}/recover`),

  members: () => api.get<{ members: MemberSummary[] }>('/members'),

  changeRole: (userId: string, role: InvitableRole) =>
    api.patch<{ status: string }>(`/members/${userId}/role`, { role }),

  removeMember: (userId: string) => api.delete<void>(`/members/${userId}`),

  invitations: () => api.get<{ invitations: InvitationSummary[] }>('/invitations'),

  invite: (email: string, role: InvitableRole) =>
    api.post<{ status: string }>('/invitations', { email, role }),

  revokeInvitation: (invitationId: string) => api.delete<void>(`/invitations/${invitationId}`),

  acceptInvitation: (token: string) =>
    api.post<{ status: string; workspaceId: string }>('/invitations/accept', { token }),
};
