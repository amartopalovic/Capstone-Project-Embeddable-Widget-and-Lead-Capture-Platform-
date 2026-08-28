import type { Capability, PolicyDecision, WorkspaceRoleName } from '@lcp/contracts';

/**
 * The authorization matrix from blueprint section 11.
 *
 * This is a static table, deliberately. Every cell depends only on the role,
 * plus a verified-email qualifier on two rows; no cell depends on the record
 * being acted upon. An authorization library such as CASL earns its place when
 * decisions carry per-record conditions, and its own documentation recommends a
 * code-defined table for exactly this case. Wrapping a literal table in a rules
 * engine would add indirection and make "assert every cell" harder rather than
 * easier.
 *
 * The table is transcribed one row per matrix row, in the blueprint's own
 * order, so the two can be diffed by eye. Every cell is asserted in
 * `tests/rbac.test.ts`, including the rows that have no route yet - widgets,
 * contacts, exports, and deliveries arrive in Stages 5, 8, and 9, and their
 * guards will attach to a policy engine that already answers correctly.
 */
const MATRIX: Readonly<Record<Capability, Readonly<Record<WorkspaceRoleName, PolicyDecision>>>> = {
  // | View workspace dashboard | Yes | Yes | Yes |
  'workspace.view': { owner: 'allow', admin: 'allow', member: 'allow' },

  // | Create/edit widget draft | Yes | Yes | Yes |
  'widget.draft.write': { owner: 'allow', admin: 'allow', member: 'allow' },

  // | Publish/unpublish widget | Yes, verified | Yes, verified | No |
  'widget.publish': {
    owner: 'requires_verified_email',
    admin: 'requires_verified_email',
    member: 'deny',
  },

  // | Delete/recover widget | Yes | Yes | No |
  'widget.delete': { owner: 'allow', admin: 'allow', member: 'deny' },

  // | View contacts/submissions | Yes | Yes | Yes |
  'contact.view': { owner: 'allow', admin: 'allow', member: 'allow' },

  // | Change status/assignee/tags/notes | Yes | Yes | Yes |
  'contact.workflow.write': { owner: 'allow', admin: 'allow', member: 'allow' },

  // | Edit/merge canonical Contact | Yes | Yes | No |
  'contact.canonical.write': { owner: 'allow', admin: 'allow', member: 'deny' },

  // | Export leads | Yes | Yes | No |
  'contact.export': { owner: 'allow', admin: 'allow', member: 'deny' },

  // | Soft-delete/recover leads | Yes | Yes | No |
  'contact.delete': { owner: 'allow', admin: 'allow', member: 'deny' },

  // | Manage webhook/email settings | Yes | Yes | No |
  'settings.delivery.write': { owner: 'allow', admin: 'allow', member: 'deny' },

  // | View delivery operations | Yes | Yes | Limited per-lead activity only |
  'delivery.view': { owner: 'allow', admin: 'allow', member: 'limited' },

  // | Invite/remove Members | Yes | Yes | No |
  //
  // Inviting also requires a verified email (blueprint 4.1: "publishing and
  // invitations are blocked" for unverified users). Section 11 does not repeat
  // the qualifier on this row, but 4.1 states it directly, so it is encoded
  // here rather than left to a route to remember.
  'member.manage': {
    owner: 'requires_verified_email',
    admin: 'requires_verified_email',
    member: 'deny',
  },

  // | Assign/remove Admin role | Yes | No | No |
  //
  // The asymmetry that matters: an Admin manages Members but cannot create or
  // remove another Admin. Only the Owner touches Admin status.
  'admin.manage': { owner: 'allow', admin: 'deny', member: 'deny' },

  // | Transfer ownership | Yes | No | No |
  'workspace.transfer': { owner: 'allow', admin: 'deny', member: 'deny' },

  // | Delete/recover workspace | Yes | No | No |
  'workspace.delete': { owner: 'allow', admin: 'deny', member: 'deny' },

  // | View workspace audit log | Yes | Yes | No |
  'audit.view': { owner: 'allow', admin: 'allow', member: 'deny' },
};

export interface PolicySubject {
  readonly role: WorkspaceRoleName;
  readonly emailVerified: boolean;
}

/**
 * The raw matrix answer, before the subject's verification state is applied.
 *
 * The table is complete by construction, so a miss is impossible; it throws
 * rather than defaulting, because silently returning `allow` or `deny` for an
 * unknown capability is the kind of failure an authorization layer must never
 * have.
 */
export function decisionFor(role: WorkspaceRoleName, capability: Capability): PolicyDecision {
  const row = MATRIX[capability] as Readonly<Record<WorkspaceRoleName, PolicyDecision>> | undefined;
  const decision = row?.[role];
  if (decision === undefined) {
    throw new Error(`No policy defined for capability "${capability}" and role "${role}"`);
  }
  return decision;
}

/**
 * Resolve a capability question for a concrete subject.
 *
 * `limited` resolves to allow: the caller may reach the surface, and the
 * surface itself narrows what it returns. Encoding it as a deny would hide a
 * view the matrix grants.
 */
export function can(subject: PolicySubject, capability: Capability): boolean {
  const decision = decisionFor(subject.role, capability);

  switch (decision) {
    case 'allow':
    case 'limited':
      return true;
    case 'requires_verified_email':
      return subject.emailVerified;
    case 'deny':
      return false;
    default:
      // Unreachable: PolicyDecision is a closed union. Denying is the safe
      // answer if a new decision kind is ever added without updating this.
      return false;
  }
}

/** True when the only thing standing in the way is an unconfirmed address. */
export function blockedOnlyByVerification(subject: PolicySubject, capability: Capability): boolean {
  return (
    decisionFor(subject.role, capability) === 'requires_verified_email' && !subject.emailVerified
  );
}

/** True when the subject sees a reduced version of the surface. */
export function isLimited(role: WorkspaceRoleName, capability: Capability): boolean {
  return decisionFor(role, capability) === 'limited';
}

/**
 * Whether `actor` may change `target`'s role to `nextRole`.
 *
 * Role changes need more than a single capability lookup, because which
 * capability applies depends on the roles involved:
 *
 *  - touching an Admin, in either direction, needs `admin.manage` (Owner only);
 *  - touching a Member stays within `member.manage` (Owner or Admin);
 *  - the Owner's own role is never changed this way. Ownership moves through
 *    transfer, which keeps the one-active-owner invariant intact;
 *  - nobody changes their own role, which would let an Admin quietly promote
 *    themselves if `admin.manage` were ever widened.
 */
export function canChangeRole(
  actor: PolicySubject & { readonly userId: string },
  target: { readonly userId: string; readonly role: WorkspaceRoleName },
  nextRole: WorkspaceRoleName,
): boolean {
  if (actor.userId === target.userId) return false;
  if (target.role === 'owner' || nextRole === 'owner') return false;

  const touchesAdmin = target.role === 'admin' || nextRole === 'admin';
  return can(actor, touchesAdmin ? 'admin.manage' : 'member.manage');
}

/**
 * Whether `actor` may remove `target` from the workspace.
 *
 * The Owner can never be removed; they must transfer ownership first, which is
 * what keeps a workspace from ending up with no owner.
 */
export function canRemoveMember(
  actor: PolicySubject & { readonly userId: string },
  target: { readonly userId: string; readonly role: WorkspaceRoleName },
): boolean {
  if (target.role === 'owner') return false;
  // Leaving voluntarily is a different action; removal is something done to
  // someone else.
  if (actor.userId === target.userId) return false;

  return can(actor, target.role === 'admin' ? 'admin.manage' : 'member.manage');
}
