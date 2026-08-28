import * as z from 'zod';

/**
 * Workspace, membership, and invitation contracts (blueprint 4.1 and 11).
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const WORKSPACE_ROLE_VALUES = ['owner', 'admin', 'member'] as const;
export type WorkspaceRoleName = (typeof WORKSPACE_ROLE_VALUES)[number];

/**
 * Roles that can be granted by invitation.
 *
 * Owner is deliberately absent: blueprint 4.1 gives a workspace exactly one
 * owner, and ownership moves only by explicit transfer, never by invite.
 */
export const INVITABLE_ROLES = ['admin', 'member'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

// ---------------------------------------------------------------------------
// Capabilities - one per row of the blueprint section 11 matrix
// ---------------------------------------------------------------------------

export const CAPABILITIES = [
  'workspace.view',
  'widget.draft.write',
  'widget.publish',
  'widget.delete',
  'contact.view',
  'contact.workflow.write',
  'contact.canonical.write',
  'contact.export',
  'contact.delete',
  'settings.delivery.write',
  'delivery.view',
  'member.manage',
  'admin.manage',
  'workspace.transfer',
  'workspace.delete',
  'audit.view',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * The outcome of a policy question.
 *
 * `requires_verified_email` is a distinct answer rather than a plain deny,
 * because blueprint section 11 marks two rows "Yes, verified": the role is
 * sufficient but the account must also be verified. Collapsing it into deny
 * would lose the difference between "you may never" and "confirm your email
 * first", which are different messages to the user.
 *
 * `limited` covers the single cell where a Member gets a reduced view
 * ("Limited per-lead activity only" for delivery operations).
 */
export const POLICY_DECISIONS = ['allow', 'deny', 'requires_verified_email', 'limited'] as const;
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const WORKSPACE_NAME_MIN = 2;
export const WORKSPACE_NAME_MAX = 60;

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(WORKSPACE_NAME_MIN, `Use at least ${String(WORKSPACE_NAME_MIN)} characters`)
  .max(WORKSPACE_NAME_MAX, `Use at most ${String(WORKSPACE_NAME_MAX)} characters`);

/**
 * An IANA zone such as `Europe/Berlin`.
 *
 * Only the shape is checked here; whether the runtime actually knows the zone
 * is checked on the server, because that depends on the ICU data the process
 * was built with.
 */
export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9+_\-/]+$/, 'Enter a valid IANA time zone, for example Europe/Berlin');

export const onboardWorkspaceSchema = z.object({
  name: workspaceNameSchema,
  timezone: timezoneSchema,
});
export type OnboardWorkspace = z.infer<typeof onboardWorkspaceSchema>;

export const switchWorkspaceSchema = z.object({
  workspaceId: z.string().regex(/^[0-9a-f]{24}$/, 'Unknown workspace'),
});
export type SwitchWorkspace = z.infer<typeof switchWorkspaceSchema>;

export const inviteMemberSchema = z.object({
  email: z.email('Enter a valid email address').trim().min(3).max(254),
  role: z.enum(INVITABLE_ROLES),
});
export type InviteMember = z.infer<typeof inviteMemberSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(1).max(512),
});
export type AcceptInvitation = z.infer<typeof acceptInvitationSchema>;

export const changeRoleSchema = z.object({
  role: z.enum(INVITABLE_ROLES),
});
export type ChangeRole = z.infer<typeof changeRoleSchema>;

export const transferOwnershipSchema = z.object({
  /** The Admin who becomes Owner. Must already be a verified Admin here. */
  toUserId: z.string().regex(/^[0-9a-f]{24}$/, 'Unknown member'),
});
export type TransferOwnership = z.infer<typeof transferOwnershipSchema>;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly timezone: string;
  /** The calling user's role in this workspace. */
  readonly role: WorkspaceRoleName;
  readonly isActive: boolean;
}

export interface MemberSummary {
  readonly userId: string;
  readonly email: string;
  readonly role: WorkspaceRoleName;
  readonly emailVerified: boolean;
  readonly joinedAt: string;
  readonly isSelf: boolean;
}

export interface InvitationSummary {
  readonly id: string;
  readonly email: string;
  readonly role: WorkspaceRoleName;
  readonly invitedAt: string;
  readonly expiresAt: string;
}

/**
 * Usage meters against the public-demo caps in blueprint 4.10.
 *
 * Only the user meter is real at this stage. The others are reported as null
 * rather than zero, so a reader can tell "nothing has happened yet" apart from
 * "this is not measured yet"; fabricating zeros would be a quiet false claim.
 */
export interface WorkspaceUsage {
  readonly users: { readonly used: number; readonly limit: number };
  readonly activeWidgets: { readonly used: number | null; readonly limit: number };
  readonly submissionsThisMonth: { readonly used: number | null; readonly limit: number };
  readonly interactionEventsThisMonth: { readonly used: number | null; readonly limit: number };
}

export const WORKSPACE_LIMITS = {
  users: 10,
  activeWidgets: 10,
  submissionsPerMonth: 2000,
  interactionEventsPerMonth: 20_000,
} as const;

export interface AuditEntrySummary {
  readonly id: string;
  readonly type: string;
  readonly actorUserId: string | null;
  readonly occurredAt: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * What an invitation acceptance attempt resolved to.
 *
 * `registration_required` is not an error: a brand-new recipient has to create
 * and verify an account first, and the invitation waits for them. No membership
 * is ever created for an unverified identity.
 */
export type AcceptInvitationResult =
  | { readonly status: 'joined'; readonly workspace: WorkspaceSummary }
  | { readonly status: 'registration_required'; readonly email: string }
  | { readonly status: 'verification_required'; readonly email: string };
