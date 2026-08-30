import * as z from 'zod';
import {
  API_PREFIX,
  ERROR_CODES,
  acceptInvitationSchema,
  addNoteSchema,
  addRecipientSchema,
  bulkActionSchema,
  changeRoleSchema,
  completePrivacyRequestSchema,
  confirmOptInSchema,
  confirmPasswordResetSchema,
  createWebhookSchema,
  createWidgetSchema,
  interactionBatchSchema,
  inviteMemberSchema,
  loginRequestSchema,
  mergeContactsSchema,
  mfaChallengeSchema,
  mfaConfirmSchema,
  mfaDisableSchema,
  onboardWorkspaceSchema,
  privacySettingsSchema,
  publishWidgetSchema,
  registerRequestSchema,
  requestPasswordResetSchema,
  resendVerificationRequestSchema,
  startPrivacyRequestSchema,
  submissionPayloadSchema,
  switchWorkspaceSchema,
  transferOwnershipSchema,
  unsubscribeSchema,
  updateCanonicalSchema,
  updateDraftSchema,
  updateNotificationSettingsSchema,
  updateWebhookSchema,
  updateWorkflowSchema,
  verifyEmailRequestSchema,
} from '@lcp/contracts';

/**
 * The OpenAPI document (blueprint 10.1, 10.2).
 *
 * "OpenAPI is the contract source and is rendered through Swagger UI." Two
 * decisions follow from taking that literally rather than writing a document
 * that merely resembles the API.
 *
 * **Request bodies are generated, not transcribed.** Every `body()` below runs
 * `z.toJSONSchema` over the SAME Zod object the route validates with. There is
 * no second description of a request shape that could disagree with the first:
 * change the validator and the published contract changes with it, including
 * the bounds and patterns. Zod 4 does this natively, so it costs no dependency.
 *
 * **The path list is checked against the running server.** A hand-written spec
 * drifts the first time somebody adds a route and forgets, and a spec that lies
 * is worse than no spec because a reader trusts it. `openapi.contract.test.ts`
 * walks Express's own router stack and asserts the two sets match in both
 * directions, so an undocumented route fails the build.
 *
 * Responses are described rather than generated. Response DTOs in this codebase
 * are TypeScript interfaces, not Zod objects - they are constructed by the
 * server, never parsed - so there is nothing to derive from. Rather than invent
 * Zod mirrors that could themselves drift, responses are documented by shape
 * and status, and the detail a caller needs is in the description.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

/**
 * A request body, derived from the validator the route actually uses.
 *
 * `io: 'input'` matters: several schemas transform on parse (trimming and
 * lowercasing an address, defaulting a range), and a caller needs the shape
 * they SEND, not the shape the server ends up with.
 */
function body(schema: z.ZodType, description?: string): Json {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as Json;
  delete jsonSchema['$schema'];
  return {
    required: true,
    ...(description === undefined ? {} : { description }),
    content: { 'application/json': { schema: jsonSchema } },
  };
}

function json(description: string, schema?: Json): Json {
  return {
    description,
    ...(schema === undefined ? {} : { content: { 'application/json': { schema } } }),
  };
}

function ref(name: string): Json {
  return { $ref: `#/components/schemas/${name}` };
}

function path(name: string, description: string): Json {
  return {
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
    description,
  };
}

function query(name: string, description: string, schema: Json = { type: 'string' }): Json {
  return { name, in: 'query', required: false, schema, description };
}

/** The error envelope every failure uses (blueprint 10.1). */
const ERROR_RESPONSE = json('The request failed. See the error code.', ref('ErrorEnvelope'));

/**
 * The three failures almost every authenticated route can produce.
 *
 * Repeated on each operation rather than hidden in a default, because a reader
 * scanning one endpoint should see what it can return without cross-referencing.
 */
const AUTHED_ERRORS: Json = {
  '400': ERROR_RESPONSE,
  '401': json('No session, or the session has been revoked.', ref('ErrorEnvelope')),
  '403': json('The caller’s role does not permit this (blueprint 11).', ref('ErrorEnvelope')),
  '404': ERROR_RESPONSE,
};

const PUBLIC_ERRORS: Json = {
  '400': ERROR_RESPONSE,
  '403': json('Origin is not on the widget’s allowlist.', ref('ErrorEnvelope')),
  '404': ERROR_RESPONSE,
  '429': json('Rate limited (blueprint 7.4).', ref('ErrorEnvelope')),
};

function op(input: {
  readonly tags: readonly string[];
  readonly summary: string;
  readonly description: string;
  readonly security?: readonly Json[];
  readonly parameters?: readonly Json[];
  readonly requestBody?: Json;
  readonly responses: Json;
}): Json {
  const { security, parameters, requestBody, ...rest } = input;
  return {
    ...rest,
    ...(security === undefined ? {} : { security }),
    ...(parameters === undefined ? {} : { parameters }),
    ...(requestBody === undefined ? {} : { requestBody }),
  };
}

