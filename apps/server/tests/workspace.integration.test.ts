import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COLLECTIONS } from '@lcp/database';
import type { MemberSummary, WorkspaceSummary, WorkspaceUsage } from '@lcp/contracts';
import {
  STRONG_PASSWORD,
  TestClient,
  createAuthHarness,
  extractToken,
  mailpitBody,
  uniqueEmail,
  waitForEmail,
  type AuthHarness,
} from './helpers/auth-harness.js';

/**
 * Onboarding, workspace context, RBAC, invitations, ownership transfer, and
 * workspace lifecycle - against real MongoDB, Redis, and Mailpit.
 */

let harness: AuthHarness;

beforeAll(async () => {
  harness = await createAuthHarness();
}, 120_000);

beforeEach(async () => {
  await harness.clearRateLimits();
});

afterAll(async () => {
  await harness?.teardown();
});

function client(): TestClient {
  return new TestClient(harness.baseUrl);
}

interface Actor {
  readonly api: TestClient;
  readonly email: string;
  readonly userId: string;
}

/** Register, verify by following the emailed link, and sign in. */
async function verifiedUser(label: string): Promise<Actor> {
  const email = uniqueEmail(label);
  const api = client();

  await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
  const message = await waitForEmail(email, (m) => m.Subject.includes('Confirm'));
  const token = extractToken(await mailpitBody(message.ID));
  expect((await api.post('/api/v1/auth/verify', { token })).status).toBe(200);

  const login = await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
  expect(login.status).toBe(200);

  const me = await api.get('/api/v1/auth/me');
  const userId = (me.body as { user: { id: string } }).user.id;

  return { api, email, userId };
}

/** Register and sign in WITHOUT confirming the address. */
async function unverifiedUser(label: string): Promise<Actor> {
  const email = uniqueEmail(label);
  const api = client();
  await api.post('/api/v1/auth/register', { email, password: STRONG_PASSWORD });
  const login = await api.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
  expect(login.status).toBe(200);
  const me = await api.get('/api/v1/auth/me');
  return { api, email, userId: (me.body as { user: { id: string } }).user.id };
}

async function onboard(actor: Actor, name: string): Promise<string> {
  const response = await actor.api.post(
    '/api/v1/workspaces',
    { name, timezone: 'Europe/Berlin' },
    await actor.api.csrfHeaders(),
  );
  expect(response.status).toBe(201);
  return (response.body as { workspace: WorkspaceSummary }).workspace.id;
}

/** Invite someone, follow the emailed link, and have them accept. */
async function inviteAndAccept(
  inviter: Actor,
  invitee: Actor,
  role: 'admin' | 'member',
): Promise<void> {
  const sent = await inviter.api.post(
    '/api/v1/invitations',
    { email: invitee.email, role },
    await inviter.api.csrfHeaders(),
  );
  expect(sent.status).toBe(202);

  const message = await waitForEmail(invitee.email, (m) => m.Subject.includes('Join'));
  const token = extractToken(await mailpitBody(message.ID));

  const accepted = await invitee.api.post(
    '/api/v1/invitations/accept',
    { token },
    await invitee.api.csrfHeaders(),
  );
  expect(accepted.status).toBe(200);
}

// ---------------------------------------------------------------------------

describe('onboarding (blueprint 4.1)', () => {
  it('creates a first workspace, makes the creator its Owner, and selects it', async () => {
    const owner = await verifiedUser('onboard');
    const workspaceId = await onboard(owner, 'Acme Marketing');

    const current = await owner.api.get('/api/v1/workspaces/current');
    expect(current.status).toBe(200);
    const workspace = (current.body as { workspace: WorkspaceSummary }).workspace;
    expect(workspace.id).toBe(workspaceId);
    expect(workspace.name).toBe('Acme Marketing');
    expect(workspace.role).toBe('owner');
    expect(workspace.timezone).toBe('Europe/Berlin');
  }, 120_000);

  it('refuses a second owned workspace with a clean 409, not a driver error', async () => {
    const owner = await verifiedUser('twoworkspaces');
    await onboard(owner, 'First');

    const second = await owner.api.post(
      '/api/v1/workspaces',
      { name: 'Second', timezone: 'Europe/Berlin' },
      await owner.api.csrfHeaders(),
    );

    expect(second.status).toBe(409);
    const body = second.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('conflict');
    // The duplicate-key error must not leak through as a 500 or raw text.
    expect(body.error.message).not.toMatch(/E11000|duplicate key|mongo/i);
  }, 120_000);

  it('rejects a time zone the runtime does not know', async () => {
    const owner = await verifiedUser('badtz');
    const response = await owner.api.post(
      '/api/v1/workspaces',
      { name: 'Bad Zone', timezone: 'Nonsense/Zone' },
      await owner.api.csrfHeaders(),
    );
    expect(response.status).toBe(400);
  }, 120_000);

  it('accepts UTC, which a supportedValuesOf check would have rejected', async () => {
    const owner = await verifiedUser('utc');
    const response = await owner.api.post(
      '/api/v1/workspaces',
      { name: 'UTC Workspace', timezone: 'UTC' },
      await owner.api.csrfHeaders(),
    );
    expect(response.status).toBe(201);
  }, 120_000);
});

