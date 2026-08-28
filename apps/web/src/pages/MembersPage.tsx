import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import type { InvitableRole, InvitationSummary, MemberSummary } from '@lcp/contracts';
import { fieldError, workspaceApi, type ApiFailure } from '../lib/api.js';
import { useWorkspace } from '../lib/workspace-context.js';
import { Alert, Button, Field, RoleChip } from '../components/ui.jsx';

/**
 * People and invitations (blueprint 4.1 and 11).
 *
 * Every control on this page is shown only when the SERVER says the caller may
 * use it. The invite form keys off the `member.manage` capability the API
 * derived from the section 11 matrix; each member row keys off the
 * `assignableRoles` and `canRemove` the API computed for that specific pairing
 * of caller and target. Nothing here re-decides the policy, so a Member sees a
 * read-only roster rather than buttons that would fail on click - and the
 * server would still refuse them if it were wrong.
 */
export function MembersPage(): React.JSX.Element {
  const { user, active, capabilities, refresh } = useWorkspace();
  const canManageMembers = capabilities.includes('member.manage');
  const canManageAdmins = capabilities.includes('admin.manage');

  const [members, setMembers] = useState<readonly MemberSummary[]>([]);
  const [invitations, setInvitations] = useState<readonly InvitationSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    const memberResult = await workspaceApi.members();
    if (memberResult.ok) setMembers(memberResult.data.members);

    // Listing invitations itself needs `member.manage`, so a Member never asks.
    if (canManageMembers) {
      const inviteResult = await workspaceApi.invitations();
      if (inviteResult.ok) setInvitations(inviteResult.data.invitations);
    } else {
      setInvitations([]);
    }
    setLoading(false);
  }, [canManageMembers]);

  useEffect(() => {
    void load();
  }, [load, active.id]);

  async function changeRole(member: MemberSummary, role: InvitableRole): Promise<void> {
    setNotice(null);
    setFailure(null);
    const result = await workspaceApi.changeRole(member.userId, role);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setNotice(`${member.email} is now ${role === 'admin' ? 'an Admin' : 'a Member'}.`);
    await load();
  }

  async function removeMember(member: MemberSummary): Promise<void> {
    setNotice(null);
    setFailure(null);
    const result = await workspaceApi.removeMember(member.userId);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setNotice(`${member.email} was removed from this workspace.`);
    await load();
  }

  async function revoke(invitation: InvitationSummary): Promise<void> {
    setNotice(null);
    setFailure(null);
    const result = await workspaceApi.revokeInvitation(invitation.id);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setNotice(`The invitation to ${invitation.email} was cancelled.`);
    await load();
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <header className="mb-8 border-b border-edge pb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">People</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          Members and invitations
        </h1>
        <p className="mt-2 text-sm text-muted">
          Up to 10 people can share a workspace, including the Owner.
        </p>
      </header>

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {failure !== null && <Alert tone="error">{failure.message}</Alert>}

      {/*
       * The unverified case is a DIFFERENT message from a plain refusal, which
       * is why the API answers with `email_not_verified` rather than a generic
       * forbidden: the fix is in the user's inbox, not in their role.
       */}
      {!canManageMembers && !user.emailVerified && (
        <Alert tone="info">
          Confirm your email address to invite people. We sent a link when you registered.
        </Alert>
      )}

      <section aria-labelledby="members-heading" className="mb-10">
        <h2 id="members-heading" className="text-lg font-semibold text-ink">
          In this workspace
        </h2>

        {loading ? (
          <p className="mt-4 text-sm text-muted">Loading members.</p>
        ) : (
          <ul
            data-testid="member-list"
            className="mt-4 divide-y divide-edge border border-edge bg-panel"
          >
            {members.map((member) => (
              <li
                key={member.userId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    <span className="break-all">{member.email}</span>
                    <RoleChip role={member.role} />
                    {member.isSelf && (
                      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-signal">
                        you
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted">
                    {member.emailVerified ? 'Email confirmed' : 'Email not confirmed'} &middot;
                    joined {new Date(member.joinedAt).toLocaleDateString()}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <RoleSelect member={member} onChange={changeRole} />
                  {member.canRemove && (
                    <button
                      type="button"
                      onClick={() => void removeMember(member)}
                      className="border border-edge px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper"
                    >
                      Remove
                      <span className="sr-only"> {member.email}</span>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManageMembers && (
        <>
          <section aria-labelledby="invite-heading" className="mb-10">
            <h2 id="invite-heading" className="text-lg font-semibold text-ink">
              Invite someone
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              They get an email link that works once and expires after 7 days.
            </p>
            <InviteForm
              canInviteAdmins={canManageAdmins}
              onInvited={async (email) => {
                setFailure(null);
                setNotice(`Invitation sent to ${email}.`);
                await load();
              }}
              onFailure={(value) => {
                setNotice(null);
                setFailure(value);
              }}
            />
          </section>

          <section aria-labelledby="pending-heading">
            <h2 id="pending-heading" className="text-lg font-semibold text-ink">
              Pending invitations
            </h2>
            {invitations.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No invitations are waiting to be accepted.</p>
            ) : (
              <ul
                data-testid="invitation-list"
                className="mt-4 divide-y divide-edge border border-edge bg-panel"
              >
                {invitations.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                        <span className="break-all">{invitation.email}</span>
                        <RoleChip role={invitation.role} />
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted">
                        Expires {new Date(invitation.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void revoke(invitation)}
                      className="shrink-0 border border-edge px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper"
                    >
                      Cancel
                      <span className="sr-only"> the invitation to {invitation.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* Refreshing the shell keeps the switcher's role chip honest after a
          change that affects the current user. */}
      <RefreshOnRoleChange members={members} selfId={user.id} onStale={refresh} />
    </main>
  );
}

interface RoleSelectProps {
  readonly member: MemberSummary;
  readonly onChange: (member: MemberSummary, role: InvitableRole) => Promise<void>;
}

/**
 * The role control for one member.
 *
 * Rendered only when the server offered a role other than the one they already
 * hold. A native `select` is the accessible primitive for choosing one of a
 * short, fixed set; wrapping a listbox around it would add behaviour to
 * re-implement and nothing a user gains.
 */
function RoleSelect({ member, onChange }: RoleSelectProps): React.JSX.Element | null {
  const choices = member.assignableRoles.filter((role) => role !== member.role);
  if (choices.length === 0) return null;

  const options = [member.role, ...choices];

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Role for {member.email}</span>
      <select
        data-testid={`role-select-${member.email}`}
        value={member.role}
        onChange={(event) => void onChange(member, event.target.value as InvitableRole)}
        className="border border-edge bg-panel px-2 py-1.5 text-xs text-ink"
      >
        {options.map((role) => (
          <option key={role} value={role}>
            {role === 'admin' ? 'Admin' : 'Member'}
          </option>
        ))}
      </select>
    </label>
  );
}

interface InviteFormProps {
  readonly canInviteAdmins: boolean;
  readonly onInvited: (email: string) => Promise<void>;
  readonly onFailure: (failure: ApiFailure) => void;
}

function InviteForm({ canInviteAdmins, onInvited, onFailure }: InviteFormProps): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole>('member');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const result = await workspaceApi.invite(email, role);
    setBusy(false);

    if (!result.ok) {
      setFailure(result);
      onFailure(result);
      return;
    }
    const invited = email;
    setEmail('');
    setRole('member');
    await onInvited(invited);
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="mt-4" noValidate>
      <Field
        label="Email address"
        type="email"
        name="email"
        autoComplete="off"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={failure === null ? undefined : fieldError(failure, 'email')}
      />

      <div className="mb-5">
        <label
          htmlFor="invite-role"
          className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted"
        >
          Role
        </label>
        <select
          id="invite-role"
          name="role"
          value={role}
          onChange={(event) => setRole(event.target.value as InvitableRole)}
          className="w-full border border-edge bg-panel px-3 py-2.5 text-ink"
        >
          <option value="member">Member</option>
          {/*
           * Only the Owner assigns Admin status, so the option is absent rather
           * than present-and-rejected. The route enforces the same rule.
           */}
          {canInviteAdmins && <option value="admin">Admin</option>}
        </select>
      </div>

      <Button type="submit" busy={busy}>
        Send invitation
      </Button>
    </form>
  );
}

interface RefreshOnRoleChangeProps {
  readonly members: readonly MemberSummary[];
  readonly selfId: string;
  readonly onStale: () => Promise<void>;
}

/**
 * Keep the shell in step when the caller's OWN role changes underneath them.
 *
 * Losing Admin should take the audit link out of the nav immediately, not at
 * the next full page load.
 */
function RefreshOnRoleChange({
  members,
  selfId,
  onStale,
}: RefreshOnRoleChangeProps): React.JSX.Element | null {
  const { active } = useWorkspace();
  const self = members.find((member) => member.userId === selfId);
  const changed = self !== undefined && self.role !== active.role;

  useEffect(() => {
    if (changed) void onStale();
  }, [changed, onStale]);

  return null;
}
