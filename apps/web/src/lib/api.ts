import {
  API_PREFIX,
  type ApiErrorPayload,
  type ApiFieldError,
  type AuditEntrySummary,
  type BulkActionInput,
  type Capability,
  type ContactDetail,
  type ContactPage,
  type ContactSummary,
  type InvitableRole,
  type InvitationSummary,
  type MemberSummary,
  type RecoverableWorkspaceSummary,
  type WidgetConfig,
  type WidgetDetail,
  type WidgetSummary,
  type WidgetType,
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
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
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

// ---------------------------------------------------------------------------
// Widget endpoints (Stage 5a API)
// ---------------------------------------------------------------------------

/**
 * Typed calls for the widget surface.
 *
 * As with `workspaceApi`, none of these decides anything. Whether a draft is
 * valid, whether it may be published, and whether this caller is allowed to are
 * all answered by the server; this layer only names endpoints and shapes.
 */
export const widgetApi = {
  list: () => api.get<{ widgets: WidgetSummary[] }>('/widgets'),

  trash: () => api.get<{ widgets: WidgetSummary[] }>('/widgets/trash'),

  detail: (widgetId: string) => api.get<WidgetDetail>(`/widgets/${widgetId}`),

  create: (type: WidgetType, name: string) => api.post<WidgetDetail>('/widgets', { type, name }),

  /**
   * Save the draft.
   *
   * `expectedVersion` is the optimistic-concurrency precondition from Stage 5a.
   * A widget with no draft yet takes 0, which is what the API reports by
   * returning `draft: null`.
   */
  saveDraft: (widgetId: string, config: WidgetConfig, expectedVersion: number, name?: string) =>
    api.put<{ status: string; version: number }>(`/widgets/${widgetId}/draft`, {
      config,
      expectedVersion,
      ...(name === undefined ? {} : { name }),
    }),

  publish: (widgetId: string, expectedVersion: number) =>
    api.post<{ status: string; revisionNumber: number }>(`/widgets/${widgetId}/publish`, {
      expectedVersion,
    }),

  unpublish: (widgetId: string) => api.post<{ status: string }>(`/widgets/${widgetId}/unpublish`),

  remove: (widgetId: string) => api.delete<{ status: string }>(`/widgets/${widgetId}`),

  recover: (widgetId: string) => api.post<{ status: string }>(`/widgets/${widgetId}/recover`),
};

// ---------------------------------------------------------------------------
// Contact endpoints (Stage 8a API)
// ---------------------------------------------------------------------------

/**
 * Build the inbox query string.
 *
 * Exported because the export endpoint has to receive EXACTLY the same filter
 * the list is showing (blueprint 4.7). Building it in one place is what makes
 * that true rather than intended - a second builder for the download link would
 * be a second chance to drop a parameter.
 *
 * A repeated key is how a multi-value filter travels; `status` is the only one
 * that can repeat today.
 */
export function contactQueryString(
  filter: Readonly<Record<string, string | readonly string[] | undefined>>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) if (entry !== '') params.append(key, entry);
    } else if (typeof value === 'string' && value !== '') {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/**
 * Typed calls for the contact inbox.
 *
 * As everywhere else in this client, none of these decides anything. Which
 * actions a role may take, whether an edit is stale, and what an export
 * contains are all answered by the server; this layer names endpoints and
 * shapes.
 */
export const contactApi = {
  list: (query: string) => api.get<ContactPage>(`/contacts${query}`),

  trash: (query: string) => api.get<ContactPage>(`/contacts/trash${query}`),

  detail: (contactId: string) => api.get<ContactDetail>(`/contacts/${contactId}`),

  updateWorkflow: (
    contactId: string,
    change: {
      status?: string;
      assigneeUserId?: string | null;
      tags?: readonly string[];
    },
  ) => api.patch<{ contact: ContactSummary }>(`/contacts/${contactId}/workflow`, change),

  addNote: (contactId: string, note: string) =>
    api.post<{ contact: ContactSummary }>(`/contacts/${contactId}/notes`, { note }),

  /**
   * A canonical edit.
   *
   * `expectedVersion` is the Stage 8a optimistic-concurrency precondition. It
   * is a required argument here rather than an optional field, so a caller
   * cannot forget it - a forgotten precondition is a silent overwrite, which is
   * the failure the endpoint exists to prevent.
   */
  updateCanonical: (
    contactId: string,
    expectedVersion: number,
    change: {
      email?: string;
      name?: string | null;
      phone?: string | null;
      company?: string | null;
    },
  ) =>
    api.patch<{ contact: ContactSummary }>(`/contacts/${contactId}`, {
      expectedVersion,
      ...change,
    }),

  merge: (survivorId: string, duplicateId: string) =>
    api.post<{ contact: ContactSummary; movedSubmissions: number; movedActivities: number }>(
      '/contacts/merge',
      { survivorId, duplicateId },
    ),

  bulk: (input: BulkActionInput) =>
    api.post<{ changed: number; contactIds: string[] }>('/contacts/bulk', input),

  softDelete: (contactId: string) =>
    api.delete<{ contact: ContactSummary }>(`/contacts/${contactId}`),

  recover: (contactId: string) =>
    api.post<{ contact: ContactSummary }>(`/contacts/${contactId}/recover`),

  /**
   * Where the browser should navigate to download an export.
   *
   * A real URL rather than a fetch, because the response is a streamed
   * attachment: letting the browser handle it keeps the stream out of memory
   * and gets the Content-Disposition filename for free.
   */
  exportUrl: (query: string) => `${BASE}/contacts/export${query}`,
};