describe('workspace context and switching (blueprint 9.1 and 10.3)', () => {
  it('refuses workspace-scoped calls until a workspace is selected', async () => {
    const user = await verifiedUser('noworkspace');
    // Signed in, but no workspace context yet.
    expect((await user.api.get('/api/v1/workspaces/current')).status).toBe(404);
    expect((await user.api.get('/api/v1/members')).status).toBe(404);
  }, 120_000);

  it('lists the workspaces a user belongs to, with their role in each', async () => {
    const owner = await verifiedUser('lister');
    const other = await verifiedUser('otherowner');

    await onboard(owner, 'Owned Workspace');
    await onboard(other, 'Other Workspace');
    await inviteAndAccept(other, owner, 'member');

    const list = await owner.api.get('/api/v1/workspaces');
    const workspaces = (list.body as { workspaces: WorkspaceSummary[] }).workspaces;

    expect(workspaces).toHaveLength(2);
    expect(workspaces.find((w) => w.name === 'Owned Workspace')?.role).toBe('owner');
    expect(workspaces.find((w) => w.name === 'Other Workspace')?.role).toBe('member');
  }, 180_000);

  it('refuses to switch into a workspace the caller does not belong to', async () => {
    const owner = await verifiedUser('switchowner');
    const stranger = await verifiedUser('stranger');
    const workspaceId = await onboard(owner, 'Private');
    await onboard(stranger, 'Strangers Own');

    const attempt = await stranger.api.post(
      '/api/v1/workspaces/switch',
      { workspaceId },
      await stranger.api.csrfHeaders(),
    );

    // Same answer as a workspace that does not exist, so this cannot be used
    // to discover which ids are real.
    expect(attempt.status).toBe(404);

    // And the stranger is still in their own workspace.
    const current = await stranger.api.get('/api/v1/workspaces/current');
    expect((current.body as { workspace: WorkspaceSummary }).workspace.name).toBe('Strangers Own');
  }, 180_000);

  it('scopes subsequent calls to whichever workspace is selected', async () => {
    const owner = await verifiedUser('scoping');
    const host = await verifiedUser('scopinghost');

    const ownWorkspace = await onboard(owner, 'Own');
    await onboard(host, 'Host');
    await inviteAndAccept(host, owner, 'member');

    // In the host workspace: two members, and the caller is a Member.
    const hostList = await owner.api.get('/api/v1/workspaces');
    const hostWorkspace = (hostList.body as { workspaces: WorkspaceSummary[] }).workspaces.find(
      (w) => w.name === 'Host',
    );
    await owner.api.post(
      '/api/v1/workspaces/switch',
      { workspaceId: hostWorkspace?.id },
      await owner.api.csrfHeaders(),
    );
    const inHost = await owner.api.get('/api/v1/members');
    expect((inHost.body as { members: MemberSummary[] }).members).toHaveLength(2);

    // Switch back: one member, and the caller is the Owner.
    await owner.api.post(
      '/api/v1/workspaces/switch',
      { workspaceId: ownWorkspace },
      await owner.api.csrfHeaders(),
    );
    const inOwn = await owner.api.get('/api/v1/members');
    expect((inOwn.body as { members: MemberSummary[] }).members).toHaveLength(1);
  }, 180_000);

  it('stops acting in a workspace the moment membership is revoked', async () => {
    const host = await verifiedUser('revokehost');
    const guest = await verifiedUser('revokeguest');
    await onboard(host, 'Revoking');
    await inviteAndAccept(host, guest, 'member');

    // The guest is in and can see the workspace.
    expect((await guest.api.get('/api/v1/workspaces/current')).status).toBe(200);

    await host.api.delete(`/api/v1/members/${guest.userId}`, await host.api.csrfHeaders());

    // Membership is re-checked per request, so access ends immediately rather
    // than at the guest's next switch.
    expect((await guest.api.get('/api/v1/workspaces/current')).status).toBe(404);
    expect((await guest.api.get('/api/v1/members')).status).toBe(404);
  }, 180_000);
});