/** Session cookie plus CSRF header, which is what every dashboard write needs. */
const SESSION: readonly Json[] = [{ sessionCookie: [], csrfToken: [] }];
/** Reads need the cookie but not the CSRF header. */
const SESSION_READ: readonly Json[] = [{ sessionCookie: [] }];

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const components: Json = {
  securitySchemes: {
    sessionCookie: {
      type: 'apiKey',
      in: 'cookie',
      name: 'lcp.sid',
      description:
        'Server session, set by sign-in. HttpOnly, Secure in production, SameSite=Lax (blueprint 10.3). There are no customer API keys in version 1.',
    },
    csrfToken: {
      type: 'apiKey',
      in: 'header',
      name: 'X-CSRF-Token',
      description:
        'Required on every authenticated state-changing request. Fetch one from GET /api/v1/auth/csrf; it is bound to the session and is reissued when the session rotates.',
    },
  },
  schemas: {
    ErrorEnvelope: {
      type: 'object',
      description:
        'Every failure uses this shape (blueprint 10.1): a machine-readable code, a message safe to show a person, optional per-field detail, and the correlation id that ties the response to the server logs.',
      required: ['error'],
      properties: {
        error: {
          type: 'object',
          required: ['code', 'message', 'correlationId'],
          properties: {
            code: {
              type: 'string',
              enum: Object.values(ERROR_CODES),
              description: 'Stable machine-readable code. Match on this, never on the message.',
            },
            message: { type: 'string' },
            correlationId: { type: 'string' },
            details: {
              type: 'array',
              items: {
                type: 'object',
                required: ['path', 'message'],
                properties: { path: { type: 'string' }, message: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    CursorPage: {
      type: 'object',
      description:
        'Keyset pagination (blueprint 10.1). Pass the returned cursor back as `cursor` to continue; there are no page numbers, because a lead arriving mid-listing would shift every offset.',
      properties: {
        nextCursor: { type: ['string', 'null'] },
        hasMore: { type: 'boolean' },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const A = API_PREFIX;

const paths: Json = {
  // ------------------------------------------------------------ operations
  '/health/live': {
    get: op({
      tags: ['Operations'],
      summary: 'Liveness probe',
      description:
        'Answers whether the process is up. Deliberately does not touch MongoDB or Redis, so a dependency outage never causes the platform to be restarted.',
      responses: { '200': json('The process is running.') },
    }),
  },
  '/health/ready': {
    get: op({
      tags: ['Operations'],
      summary: 'Readiness probe',
      description:
        'Checks the dependencies the API needs to serve traffic. A degraded optional provider does not make the API unready (blueprint 16.3).',
      responses: {
        '200': json('Ready to serve traffic.'),
        '503': json('A required dependency is unavailable.'),
      },
    }),
  },
  [A]: {
    get: op({
      tags: ['Operations'],
      summary: 'API index',
      description: 'Names the API version and points at this document.',
      responses: { '200': json('Version information.') },
    }),
  },

  // --------------------------------------------------------- authentication
  [`${A}/auth/register`]: {
    post: op({
      tags: ['Authentication'],
      summary: 'Create an account',
      description:
        'Always answers the same way whether or not the address is already registered, so the endpoint cannot be used to enumerate accounts (blueprint 10.3). A verification email is sent when the address is new.',
      requestBody: body(registerRequestSchema),
      responses: {
        '202': json('Accepted. Check the address for a verification link.'),
        '400': ERROR_RESPONSE,
        '429': json('Throttled.', ref('ErrorEnvelope')),
      },
    }),
  },
  [`${A}/auth/verify`]: {
    post: op({
      tags: ['Authentication'],
      summary: 'Confirm an email address',
      description: 'Consumes the single-use token from the verification email.',
      requestBody: body(verifyEmailRequestSchema),
      responses: { '200': json('Address confirmed.'), '400': ERROR_RESPONSE },
    }),
  },
  [`${A}/auth/verify/resend`]: {
    post: op({
      tags: ['Authentication'],
      summary: 'Resend the verification email',
      description: 'Answers identically whether or not the address exists.',
      requestBody: body(resendVerificationRequestSchema),
      responses: { '202': json('Accepted.'), '429': json('Throttled.', ref('ErrorEnvelope')) },
    }),
  },
  [`${A}/auth/login`]: {
    post: op({
      tags: ['Authentication'],
      summary: 'Sign in',
      description:
        'On success sets the session cookie and rotates the session identifier. When the account has MFA enabled the response asks for a second factor instead, and the credentials are not accepted until it is supplied.',
      requestBody: body(loginRequestSchema),
      responses: {
        '200': json('Signed in, or an MFA challenge was issued.'),
        '401': json(
          'Invalid credentials. Deliberately identical for an unknown address and a wrong password.',
          ref('ErrorEnvelope'),
        ),
        '429': json('Throttled.', ref('ErrorEnvelope')),
      },
    }),
  },
  [`${A}/auth/mfa-challenge`]: {
    post: op({
      tags: ['Authentication'],
      summary: 'Answer an MFA challenge',
      description: 'Accepts a TOTP code or a single-use recovery code.',
      requestBody: body(mfaChallengeSchema),
      responses: {
        '200': json('Signed in.'),
        '401': ERROR_RESPONSE,
        '429': json('Throttled.', ref('ErrorEnvelope')),
      },
    }),
  },
  [`${A}/auth/logout`]: {
    post: op({
      tags: ['Authentication'],
      summary: 'Sign out',
      description:
        'Deletes the session server-side, so revocation is immediate rather than waiting for a cookie to expire.',
      security: SESSION,
      responses: { '200': json('Signed out.') },
    }),
  },
  [`${A}/auth/password/reset-request`]: {
    post: op({
      tags: ['Authentication'],
      summary: 'Request a password reset',
      description: 'Answers identically whether or not the address exists.',
      requestBody: body(requestPasswordResetSchema),
      responses: { '202': json('Accepted.'), '429': json('Throttled.', ref('ErrorEnvelope')) },
    }),
  },
  [`${A}/auth/password/reset-confirm`]: {
    post: op({
      tags: ['Authentication'],
      summary: 'Set a new password',
      description: 'Consumes the single-use reset token and signs out every other session.',
      requestBody: body(confirmPasswordResetSchema),
      responses: { '200': json('Password changed.'), '400': ERROR_RESPONSE },
    }),
  },
  [`${A}/auth/me`]: {
    get: op({
      tags: ['Authentication'],
      summary: 'The signed-in account',
      description: 'Identity and verification state for the current session.',
      security: SESSION_READ,
      responses: { '200': json('The current account.'), '401': ERROR_RESPONSE },
    }),
  },
  [`${A}/auth/csrf`]: {
    get: op({
      tags: ['Authentication'],
      summary: 'Mint a CSRF token',
      description:
        'Returns a token bound to the current session, for the `X-CSRF-Token` header on state-changing requests. Fetch a fresh one after any event that rotates the session.',
      responses: { '200': json('A CSRF token.') },
    }),
  },
  [`${A}/auth/account`]: {
    delete: op({
      tags: ['Authentication'],
      summary: 'Delete your own account',
      description:
        'Soft deletion with a 30-day recovery window (blueprint 9.5). Refused while the account still owns an active workspace: transfer ownership or delete the workspace first, so a tenant is never left with no Owner.',
      security: SESSION,
      responses: {
        '200': json('Deleted, and recoverable until the returned date.'),
        '401': ERROR_RESPONSE,
        '409': json('This account still owns an active workspace.', ref('ErrorEnvelope')),
      },
    }),
  },
  [`${A}/auth/account/recover`]: {
    post: op({
      tags: ['Authentication'],
      summary: 'Restore a deleted account',
      description:
        'Takes credentials rather than a session, because a deleted account has none. The password is verified exactly as sign-in verifies it, and every failure answers alike so the endpoint cannot reveal which addresses have deleted accounts.',
      requestBody: body(loginRequestSchema),
      responses: {
        '200': json('Restored.'),
        '404': json('Nothing to restore for those details.', ref('ErrorEnvelope')),
        '409': json('The 30-day recovery window has closed.', ref('ErrorEnvelope')),
      },
    }),
  },

  // ------------------------------------------------------------------- MFA
  [`${A}/mfa`]: {
    get: op({
      tags: ['Authentication'],
      summary: 'MFA status',
      description: 'Whether MFA is enabled, and how many recovery codes remain.',
      security: SESSION_READ,
      responses: { '200': json('Current MFA state.'), '401': ERROR_RESPONSE },
    }),
  },
  [`${A}/mfa/enroll`]: {
    post: op({
      tags: ['Authentication'],
      summary: 'Begin MFA enrollment',
      description:
        'Generates a TOTP secret and recovery codes. MFA is NOT enabled by this call - an unconfirmed enrollment would lock somebody out of their own account.',
      security: SESSION,
      responses: { '200': json('Secret, otpauth URI, and recovery codes.'), '401': ERROR_RESPONSE },
    }),
  },
  [`${A}/mfa/confirm`]: {
    post: op({
      tags: ['Authentication'],
      summary: 'Confirm and enable MFA',
      description: 'Enables MFA once a code proves the authenticator is working.',
      security: SESSION,
      requestBody: body(mfaConfirmSchema),
      responses: { '200': json('MFA enabled.'), '400': ERROR_RESPONSE, '401': ERROR_RESPONSE },
    }),
  },
  [`${A}/mfa/disable`]: {
    post: op({
      tags: ['Authentication'],
      summary: 'Disable MFA',
      description:
        'Requires a current code or a recovery code, so a stolen session cannot remove the second factor.',
      security: SESSION,
      requestBody: body(mfaDisableSchema),
      responses: { '200': json('MFA disabled.'), '400': ERROR_RESPONSE, '401': ERROR_RESPONSE },
    }),
  },

  // -------------------------------------------------------------- sessions
  [`${A}/sessions`]: {
    get: op({
      tags: ['Authentication'],
      summary: 'List your sessions and devices',
      description: 'Every active session for the account, with the current one marked.',
      security: SESSION_READ,
      responses: { '200': json('Active sessions.'), '401': ERROR_RESPONSE },
    }),
  },
  [`${A}/sessions/{sessionId}`]: {
    delete: op({
      tags: ['Authentication'],
      summary: 'Revoke one session',
      description: 'Immediate: the session is deleted from Redis rather than marked.',
      security: SESSION,
      parameters: [path('sessionId', 'From the session list.')],
      responses: { '200': json('Revoked.'), '401': ERROR_RESPONSE, '404': ERROR_RESPONSE },
    }),
  },
  [`${A}/sessions/revoke-all`]: {
    post: op({
      tags: ['Authentication'],
      summary: 'Revoke every other session',
      description: 'Ends every session except the one making the request.',
      security: SESSION,
      responses: { '200': json('Revoked.'), '401': ERROR_RESPONSE },
    }),
  },

  // ------------------------------------------------------------ workspaces
  [`${A}/workspaces`]: {
    get: op({
      tags: ['Workspaces'],
      summary: 'List your workspaces',
      description: 'Every workspace the account is a member of, and which one is active.',
      security: SESSION_READ,
      responses: { '200': json('Workspaces and the active id.'), '401': ERROR_RESPONSE },
    }),
    post: op({
      tags: ['Workspaces'],
      summary: 'Create a workspace',
      description:
        'Onboarding. The timezone is not cosmetic: monthly quota boundaries and analytics days are computed in it (blueprint 4.10).',
      security: SESSION,
      requestBody: body(onboardWorkspaceSchema),
      responses: {
        '201': json('Created, and now active.'),
        '400': ERROR_RESPONSE,
        '401': ERROR_RESPONSE,
        '409': json('This account already owns a workspace.', ref('ErrorEnvelope')),
      },
    }),
  },
  [`${A}/workspaces/switch`]: {
    post: op({
      tags: ['Workspaces'],
      summary: 'Switch the active workspace',
      description:
        'Changes which workspace subsequent requests are scoped to. The scope is read from the session, never from a request body.',
      security: SESSION,
      requestBody: body(switchWorkspaceSchema),
      responses: { '200': json('Switched.'), '401': ERROR_RESPONSE, '404': ERROR_RESPONSE },
    }),
  },
  [`${A}/workspaces/current`]: {
    get: op({
      tags: ['Workspaces'],
      summary: 'The active workspace, and what you may do in it',
      description:
        'Returns the workspace plus the capability list the SERVER derived from the section 11 matrix. Clients should gate their controls on this rather than keeping a second copy of the role table, which could drift.',
      security: SESSION_READ,
      responses: {
        '200': json('Workspace and capabilities.'),
        '401': ERROR_RESPONSE,
        '404': ERROR_RESPONSE,
      },
    }),
    delete: op({
      tags: ['Workspaces'],
      summary: 'Delete the active workspace',
      description:
        'Owner only. Everyone loses access immediately, and the tenant is recoverable for 30 days; after that every collection belonging to it is purged, including its analytics aggregates.',
      security: SESSION,
      responses: {
        '200': json('Moved to trash, and recoverable until the returned date.'),
        ...AUTHED_ERRORS,
      },
    }),
  },
  [`${A}/workspaces/privacy`]: {
    get: op({
      tags: ['Workspaces'],
      summary: 'Consent and retention settings',
      description:
        'Readable by any member; what a company does with lead data is not a secret from the people handling it.',
      security: SESSION_READ,
      responses: { '200': json('Retention days and opt-in mode.'), ...AUTHED_ERRORS },
    }),
    put: op({
      tags: ['Workspaces'],
      summary: 'Change consent and retention settings',
      description:
        'Owner only. Shortening retention schedules the permanent anonymisation of every lead older than the new period on the next daily sweep, which is why it sits with the capability that governs destroying this tenant’s data.',
      security: SESSION,
      requestBody: body(privacySettingsSchema),
      responses: { '200': json('Saved.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/workspaces/usage`]: {
    get: op({
      tags: ['Workspaces'],
      summary: 'Usage against the plan limits',
      description:
        'The four meters of blueprint 4.10: users, active widgets, submissions this month, and interaction events this month. The two monthly ones are counted on the workspace’s own timezone boundary.',
      security: SESSION_READ,
      responses: { '200': json('Meters and limits.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/workspaces/audit`]: {
    get: op({
      tags: ['Workspaces'],
      summary: 'Workspace audit log',
      description:
        'Owner and Admin. Every role, publish, export, delete, restore, merge, and settings change with its actor and correlation id (blueprint 9.3).',
      security: SESSION_READ,
      responses: { '200': json('Recent audit entries.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/workspaces/transfer-ownership`]: {
    post: op({
      tags: ['Workspaces'],
      summary: 'Transfer ownership',
      description:
        'Owner only, and only to an Admin who has confirmed their email. The outgoing Owner becomes an Admin, so a workspace always has exactly one Owner.',
      security: SESSION,
      requestBody: body(transferOwnershipSchema),
      responses: { '200': json('Transferred.'), ...AUTHED_ERRORS, '409': ERROR_RESPONSE },
    }),
  },
  [`${A}/workspaces/recoverable`]: {
    get: op({
      tags: ['Workspaces'],
      summary: 'Workspaces you can still restore',
      description:
        'Soft-deleted workspaces owned by this account that are inside their 30-day window.',
      security: SESSION_READ,
      responses: { '200': json('Recoverable workspaces.'), '401': ERROR_RESPONSE },
    }),
  },
  [`${A}/workspaces/{workspaceId}/recover`]: {
    post: op({
      tags: ['Workspaces'],
      summary: 'Restore a deleted workspace',
      description:
        'Owner only, inside the 30-day window. After that the tenant is purged and cannot be restored.',
      security: SESSION,
      parameters: [path('workspaceId', 'From the recoverable list.')],
      responses: {
        '200': json('Restored.'),
        '401': ERROR_RESPONSE,
        '404': ERROR_RESPONSE,
        '409': json('The window has closed.', ref('ErrorEnvelope')),
      },
    }),
  },
  [`${A}/workspaces/account-deletion-eligibility`]: {
    get: op({
      tags: ['Workspaces'],
      summary: 'Whether this account can be deleted',
      description:
        'Reports whether an owned workspace is in the way, so the UI can explain the blocker before the attempt rather than after it.',
      security: SESSION_READ,
      responses: { '200': json('Eligibility and the reason if not.'), '401': ERROR_RESPONSE },
    }),
  },

  // --------------------------------------------------------------- members
  [`${A}/members`]: {
    get: op({
      tags: ['Workspaces'],
      summary: 'List workspace members',
      description: 'Every member and their role. Visible to all members.',
      security: SESSION_READ,
      responses: { '200': json('Members.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/members/{userId}/role`]: {
    patch: op({
      tags: ['Workspaces'],
      summary: 'Change a member’s role',
      description:
        'An Admin may manage Members; only the Owner may assign or remove Admin. Nobody changes their own role, and the Owner’s role moves only through transfer.',
      security: SESSION,
      parameters: [path('userId', 'The member being changed.')],
      requestBody: body(changeRoleSchema),
      responses: { '200': json('Role changed.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/members/{userId}`]: {
    delete: op({
      tags: ['Workspaces'],
      summary: 'Remove a member',
      description: 'The Owner can never be removed; ownership must be transferred first.',
      security: SESSION,
      parameters: [path('userId', 'The member being removed.')],
      responses: { '200': json('Removed.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/invitations`]: {
    get: op({
      tags: ['Workspaces'],
      summary: 'List pending invitations',
      description: 'Invitations that have not yet been accepted or revoked.',
      security: SESSION_READ,
      responses: { '200': json('Pending invitations.'), ...AUTHED_ERRORS },
    }),
    post: op({
      tags: ['Workspaces'],
      summary: 'Invite someone',
      description:
        'Owner and Admin, and only with a confirmed email address. The emailed token is single-use, expires in 7 days, and is stored only as a hash.',
      security: SESSION,
      requestBody: body(inviteMemberSchema),
      responses: { '202': json('Invitation sent.'), ...AUTHED_ERRORS, '409': ERROR_RESPONSE },
    }),
  },
  [`${A}/invitations/{invitationId}`]: {
    delete: op({
      tags: ['Workspaces'],
      summary: 'Cancel an invitation',
      description: 'Revokes it before it is used.',
      security: SESSION,
      parameters: [path('invitationId', 'From the pending list.')],
      responses: { '200': json('Cancelled.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/invitations/accept`]: {
    post: op({
      tags: ['Workspaces'],
      summary: 'Accept an invitation',
      description:
        'The signed-in account must match the invited address, so an intercepted link cannot admit somebody else.',
      security: SESSION,
      requestBody: body(acceptInvitationSchema),
      responses: {
        '200': json('Joined.'),
        '400': ERROR_RESPONSE,
        '401': ERROR_RESPONSE,
        '403': ERROR_RESPONSE,
      },
    }),
  },

  // --------------------------------------------------------------- widgets
  [`${A}/widgets`]: {
    get: op({
      tags: ['Widgets'],
      summary: 'List widgets',
      description: 'Active widgets in the workspace, with their publish state.',
      security: SESSION_READ,
      responses: { '200': json('Widgets.'), ...AUTHED_ERRORS },
    }),
    post: op({
      tags: ['Widgets'],
      summary: 'Create a widget',
      description:
        'Creates the widget and its first draft, pre-filled with the default fields for the chosen type. A widget is not servable until it is published.',
      security: SESSION,
      requestBody: body(createWidgetSchema),
      responses: {
        '201': json('Created, with its draft.'),
        ...AUTHED_ERRORS,
        '409': json('The active-widget limit is reached.', ref('ErrorEnvelope')),
      },
    }),
  },
  [`${A}/widgets/trash`]: {
    get: op({
      tags: ['Widgets'],
      summary: 'Deleted widgets',
      description:
        'Soft-deleted widgets inside their 30-day recovery window. The leads they collected are never deleted with them.',
      security: SESSION_READ,
      responses: { '200': json('Recoverable widgets.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/widgets/{widgetId}`]: {
    get: op({
      tags: ['Widgets'],
      summary: 'One widget, with its draft and published revision',
      description:
        'Everything the builder needs: the widget, its editable draft, and the revision currently being served.',
      security: SESSION_READ,
      parameters: [path('widgetId', 'The widget id.')],
      responses: { '200': json('Widget detail.'), ...AUTHED_ERRORS },
    }),
    delete: op({
      tags: ['Widgets'],
      summary: 'Delete a widget',
      description:
        'Soft deletion with a 30-day recovery window. The widget stops being served immediately.',
      security: SESSION,
      parameters: [path('widgetId', 'The widget id.')],
      responses: { '200': json('Moved to trash.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/widgets/{widgetId}/draft`]: {
    put: op({
      tags: ['Widgets'],
      summary: 'Save the draft configuration',
      description:
        'Optimistic concurrency: send the version you loaded. A stale write returns 409 with the current version rather than overwriting a teammate (blueprint 9.3).',
      security: SESSION,
      parameters: [path('widgetId', 'The widget id.')],
      requestBody: body(updateDraftSchema),
      responses: {
        '200': json('Draft saved, with its new version.'),
        ...AUTHED_ERRORS,
        '409': json('Somebody else saved first.', ref('ErrorEnvelope')),
      },
    }),
  },
  [`${A}/widgets/{widgetId}/publish`]: {
    post: op({
      tags: ['Widgets'],
      summary: 'Publish the draft',
      description:
        'Freezes the draft into an immutable revision and starts serving it. Requires a confirmed email address and at least one allowed domain.',
      security: SESSION,
      parameters: [path('widgetId', 'The widget id.')],
      requestBody: body(publishWidgetSchema),
      responses: { '200': json('Published.'), ...AUTHED_ERRORS, '409': ERROR_RESPONSE },
    }),
  },
  [`${A}/widgets/{widgetId}/unpublish`]: {
    post: op({
      tags: ['Widgets'],
      summary: 'Stop serving a widget',
      description:
        'Clears the published pointer. The revision survives, so the widget can be republished without rebuilding it.',
      security: SESSION,
      parameters: [path('widgetId', 'The widget id.')],
      responses: { '200': json('Unpublished.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/widgets/{widgetId}/recover`]: {
    post: op({
      tags: ['Widgets'],
      summary: 'Restore a deleted widget',
      description:
        'Inside the 30-day window. It comes back unpublished, so restoring never silently puts a form back on a customer’s site.',
      security: SESSION,
      parameters: [path('widgetId', 'The widget id.')],
      responses: {
        '200': json('Restored.'),
        ...AUTHED_ERRORS,
        '409': json('The window has closed.', ref('ErrorEnvelope')),
      },
    }),
  },

  // -------------------------------------------------------------- contacts
  [`${A}/contacts`]: {
    get: op({
      tags: ['Contacts'],
      summary: 'The lead inbox',
      description:
        'Cursor-paginated and filterable. Search matches the canonical record and what the visitor actually wrote.',
      security: SESSION_READ,
      parameters: [
        query('cursor', 'From the previous page.'),
        query('limit', 'Page size.', { type: 'integer' }),
        query('search', 'Free text across canonical fields and submitted values.'),
        query('status', 'One or more workflow statuses.'),
        query('assignee', 'Filter by assignee user id, or `unassigned`.'),
        query('tag', 'One or more tags.'),
        query('sort', 'Sort field and direction.'),
      ],
      responses: { '200': json('A page of contacts.', ref('CursorPage')), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/contacts/trash`]: {
    get: op({
      tags: ['Contacts'],
      summary: 'Deleted leads',
      description:
        'Inside their 30-day window. After it, their personal data and submitted values are permanently anonymised.',
      security: SESSION_READ,
      responses: { '200': json('Recoverable contacts.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/contacts/export`]: {
    get: op({
      tags: ['Exports'],
      summary: 'Export the filtered inbox',
      description:
        'Streams CSV or JSON for exactly the filter in force, so what downloads matches what the screen shows. Owner and Admin only, and every export is audited. CSV values that begin with a formula character are quoted and prefixed so a spreadsheet cannot execute them.',
      security: SESSION_READ,
      parameters: [
        query('format', 'csv or json.'),
        query('search', 'Same filters as the inbox listing.'),
        query('status', 'One or more workflow statuses.'),
      ],
      responses: {
        '200': {
          description: 'A stream of the matching leads.',
          content: { 'text/csv': {}, 'application/json': {} },
        },
        ...AUTHED_ERRORS,
      },
    }),
  },
  [`${A}/contacts/merge`]: {
    post: op({
      tags: ['Contacts'],
      summary: 'Merge duplicate leads',
      description:
        'Picks a survivor, re-links every event and activity to it, and retires the duplicate. The duplicate is retired rather than trashed, because restoring it would resurrect a record whose history now belongs to the survivor.',
      security: SESSION,
      requestBody: body(mergeContactsSchema),
      responses: { '200': json('Merged.'), ...AUTHED_ERRORS, '409': ERROR_RESPONSE },
    }),
  },
  [`${A}/contacts/bulk`]: {
    post: op({
      tags: ['Contacts'],
      summary: 'Act on several leads at once',
      description:
        'Status, assignment, tagging, and deletion across a selection. Each action is checked against the caller’s role individually.',
      security: SESSION,
      requestBody: body(bulkActionSchema),
      responses: { '200': json('Applied, with a per-record result.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/contacts/{contactId}`]: {
    get: op({
      tags: ['Contacts'],
      summary: 'One lead, with its timeline',
      description:
        'The canonical record, every submission, the activity history, and the consent evidence.',
      security: SESSION_READ,
      parameters: [path('contactId', 'The contact id.')],
      responses: { '200': json('Contact detail.'), ...AUTHED_ERRORS },
    }),
    patch: op({
      tags: ['Contacts'],
      summary: 'Correct the canonical record',
      description:
        'Owner and Admin. Uses optimistic concurrency, and records which fields a human edited so a later submission refreshes everything except those.',
      security: SESSION,
      parameters: [path('contactId', 'The contact id.')],
      requestBody: body(updateCanonicalSchema),
      responses: {
        '200': json('Saved.'),
        ...AUTHED_ERRORS,
        '409': json('Somebody else edited first.', ref('ErrorEnvelope')),
      },
    }),
    delete: op({
      tags: ['Contacts'],
      summary: 'Delete a lead',
      description:
        'Soft deletion with a 30-day window, after which the personal data and submitted values are permanently anonymised.',
      security: SESSION,
      parameters: [path('contactId', 'The contact id.')],
      responses: { '200': json('Moved to trash.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/contacts/{contactId}/workflow`]: {
    patch: op({
      tags: ['Contacts'],
      summary: 'Change status, assignee, or tags',
      description:
        'Available to every member, and each change is recorded on the lead’s timeline with its actor.',
      security: SESSION,
      parameters: [path('contactId', 'The contact id.')],
      requestBody: body(updateWorkflowSchema),
      responses: { '200': json('Updated.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/contacts/{contactId}/notes`]: {
    post: op({
      tags: ['Contacts'],
      summary: 'Add a note',
      description: 'Notes are internal commentary and are removed when a lead is anonymised.',
      security: SESSION,
      parameters: [path('contactId', 'The contact id.')],
      requestBody: body(addNoteSchema),
      responses: { '201': json('Note added.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/contacts/{contactId}/recover`]: {
    post: op({
      tags: ['Contacts'],
      summary: 'Restore a deleted lead',
      description: 'Inside the 30-day window.',
      security: SESSION,
      parameters: [path('contactId', 'The contact id.')],
      responses: {
        '200': json('Restored.'),
        ...AUTHED_ERRORS,
        '409': json('The window has closed.', ref('ErrorEnvelope')),
      },
    }),
  },

  // ------------------------------------------------------------- analytics
  [`${A}/analytics`]: {
    get: op({
      tags: ['Analytics'],
      summary: 'Every dashboard, in one read',
      description:
        'All eight views of blueprint 4.9 from a single aggregate read, because they are slices of one range of one workspace’s data and separate requests could disagree with each other mid-load. A rate whose denominator is zero is `null`, never `0` - "nobody arrived" and "nobody acted" are different claims.',
      security: SESSION_READ,
      parameters: [
        query('range', 'One of 7d, 30d, or 90d.', { type: 'string', enum: ['7d', '30d', '90d'] }),
        query('from', 'Explicit start day, YYYY-MM-DD.'),
        query('to', 'Explicit end day, YYYY-MM-DD.'),
        query('widgetId', 'Restrict to one widget.'),
      ],
      responses: { '200': json('The eight dashboards.'), ...AUTHED_ERRORS },
    }),
  },

  // ------------------------------------------------------------ diagnostics
  [`${A}/diagnostics`]: {
    get: op({
      tags: ['Operations'],
      summary: 'Platform operator diagnostics',
      description:
        'Queue depths and the oldest waiting job, dead-letter counts, the Brevo daily budget, the Redis command counter, Mongo migration state, the last retention sweep, and the sandbox reset schedule (blueprint 16.4). Restricted to an allowlist of platform operators, and closed to everybody when that allowlist is empty. A caller who is not on it gets 404 rather than 403, so the endpoint cannot be confirmed to exist. Nothing here names a tenant, a contact, or a captured value; every figure is an aggregate across the whole platform.',
      security: SESSION_READ,
      responses: {
        '200': json('A platform-wide snapshot.'),
        '401': ERROR_RESPONSE,
        '404': json('No such resource, or you are not an operator.', ref('ErrorEnvelope')),
      },
    }),
  },

  // ------------------------------------------------------------ deliveries
  [`${A}/deliveries`]: {
    get: op({
      tags: ['Deliveries'],
      summary: 'Delivery health',
      description:
        'Email and webhook attempts with their state. `failed` and `dead_letter` are deliberately different: a permanent rejection was final on its first attempt, a dead letter exhausted five transient retries and might succeed if replayed.',
      security: SESSION_READ,
      parameters: [
        query('status', 'Filter by delivery state.'),
        query('type', 'workspace_notification, visitor_confirmation, or webhook.'),
        query('cursor', 'From the previous page.'),
      ],
      responses: { '200': json('A page of deliveries.', ref('CursorPage')), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/deliveries/{deliveryId}/replay`]: {
    post: op({
      tags: ['Deliveries'],
      summary: 'Replay a dead-lettered delivery',
      description:
        'Owner and Admin. Only a dead letter can be replayed; a permanent failure would fail again for the same reason.',
      security: SESSION,
      parameters: [path('deliveryId', 'From the delivery list.')],
      responses: {
        '202': json('Queued for another attempt.'),
        ...AUTHED_ERRORS,
        '409': ERROR_RESPONSE,
      },
    }),
  },
  [`${A}/deliveries/webhooks`]: {
    get: op({
      tags: ['Deliveries'],
      summary: 'List webhook endpoints',
      description:
        'Endpoints and their secret metadata. The secret itself is returned only once, when it is created or rotated.',
      security: SESSION_READ,
      responses: { '200': json('Endpoints.'), ...AUTHED_ERRORS },
    }),
    post: op({
      tags: ['Deliveries'],
      summary: 'Add a webhook endpoint',
      description:
        'The URL is checked before it is stored and again before every send: every resolved address must be public, redirects are refused, and the port must be 80, 443, 8080, or 8443.',
      security: SESSION,
      requestBody: body(createWebhookSchema),
      responses: {
        '201': json('Created. The signing secret is in this response and never shown again.'),
        ...AUTHED_ERRORS,
      },
    }),
  },
  [`${A}/deliveries/webhooks/{endpointId}`]: {
    patch: op({
      tags: ['Deliveries'],
      summary: 'Update a webhook endpoint',
      description: 'Change the URL or enable/disable it.',
      security: SESSION,
      parameters: [path('endpointId', 'The endpoint id.')],
      requestBody: body(updateWebhookSchema),
      responses: { '200': json('Updated.'), ...AUTHED_ERRORS },
    }),
    delete: op({
      tags: ['Deliveries'],
      summary: 'Remove a webhook endpoint',
      description:
        'Deliveries already recorded are kept, so the history of what was sent survives.',
      security: SESSION,
      parameters: [path('endpointId', 'The endpoint id.')],
      responses: { '200': json('Removed.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/deliveries/webhooks/{endpointId}/rotate`]: {
    post: op({
      tags: ['Deliveries'],
      summary: 'Rotate the signing secret',
      description:
        'Issues a new secret while the previous one keeps verifying for 24 hours, so a receiver can be updated without dropping deliveries in between.',
      security: SESSION,
      parameters: [path('endpointId', 'The endpoint id.')],
      responses: {
        '200': json('Rotated. The new secret is in this response and never shown again.'),
        ...AUTHED_ERRORS,
      },
    }),
  },
  [`${A}/deliveries/widgets/{widgetId}/notifications`]: {
    get: op({
      tags: ['Deliveries'],
      summary: 'Notification settings for a widget',
      description:
        'The team notification template, whether visitor confirmations are on, and the variables a template may use.',
      security: SESSION_READ,
      parameters: [path('widgetId', 'The widget id.')],
      responses: { '200': json('Settings.'), ...AUTHED_ERRORS },
    }),
    put: op({
      tags: ['Deliveries'],
      summary: 'Change notification settings',
      description:
        'Templates may use only the allowlisted variables, and HTML in a template is refused - the values interpolated into it come from the public internet.',
      security: SESSION,
      parameters: [path('widgetId', 'The widget id.')],
      requestBody: body(updateNotificationSettingsSchema),
      responses: { '200': json('Saved.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/deliveries/widgets/{widgetId}/recipients`]: {
    post: op({
      tags: ['Deliveries'],
      summary: 'Add a notification recipient',
      description:
        'An address outside the workspace must confirm itself before anything is sent to it, so a widget cannot be used to mail a stranger.',
      security: SESSION,
      parameters: [path('widgetId', 'The widget id.')],
      requestBody: body(addRecipientSchema),
      responses: { '201': json('Added, pending verification where required.'), ...AUTHED_ERRORS },
    }),
  },
  [`${A}/deliveries/recipients/{recipientId}`]: {
    delete: op({
      tags: ['Deliveries'],
      summary: 'Remove a notification recipient',
      description: 'Stops sending team notifications to that address.',
      security: SESSION,
      parameters: [path('recipientId', 'The recipient id.')],
      responses: { '200': json('Removed.'), ...AUTHED_ERRORS },
    }),
  },

  // ---------------------------------------------------------------- events
  [`${A}/events`]: {
    get: op({
      tags: ['Operations'],
      summary: 'Live workspace event stream',
      description:
        'Server-Sent Events, scoped to the active workspace. Membership is re-checked when the stream opens and on every heartbeat, so removing somebody ends their stream rather than waiting for it to close. Reconnect with `Last-Event-ID` to resume.',
      security: SESSION_READ,
      responses: {
        '200': { description: 'An event stream.', content: { 'text/event-stream': {} } },
        '401': ERROR_RESPONSE,
        '404': ERROR_RESPONSE,
      },
    }),
  },

  // --------------------------------------------------------- public widget
  '/widget/v1/loader.js': {
    get: op({
      tags: ['Public widget'],
      summary: 'The embed loader',
      description:
        'The one script a customer puts on their page. Tiny and cacheable; it loads the runtime and nothing else. No account or key is involved - the widget is identified by its opaque public id.',
      responses: {
        '200': { description: 'JavaScript.', content: { 'application/javascript': {} } },
      },
    }),
  },
  '/widget/v1/runtime.{hash}.js': {
    get: op({
      tags: ['Public widget'],
      summary: 'The widget runtime',
      description:
        'Content-hashed and immutably cacheable. The loader picks the URL, so a page never has to be edited to get a new version.',
      parameters: [path('hash', 'Content hash, chosen by the loader.')],
      responses: {
        '200': { description: 'JavaScript.', content: { 'application/javascript': {} } },
        '404': ERROR_RESPONSE,
      },
    }),
  },
  '/widget/v1/config/{publicId}': {
    get: op({
      tags: ['Public widget'],
      summary: 'The published configuration',
      description:
        'What the runtime renders. Only ever the currently published revision, and only what a visitor is allowed to see - notification recipients, webhook settings, and internal ids are not in it.',
      parameters: [path('publicId', 'The opaque public widget id from the embed snippet.')],
      responses: {
        '200': json('Published configuration.'),
        '404': json('Unknown, unpublished, or deleted - answered alike.', ref('ErrorEnvelope')),
      },
    }),
  },
  '/widget/v1/submit/{publicId}': {
    post: op({
      tags: ['Public widget'],
      summary: 'Submit a lead',
      description:
        'The hardened path of blueprint 7.3. Origin must be on the widget’s allowlist, the body is capped at 32 KB, values are validated against the published revision’s own field schema, and `idempotencyKey` makes a retried submission safe. Accepted work happens before optional side effects, so a provider outage never fails a submission. A widget belonging to the public sandbox additionally meets stricter rate limits and an 8 KB body cap, checked on top of these rather than instead of them, and no email or webhook is ever sent for it.',
      parameters: [path('publicId', 'The opaque public widget id.')],
      requestBody: body(submissionPayloadSchema),
      responses: {
        '202': json('Accepted. The lead is durable; email and webhooks follow asynchronously.'),
        ...PUBLIC_ERRORS,
        '413': json('Body too large.', ref('ErrorEnvelope')),
      },
    }),
  },
  '/widget/v1/events/{publicId}': {
    post: op({
      tags: ['Public widget'],
      summary: 'Record funnel events',
      description:
        'The five anonymous events of blueprint 4.9, sent in batches. No IP, cookie, or user agent is stored - only a rotating pseudonym that is scoped to one widget, so the same visitor is not trackable across customers’ sites.',
      parameters: [path('publicId', 'The opaque public widget id.')],
      requestBody: body(interactionBatchSchema),
      responses: { '202': json('Accepted.'), ...PUBLIC_ERRORS },
    }),
  },

  // ------------------------------------------------------------- sandbox
  '/demo/v1/config': {
    get: op({
      tags: ['Demo'],
      summary: 'The sandbox’s seeded widgets',
      description:
        'What the public demo page needs to install its three examples: their opaque public ids, and when the sandbox was last wiped. Unauthenticated, and CORS-open, because the demo is hosted on a different origin on purpose and nothing here is private. Returns 503 while the sandbox is still being seeded.',
      responses: {
        '200': json('The seeded widgets and the reset schedule.'),
        '503': json('The sandbox is still being prepared.', ref('ErrorEnvelope')),
      },
    }),
  },
  '/demo/v1/feed': {
    get: op({
      tags: ['Demo'],
      summary: 'Recent sandbox activity',
      description:
        'A deliberately thin public feed: which example widget, what kind of thing happened, when, and how many fields a submission carried. Never an id, never an address, and never a value somebody typed - it is a public page with no moderation, and echoing submitted text would republish whatever the last visitor chose to write.',
      responses: {
        '200': json('Recent entries and totals.'),
        '429': json('Rate limited.', ref('ErrorEnvelope')),
        '503': json('The sandbox is still being prepared.', ref('ErrorEnvelope')),
      },
    }),
  },

  // --------------------------------------------------------------- privacy
  '/public/v1/consent/unsubscribe': {
    post: op({
      tags: ['Privacy'],
      summary: 'Unsubscribe from marketing email',
      description:
        'Reached from a link in an email, with no account. The signed token is the whole authorization. Suppression is workspace-wide and survives the contact being deleted, so it keeps being honoured afterwards. Every failure answers alike, so the endpoint cannot be used to test whether an address is a lead.',
      requestBody: body(unsubscribeSchema),
      responses: {
        '200': json('The outcome: unsubscribed, already, or invalid.'),
        '400': ERROR_RESPONSE,
      },
    }),
  },
  '/public/v1/consent/confirm': {
    post: op({
      tags: ['Privacy'],
      summary: 'Confirm a double opt-in',
      description:
        'Only a pending subscription can be confirmed, so a link followed twice - or after an unsubscribe - cannot resurrect consent.',
      requestBody: body(confirmOptInSchema),
      responses: {
        '200': json('The outcome: confirmed, already, or invalid.'),
        '400': ERROR_RESPONSE,
      },
    }),
  },
  '/public/v1/privacy/requests': {
    post: op({
      tags: ['Privacy'],
      summary: 'Ask to see or delete your data',
      description:
        'Scoped to one workspace, identified by the public widget id from the page the person filled in. The response is identical whether or not the address is a lead, so it cannot be used to enumerate a workspace’s contacts.',
      requestBody: body(startPrivacyRequestSchema),
      responses: { '202': json('Accepted, in the same words either way.'), '400': ERROR_RESPONSE },
    }),
  },
  '/public/v1/privacy/requests/complete': {
    post: op({
      tags: ['Privacy'],
      summary: 'Complete a verified request',
      description:
        'The token proves control of the address: single-use, stored only as a hash, and it expires in 24 hours. An export returns one workspace’s view; a deletion is immediate and irreversible, leaving only the suppression fingerprint.',
      requestBody: body(completePrivacyRequestSchema),
      responses: {
        '200': json('The export, or confirmation of the deletion.'),
        '400': ERROR_RESPONSE,
        '404': json('Expired, already used, or unknown - answered alike.', ref('ErrorEnvelope')),
      },
    }),
  },
};

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export const OPENAPI_PATH = `${API_PREFIX}/openapi.json`;

/**
 * Where Swagger UI lives.
 *
 * Deliberately NOT `/docs`. The React application owns `/docs/*` for the
 * written guides, and in production blueprint 5.1 puts the API and that
 * application on one Render service - so a shared prefix would mean the server's
 * static mount shadowing every guide page, or the reverse, depending on
 * ordering. Two names, no ambiguity.
 */
export const DOCS_PATH = '/api-reference';

/**
 * Build the document.
 *
 * `serverUrl` is passed in rather than hard-coded so the same code serves a
 * usable "Try it out" against localhost in development and against the deployed
 * origin in production.
 */
export function buildOpenApiDocument(serverUrl: string): Json {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Lead Capture Platform API',
      version: '1.0.0',
      summary: 'Embeddable lead-capture widgets, a collaborative inbox, and funnel analytics.',
      description: [
        'The API behind the Lead Capture Platform. It has three surfaces, and each is secured differently — which is the first thing to know before calling any of it.',
        '',
        '**The dashboard API** (`/api/v1`) is used by a signed-in person. It authenticates with a server session cookie and requires a CSRF token on every state-changing request. There are no customer API keys in version 1, so these endpoints are not usable from a script without a browser session.',
        '',
        '**The public widget API** (`/widget/v1`) is called from a visitor’s browser on a customer’s own website. It has no credentials at all. A widget is identified by an opaque public id, and what protects it is the widget’s allowed-domain list, rate limits, a body cap, and a server-owned field schema.',
        '',
        '**The privacy API** (`/public/v1`) is reached from links in emails by people with no account. A signed or single-use token in the request body is the entire authorization.',
        '',
        'Every failure uses one envelope with a stable `code`, a message safe to display, optional field details, and the correlation id that ties the response to the server logs. Match on the code, never on the message.',
        '',
        'This document is generated in the same process that serves the API. Request bodies are derived from the exact validators the routes use, and a test asserts that the path list here matches the routes the server actually dispatches - so it cannot describe an endpoint that does not exist, or miss one that does.',
        '',
        '_This is a portfolio project. The hosted instance carries no SLA and is for synthetic test data only._',
      ].join('\n'),
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: serverUrl, description: 'This server' }],
    tags: [
      { name: 'Authentication', description: 'Accounts, sessions, MFA, and account deletion.' },
      { name: 'Workspaces', description: 'Tenants, members, invitations, settings, and usage.' },
      { name: 'Widgets', description: 'Building, publishing, and retiring widgets.' },
      { name: 'Public widget', description: 'What a visitor’s browser calls. No credentials.' },
      { name: 'Contacts', description: 'The lead inbox and everything done to a lead.' },
      { name: 'Exports', description: 'Streaming the filtered inbox out.' },
      { name: 'Analytics', description: 'The funnel and the seven dashboards beside it.' },
      { name: 'Deliveries', description: 'Email and webhook health, replay, and settings.' },
      { name: 'Privacy', description: 'Unsubscribe, opt-in, and verified export or deletion.' },
      {
        name: 'Demo',
        description:
          'The public sandbox. No account, no credentials, and nothing it holds is real.',
      },
      { name: 'Operations', description: 'Probes and the live event stream.' },
    ],
    components,
    paths: Object.fromEntries(
      Object.entries(paths).map(([route, operations]) => [
        route,
        Object.fromEntries(
          Object.entries(operations as Json).filter(([, value]) => value !== undefined),
        ),
      ]),
    ),
  };
}

/**
 * The routes this document declares, as `METHOD /path` with Express parameter
 * syntax, so it can be compared with what the server dispatches.
 *
 * OpenAPI writes parameters as `{widgetId}` and Express as `:widgetId`; the
 * translation happens here rather than in the test, so there is one place that
 * knows about the difference.
 */
export function documentedRoutes(): readonly string[] {
  const found: string[] = [];
  for (const [route, operations] of Object.entries(paths)) {
    const expressPath = route.replace(/\{([^}]+)\}/g, ':$1');
    for (const [method, operation] of Object.entries(operations as Json)) {
      if (operation === undefined) continue;
      found.push(`${method.toUpperCase()} ${expressPath}`);
    }
  }
  return found.sort();
}