describe('invitations (blueprint 4.1)', () => {
  it('invites an existing verified user, who joins by following the emailed link', async () => {
    const owner = await verifiedUser('inviteowner');
    const invitee = await verifiedUser('invitee');
    await onboard(owner, 'Inviting');

    await inviteAndAccept(owner, invitee, 'member');

    const members = await owner.api.get('/api/v1/members');
    const list = (members.body as { members: MemberSummary[] }).members;
    expect(list).toHaveLength(2);
    expect(list.find((m) => m.email === invitee.email)?.role).toBe('member');
  }, 180_000);

  it('joins a brand-new recipient once they register and verify', async () => {
    const owner = await verifiedUser('newrecipient');
    await onboard(owner, 'Waiting Room');

    // Invite someone who has no account at all.
    const strangerEmail = uniqueEmail('stranger-new');
    const sent = await owner.api.post(
      '/api/v1/invitations',
      { email: strangerEmail, role: 'member' },
      await owner.api.csrfHeaders(),
    );
    expect(sent.status).toBe(202);
    await waitForEmail(strangerEmail, (m) => m.Subject.includes('Join'));

    // They register and verify. No membership may exist before verification.
    const newcomer = client();
    await newcomer.post('/api/v1/auth/register', {
      email: strangerEmail,
      password: STRONG_PASSWORD,
    });

    const beforeVerify = await harness.db.collection(COLLECTIONS.memberships).countDocuments({});
    const confirm = await waitForEmail(strangerEmail, (m) => m.Subject.includes('Confirm'));
    const verifyToken = extractToken(await mailpitBody(confirm.ID));

    const verified = await newcomer.post('/api/v1/auth/verify', { token: verifyToken });
    expect(verified.status).toBe(200);
    // Verification completes the invitation that was waiting for them.
    expect((verified.body as { joinedWorkspaces: number }).joinedWorkspaces).toBe(1);

    const afterVerify = await harness.db.collection(COLLECTIONS.memberships).countDocuments({});
    expect(afterVerify).toBe(beforeVerify + 1);

    // They can now sign in and reach the workspace.
    await newcomer.post('/api/v1/auth/login', { email: strangerEmail, password: STRONG_PASSWORD });
    const list = await newcomer.get('/api/v1/workspaces');
    expect((list.body as { workspaces: WorkspaceSummary[] }).workspaces).toHaveLength(1);
  }, 240_000);

  it('never creates a membership for an unverified identity', async () => {
    const owner = await verifiedUser('unverifiedjoin');
    await onboard(owner, 'Verified Only');

    const invitee = await unverifiedUser('unverifiedinvitee');
    await owner.api.post(
      '/api/v1/invitations',
      { email: invitee.email, role: 'member' },
      await owner.api.csrfHeaders(),
    );
    const message = await waitForEmail(invitee.email, (m) => m.Subject.includes('Join'));
    const token = extractToken(await mailpitBody(message.ID));

    const attempt = await invitee.api.post(
      '/api/v1/invitations/accept',
      { token },
      await invitee.api.csrfHeaders(),
    );
    expect(attempt.status).toBe(403);
    expect((attempt.body as { error: { code: string } }).error.code).toBe('email_not_verified');

    // Still one member: the owner.
    const members = await owner.api.get('/api/v1/members');
    expect((members.body as { members: MemberSummary[] }).members).toHaveLength(1);
  }, 180_000);

  it('blocks an UNVERIFIED owner from inviting at all', async () => {
    // The gate Stage 3a built and could not yet attach to anything.
    const owner = await unverifiedUser('unverifiedowner');

    const created = await owner.api.post(
      '/api/v1/workspaces',
      { name: 'Unverified Owner', timezone: 'UTC' },
      await owner.api.csrfHeaders(),
    );
    expect(created.status).toBe(201);

    // The dashboard is still available (blueprint 4.1)...
    expect((await owner.api.get('/api/v1/workspaces/current')).status).toBe(200);

    // ...but inviting is not.
    const invite = await owner.api.post(
      '/api/v1/invitations',
      { email: uniqueEmail('never'), role: 'member' },
      await owner.api.csrfHeaders(),
    );
    expect(invite.status).toBe(403);
    expect((invite.body as { error: { code: string } }).error.code).toBe('email_not_verified');
  }, 180_000);

  it('rejects a reused invitation token', async () => {
    const owner = await verifiedUser('reuseowner');
    const invitee = await verifiedUser('reuseinvitee');
    await onboard(owner, 'Reuse');

    await owner.api.post(
      '/api/v1/invitations',
      { email: invitee.email, role: 'member' },
      await owner.api.csrfHeaders(),
    );
    const message = await waitForEmail(invitee.email, (m) => m.Subject.includes('Join'));
    const token = extractToken(await mailpitBody(message.ID));

    expect(
      (
        await invitee.api.post(
          '/api/v1/invitations/accept',
          { token },
          await invitee.api.csrfHeaders(),
        )
      ).status,
    ).toBe(200);

    const replay = await invitee.api.post(
      '/api/v1/invitations/accept',
      { token },
      await invitee.api.csrfHeaders(),
    );
    expect(replay.status).toBe(400);
  }, 180_000);

  it('refuses an invitation token addressed to someone else', async () => {
    const owner = await verifiedUser('wrongowner');
    const intended = await verifiedUser('intended');
    const interceptor = await verifiedUser('interceptor');
    await onboard(owner, 'Intercept');

    await owner.api.post(
      '/api/v1/invitations',
      { email: intended.email, role: 'member' },
      await owner.api.csrfHeaders(),
    );
    const message = await waitForEmail(intended.email, (m) => m.Subject.includes('Join'));
    const token = extractToken(await mailpitBody(message.ID));

    const stolen = await interceptor.api.post(
      '/api/v1/invitations/accept',
      { token },
      await interceptor.api.csrfHeaders(),
    );
    expect(stolen.status).toBe(400);

    const members = await owner.api.get('/api/v1/members');
    expect((members.body as { members: MemberSummary[] }).members).toHaveLength(1);
  }, 240_000);

  it('revokes a pending invitation so its link stops working', async () => {
    const owner = await verifiedUser('revokeinviteowner');
    const invitee = await verifiedUser('revokeinvitee');
    await onboard(owner, 'Revoke Invite');

    await owner.api.post(
      '/api/v1/invitations',
      { email: invitee.email, role: 'member' },
      await owner.api.csrfHeaders(),
    );
    const message = await waitForEmail(invitee.email, (m) => m.Subject.includes('Join'));
    const token = extractToken(await mailpitBody(message.ID));

    const pending = await owner.api.get('/api/v1/invitations');
    const invitationId =
      (pending.body as { invitations: { id: string }[] }).invitations[0]?.id ?? '';

    expect(
      (await owner.api.delete(`/api/v1/invitations/${invitationId}`, await owner.api.csrfHeaders()))
        .status,
    ).toBe(204);

    const attempt = await invitee.api.post(
      '/api/v1/invitations/accept',
      { token },
      await invitee.api.csrfHeaders(),
    );
    expect(attempt.status).toBe(400);
  }, 180_000);

  it('stores only a hash of the invitation token', async () => {
    const owner = await verifiedUser('tokenhash');
    const invitee = await verifiedUser('tokenhashinvitee');
    await onboard(owner, 'Hashing');

    await owner.api.post(
      '/api/v1/invitations',
      { email: invitee.email, role: 'member' },
      await owner.api.csrfHeaders(),
    );
    const message = await waitForEmail(invitee.email, (m) => m.Subject.includes('Join'));
    const token = extractToken(await mailpitBody(message.ID));

    const stored = await harness.db
      .collection(COLLECTIONS.invitations)
      .findOne({ normalizedEmail: invitee.email });

    expect(JSON.stringify(stored)).not.toContain(token);
    expect(String(stored?.['tokenHash'])).toMatch(/^[0-9a-f]{64}$/);
  }, 180_000);
});

describe('the role matrix, enforced over HTTP (blueprint 11)', () => {
  it('stops a Member from inviting, changing roles, transferring, or deleting', async () => {
    const owner = await verifiedUser('matrixowner');
    const member = await verifiedUser('matrixmember');
    await onboard(owner, 'Matrix');
    await inviteAndAccept(owner, member, 'member');

    const headers = await member.api.csrfHeaders();

    expect(
      (
        await member.api.post(
          '/api/v1/invitations',
          { email: uniqueEmail('x'), role: 'member' },
          headers,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await member.api.post(
          '/api/v1/workspaces/transfer-ownership',
          { toUserId: owner.userId },
          headers,
        )
      ).status,
    ).toBe(403);
    expect((await member.api.delete('/api/v1/workspaces/current', headers)).status).toBe(403);
    expect((await member.api.get('/api/v1/workspaces/audit')).status).toBe(403);

    // But a Member CAN view the workspace, per the matrix.
    expect((await member.api.get('/api/v1/workspaces/current')).status).toBe(200);
    expect((await member.api.get('/api/v1/members')).status).toBe(200);
  }, 240_000);

  it('lets an Admin invite and remove Members but never touch Admin status', async () => {
    const owner = await verifiedUser('adminowner');
    const admin = await verifiedUser('theadmin');
    const member = await verifiedUser('theirmember');
    await onboard(owner, 'Admin Powers');
    await inviteAndAccept(owner, admin, 'admin');
    await inviteAndAccept(owner, member, 'member');

    const headers = await admin.api.csrfHeaders();

    // Can invite a Member.
    expect(
      (
        await admin.api.post(
          '/api/v1/invitations',
          { email: uniqueEmail('byadmin'), role: 'member' },
          headers,
        )
      ).status,
    ).toBe(202);

    // Cannot invite an Admin: that is assigning Admin status.
    expect(
      (
        await admin.api.post(
          '/api/v1/invitations',
          { email: uniqueEmail('adminbyadmin'), role: 'admin' },
          headers,
        )
      ).status,
    ).toBe(403);

    // Cannot promote a Member to Admin.
    expect(
      (
        await admin.api.request(
          'PATCH',
          `/api/v1/members/${member.userId}/role`,
          { role: 'admin' },
          headers,
        )
      ).status,
    ).toBe(403);

    // Cannot transfer ownership or delete the workspace.
    expect(
      (
        await admin.api.post(
          '/api/v1/workspaces/transfer-ownership',
          { toUserId: admin.userId },
          headers,
        )
      ).status,
    ).toBe(403);
    expect((await admin.api.delete('/api/v1/workspaces/current', headers)).status).toBe(403);

    // Can remove a Member.
    expect((await admin.api.delete(`/api/v1/members/${member.userId}`, headers)).status).toBe(204);

    // Can view the audit log.
    expect((await admin.api.get('/api/v1/workspaces/audit')).status).toBe(200);
  }, 300_000);

  it('lets the Owner promote and demote Admins', async () => {
    const owner = await verifiedUser('promoteowner');
    const member = await verifiedUser('promotee');
    await onboard(owner, 'Promotions');
    await inviteAndAccept(owner, member, 'member');

    const headers = await owner.api.csrfHeaders();

    expect(
      (
        await owner.api.request(
          'PATCH',
          `/api/v1/members/${member.userId}/role`,
          { role: 'admin' },
          headers,
        )
      ).status,
    ).toBe(200);

    let members = (await owner.api.get('/api/v1/members')).body as { members: MemberSummary[] };
    expect(members.members.find((m) => m.userId === member.userId)?.role).toBe('admin');

    expect(
      (
        await owner.api.request(
          'PATCH',
          `/api/v1/members/${member.userId}/role`,
          { role: 'member' },
          headers,
        )
      ).status,
    ).toBe(200);

    members = (await owner.api.get('/api/v1/members')).body as { members: MemberSummary[] };
    expect(members.members.find((m) => m.userId === member.userId)?.role).toBe('member');
  }, 240_000);

  it('never lets the Owner be removed', async () => {
    const owner = await verifiedUser('unremovable');
    const admin = await verifiedUser('tryingadmin');
    await onboard(owner, 'Owner Safe');
    await inviteAndAccept(owner, admin, 'admin');

    expect(
      (await admin.api.delete(`/api/v1/members/${owner.userId}`, await admin.api.csrfHeaders()))
        .status,
    ).toBe(403);
    // Not even by themselves.
    expect(
      (await owner.api.delete(`/api/v1/members/${owner.userId}`, await owner.api.csrfHeaders()))
        .status,
    ).toBe(403);
  }, 240_000);
});

describe('ownership transfer (blueprint 4.1)', () => {
  it('transfers to a verified Admin and steps the old Owner down to Admin', async () => {
    const owner = await verifiedUser('transferowner');
    const admin = await verifiedUser('successor');
    await onboard(owner, 'Succession');
    await inviteAndAccept(owner, admin, 'admin');

    const transferred = await owner.api.post(
      '/api/v1/workspaces/transfer-ownership',
      { toUserId: admin.userId },
      await owner.api.csrfHeaders(),
    );
    expect(transferred.status).toBe(200);

    const members = (await admin.api.get('/api/v1/members')).body as { members: MemberSummary[] };
    expect(members.members.find((m) => m.userId === admin.userId)?.role).toBe('owner');
    // The outgoing Owner becomes an Admin, not a Member.
    expect(members.members.find((m) => m.userId === owner.userId)?.role).toBe('admin');

    // The workspace record itself points at the new owner.
    const workspace = await harness.db
      .collection(COLLECTIONS.workspaces)
      .findOne({ name: 'Succession' });
    expect(String(workspace?.['ownerUserId'])).toBe(admin.userId);

    // Exactly one active owner membership, so the unique index still holds.
    const owners = await harness.db
      .collection(COLLECTIONS.memberships)
      .countDocuments({ workspaceId: workspace?.['_id'], role: 'owner' });
    expect(owners).toBe(1);

    // And the powers really moved.
    expect(
      (await owner.api.delete('/api/v1/workspaces/current', await owner.api.csrfHeaders())).status,
    ).toBe(403);
    expect((await admin.api.get('/api/v1/workspaces/audit')).status).toBe(200);
  }, 300_000);

  it('refuses transfer to a Member, to a non-member, and to an unverified Admin', async () => {
    const owner = await verifiedUser('pickyowner');
    const member = await verifiedUser('justamember');
    const stranger = await verifiedUser('outsider');
    await onboard(owner, 'Picky');
    await inviteAndAccept(owner, member, 'member');

    const headers = await owner.api.csrfHeaders();

    // A Member is not eligible.
    const toMember = await owner.api.post(
      '/api/v1/workspaces/transfer-ownership',
      { toUserId: member.userId },
      headers,
    );
    expect(toMember.status).toBe(409);

    // Somebody outside the workspace is not eligible either.
    const toStranger = await owner.api.post(
      '/api/v1/workspaces/transfer-ownership',
      { toUserId: stranger.userId },
      headers,
    );
    expect(toStranger.status).toBe(404);
  }, 300_000);

  it('refuses transfer to an Admin who already owns another workspace', async () => {
    const owner = await verifiedUser('ownera');
    const otherOwner = await verifiedUser('ownerb');
    await onboard(owner, 'Workspace A');
    await onboard(otherOwner, 'Workspace B');
    await inviteAndAccept(owner, otherOwner, 'admin');

    // otherOwner is an Admin in A but already owns B, so accepting would break
    // the one-owned-workspace rule.
    const attempt = await owner.api.post(
      '/api/v1/workspaces/transfer-ownership',
      { toUserId: otherOwner.userId },
      await owner.api.csrfHeaders(),
    );
    expect(attempt.status).toBe(409);
  }, 300_000);
});

describe('workspace deletion and recovery (blueprint 9.5)', () => {
  it('soft-deletes, makes the workspace unusable, then recovers it', async () => {
    const owner = await verifiedUser('deleter');
    const workspaceId = await onboard(owner, 'Disposable');

    expect(
      (await owner.api.delete('/api/v1/workspaces/current', await owner.api.csrfHeaders())).status,
    ).toBe(200);

    // Nothing is purged, but the workspace is unusable and gone from the list.
    const stored = await harness.db
      .collection(COLLECTIONS.workspaces)
      .findOne({ name: 'Disposable' });
    expect(stored?.['status']).toBe('deleted');
    expect(stored?.['deletedAt']).toBeInstanceOf(Date);
    expect(stored?.['purgeAfter']).toBeInstanceOf(Date);

    expect((await owner.api.get('/api/v1/workspaces/current')).status).toBe(404);
    const list = await owner.api.get('/api/v1/workspaces');
    expect((list.body as { workspaces: WorkspaceSummary[] }).workspaces).toHaveLength(0);

    // Recover it.
    const recovered = await owner.api.post(
      `/api/v1/workspaces/${workspaceId}/recover`,
      undefined,
      await owner.api.csrfHeaders(),
    );
    expect(recovered.status).toBe(200);

    await owner.api.post(
      '/api/v1/workspaces/switch',
      { workspaceId },
      await owner.api.csrfHeaders(),
    );
    expect((await owner.api.get('/api/v1/workspaces/current')).status).toBe(200);
  }, 240_000);

  it('refuses recovery once the 30-day window has passed', async () => {
    const owner = await verifiedUser('expiredrecovery');
    const workspaceId = await onboard(owner, 'Too Late');
    await owner.api.delete('/api/v1/workspaces/current', await owner.api.csrfHeaders());

    // Move the deadline into the past rather than waiting 30 days.
    await harness.db
      .collection(COLLECTIONS.workspaces)
      .updateOne(
        { name: 'Too Late' },
        { $set: { purgeAfter: new Date(harness.clock.now().getTime() - 1000) } },
      );

    const attempt = await owner.api.post(
      `/api/v1/workspaces/${workspaceId}/recover`,
      undefined,
      await owner.api.csrfHeaders(),
    );
    expect(attempt.status).toBe(409);
  }, 240_000);

  it('lets nobody but the Owner recover, and does not reveal the workspace exists', async () => {
    const owner = await verifiedUser('recoverowner');
    const admin = await verifiedUser('recoveradmin');
    const workspaceId = await onboard(owner, 'Owner Only Recovery');
    await inviteAndAccept(owner, admin, 'admin');
    await owner.api.delete('/api/v1/workspaces/current', await owner.api.csrfHeaders());

    const byAdmin = await admin.api.post(
      `/api/v1/workspaces/${workspaceId}/recover`,
      undefined,
      await admin.api.csrfHeaders(),
    );
    expect(byAdmin.status).toBe(404);
  }, 300_000);
});

describe('account deletion precondition (blueprint 4.1)', () => {
  it('blocks while the user owns a workspace, and clears once they transfer it', async () => {
    const owner = await verifiedUser('accountdel');
    const successor = await verifiedUser('accountsuccessor');
    await onboard(owner, 'Blocking Workspace');
    await inviteAndAccept(owner, successor, 'admin');

    let eligibility = await owner.api.get('/api/v1/workspaces/account-deletion-eligibility');
    expect((eligibility.body as { canDelete: boolean }).canDelete).toBe(false);
    expect((eligibility.body as { reason: string }).reason).toMatch(/transfer or delete/i);

    await owner.api.post(
      '/api/v1/workspaces/transfer-ownership',
      { toUserId: successor.userId },
      await owner.api.csrfHeaders(),
    );

    eligibility = await owner.api.get('/api/v1/workspaces/account-deletion-eligibility');
    expect((eligibility.body as { canDelete: boolean }).canDelete).toBe(true);
  }, 300_000);
});

describe('usage meters (blueprint 4.10)', () => {
  it('counts users and widgets for real, and reports unbuilt meters as null, not zero', async () => {
    const owner = await verifiedUser('usageowner');
    const member = await verifiedUser('usagemember');
    await onboard(owner, 'Usage');
    await inviteAndAccept(owner, member, 'member');

    const usage = (await owner.api.get('/api/v1/workspaces/usage')).body as WorkspaceUsage;

    expect(usage.users.used).toBe(2);
    expect(usage.users.limit).toBe(10);

    // Stage 5a made this meter real: an honest zero, because widgets now
    // exist as a feature and this workspace has none.
    expect(usage.activeWidgets.used).toBe(0);
    expect(usage.activeWidgets.limit).toBe(10);

    // Submissions are still genuinely unmeasured, and null says so. Fabricating
    // a zero would assert "none have arrived yet", which is a different claim
    // from "this is not counted yet" (Stage 7).
    expect(usage.submissionsThisMonth.used).toBeNull();
    expect(usage.interactionEventsThisMonth.used).toBeNull();
    expect(usage.submissionsThisMonth.limit).toBe(2000);
  }, 240_000);
});

describe('workspace-scoped audit (blueprint 9.3)', () => {
  it('records every action against the REAL workspace id, not the sentinel', async () => {
    const owner = await verifiedUser('auditowner');
    const member = await verifiedUser('auditmember');
    const workspaceId = await onboard(owner, 'Audited');
    await inviteAndAccept(owner, member, 'member');

    const audit = await owner.api.get('/api/v1/workspaces/audit');
    expect(audit.status).toBe(200);
    const types = (audit.body as { events: { type: string }[] }).events.map((e) => e.type);

    expect(types).toContain('workspace.created');
    expect(types).toContain('invitation.sent');
    expect(types).toContain('invitation.accepted');

    // Every one carries the real workspace id. The account-level sentinel from
    // Stage 3a is all zeroes and must not appear on these.
    const stored = await harness.db
      .collection(COLLECTIONS.auditEvents)
      .find({ type: { $in: ['workspace.created', 'invitation.sent', 'invitation.accepted'] } })
      .toArray();

    expect(stored.length).toBeGreaterThan(0);
    for (const event of stored) {
      expect(String(event['workspaceId'])).not.toBe('000000000000000000000000');
    }
    expect(stored.some((event) => String(event['workspaceId']) === workspaceId)).toBe(true);
  }, 240_000);

  it('never records a token in audit metadata', async () => {
    const owner = await verifiedUser('auditsafe');
    const invitee = await verifiedUser('auditsafeinvitee');
    await onboard(owner, 'Audit Safety');

    await owner.api.post(
      '/api/v1/invitations',
      { email: invitee.email, role: 'member' },
      await owner.api.csrfHeaders(),
    );
    const message = await waitForEmail(invitee.email, (m) => m.Subject.includes('Join'));
    const token = extractToken(await mailpitBody(message.ID));

    const events = await harness.db.collection(COLLECTIONS.auditEvents).find({}).toArray();
    const serialised = JSON.stringify(events);

    expect(serialised).not.toContain(token);
    expect(JSON.stringify(harness.logs)).not.toContain(token);
  }, 240_000);
});

describe('what the UI is told it may do (Stage 4b)', () => {
  it('reports the capability list the section 11 matrix grants, per role', async () => {
    const owner = await verifiedUser('cap-owner');
    await onboard(owner, 'Capability Co');
    const member = await verifiedUser('cap-member');
    await inviteAndAccept(owner, member, 'member');

    const asOwner = await owner.api.get('/api/v1/workspaces/current');
    const ownerCaps = (asOwner.body as { capabilities: string[] }).capabilities;

    // Switch the member into the same workspace to read their view of it.
    const asMember = await member.api.get('/api/v1/workspaces/current');
    const memberCaps = (asMember.body as { capabilities: string[] }).capabilities;

    // The Owner-only rows.
    for (const capability of ['admin.manage', 'workspace.transfer', 'workspace.delete']) {
      expect(ownerCaps).toContain(capability);
      expect(memberCaps).not.toContain(capability);
    }

    // Owner and Admin, but not Member.
    expect(ownerCaps).toContain('audit.view');
    expect(memberCaps).not.toContain('audit.view');
    expect(ownerCaps).toContain('member.manage');
    expect(memberCaps).not.toContain('member.manage');

    // Everyone can see the workspace they belong to.
    expect(memberCaps).toContain('workspace.view');
  });

  it('withholds member.manage from an unverified Owner, who may still look around', async () => {
    // Blueprint 4.1: "Dashboard is available, but publishing and invitations
    // are blocked." The UI needs both halves of that to be true.
    const owner = await unverifiedUser('cap-unverified');
    await onboard(owner, 'Unconfirmed Co');

    const response = await owner.api.get('/api/v1/workspaces/current');
    const capabilities = (response.body as { capabilities: string[] }).capabilities;

    expect(capabilities).toContain('workspace.view');
    expect(capabilities).not.toContain('member.manage');
  });

  it('tells each caller which members they may re-role or remove', async () => {
    const owner = await verifiedUser('perm-owner');
    await onboard(owner, 'Permissions Co');
    const admin = await verifiedUser('perm-admin');
    const member = await verifiedUser('perm-member');
    await inviteAndAccept(owner, admin, 'admin');
    await inviteAndAccept(owner, member, 'member');

    const byEmail = async (actor: Actor): Promise<Map<string, MemberSummary>> => {
      const response = await actor.api.get('/api/v1/members');
      expect(response.status).toBe(200);
      const members = (response.body as { members: MemberSummary[] }).members;
      return new Map(members.map((entry) => [entry.email, entry]));
    };

    const ownerView = await byEmail(owner);
    const adminView = await byEmail(admin);

    // The Owner may demote and remove the Admin.
    expect(ownerView.get(admin.email)?.assignableRoles).toContain('member');
    expect(ownerView.get(admin.email)?.canRemove).toBe(true);
    // ...and promote or remove the Member.
    expect(ownerView.get(member.email)?.assignableRoles).toContain('admin');
    expect(ownerView.get(member.email)?.canRemove).toBe(true);
    // Nobody may act on the Owner, including the Owner.
    expect(ownerView.get(owner.email)?.assignableRoles).toEqual([]);
    expect(ownerView.get(owner.email)?.canRemove).toBe(false);

    // An Admin may remove a Member but never promote one to Admin.
    expect(adminView.get(member.email)?.canRemove).toBe(true);
    expect(adminView.get(member.email)?.assignableRoles).not.toContain('admin');
    // ...and may not touch the Owner or themselves.
    expect(adminView.get(owner.email)?.canRemove).toBe(false);
    expect(adminView.get(admin.email)?.canRemove).toBe(false);
    expect(adminView.get(admin.email)?.assignableRoles).toEqual([]);
  });

  it('lets an owner find the workspace they deleted, and nobody else find it', async () => {
    const owner = await verifiedUser('recover-list');
    await onboard(owner, 'Findable Again');
    const stranger = await verifiedUser('recover-stranger');
    await onboard(stranger, 'Unrelated Co');

    expect(
      (await owner.api.delete('/api/v1/workspaces/current', await owner.api.csrfHeaders())).status,
    ).toBe(200);

    const mine = await owner.api.get('/api/v1/workspaces/recoverable');
    expect(mine.status).toBe(200);
    const recoverable = (mine.body as { workspaces: { name: string; purgeAfter: string }[] })
      .workspaces;
    expect(recoverable).toHaveLength(1);
    expect(recoverable[0]?.name).toBe('Findable Again');
    expect(new Date(recoverable[0]?.purgeAfter ?? 0).getTime()).toBeGreaterThan(Date.now());

    // A different user's deleted workspace is not theirs to see.
    const theirs = await stranger.api.get('/api/v1/workspaces/recoverable');
    expect((theirs.body as { workspaces: unknown[] }).workspaces).toHaveLength(0);
  });
});

describe('cross-tenant isolation across the new write paths', () => {
  it('keeps memberships, invitations, and audit events inside their own workspace', async () => {
    const alice = await verifiedUser('tenanta');
    const bob = await verifiedUser('tenantb');
    const aliceGuest = await verifiedUser('aliceguest');
    const bobGuest = await verifiedUser('bobguest');

    const aliceWorkspace = await onboard(alice, 'Tenant A');
    const bobWorkspace = await onboard(bob, 'Tenant B');
    await inviteAndAccept(alice, aliceGuest, 'member');
    await inviteAndAccept(bob, bobGuest, 'member');

    // Each owner sees only their own members.
    const aliceMembers = (await alice.api.get('/api/v1/members')).body as {
      members: MemberSummary[];
    };
    const bobMembers = (await bob.api.get('/api/v1/members')).body as { members: MemberSummary[] };

    expect(aliceMembers.members.map((m) => m.email).sort()).toEqual(
      [alice.email, aliceGuest.email].sort(),
    );
    expect(bobMembers.members.map((m) => m.email).sort()).toEqual(
      [bob.email, bobGuest.email].sort(),
    );

    // Alice cannot act on Bob's member, even naming their real user id.
    const cross = await alice.api.delete(
      `/api/v1/members/${bobGuest.userId}`,
      await alice.api.csrfHeaders(),
    );
    expect(cross.status).toBe(404);

    // Bob's guest is untouched.
    const bobAfter = (await bob.api.get('/api/v1/members')).body as { members: MemberSummary[] };
    expect(bobAfter.members).toHaveLength(2);

    // Audit logs do not bleed across.
    const aliceAudit = (await alice.api.get('/api/v1/workspaces/audit')).body as {
      events: { id: string }[];
    };
    const bobAudit = (await bob.api.get('/api/v1/workspaces/audit')).body as {
      events: { id: string }[];
    };
    const aliceIds = new Set(aliceAudit.events.map((e) => e.id));
    for (const event of bobAudit.events) {
      expect(aliceIds.has(event.id)).toBe(false);
    }

    // And the stored records carry the right workspace ids.
    for (const [workspaceId, guestEmail] of [
      [aliceWorkspace, aliceGuest.email],
      [bobWorkspace, bobGuest.email],
    ] as const) {
      const invitation = await harness.db
        .collection(COLLECTIONS.invitations)
        .findOne({ normalizedEmail: guestEmail });
      expect(String(invitation?.['workspaceId'])).toBe(workspaceId);
    }
  }, 300_000);
});
