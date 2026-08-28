import type { Db, ObjectId } from 'mongodb';
import {
  AuditEventRepository,
  InvitationRepository,
  MembershipRepository,
  OutboxRepository,
  UserRepository,
  WorkspaceRepository,
  workspaceScope,
  DEFAULT_RETENTION_DAYS,
  type WorkspaceScope,
} from '@lcp/database';

/**
 * Two-tenant fixture.
 *
 * Blueprint section 9.1 requires cross-tenant tests for every surface, so the
 * fixture always seeds TWO complete tenants with equivalent records. A test
 * then asserts that tenant A, using its own scope, cannot see or touch any of
 * tenant B, and vice versa - checking both directions catches an isolation bug
 * that only leaks one way.
 */

export interface SeededTenant {
  readonly workspaceId: ObjectId;
  readonly scope: WorkspaceScope;
  readonly ownerUserId: ObjectId;
  readonly memberUserId: ObjectId;
  readonly membershipId: ObjectId;
  readonly invitationId: ObjectId;
  readonly auditEventId: ObjectId;
  readonly outboxEventId: ObjectId;
}

export interface TwoTenantFixture {
  readonly tenantA: SeededTenant;
  readonly tenantB: SeededTenant;
  readonly repositories: {
    readonly users: UserRepository;
    readonly workspaces: WorkspaceRepository;
    readonly memberships: MembershipRepository;
    readonly invitations: InvitationRepository;
    readonly auditEvents: AuditEventRepository;
    readonly outbox: OutboxRepository;
  };
}

/** Deterministic non-secret stand-in for a hashed invitation token. */
function fakeTokenHash(label: string): string {
  return `sha256-test-${label}`;
}

async function seedTenant(db: Db, label: string): Promise<SeededTenant> {
  const now = new Date();
  const users = new UserRepository(db);
  const workspaces = new WorkspaceRepository(db);

  const owner = await users.insert({
    email: `owner-${label}@example.invalid`,
    normalizedEmail: `owner-${label}@example.invalid`,
    emailVerifiedAt: now,
    status: 'active',
    deletedAt: null,
    purgeAfter: null,
    passwordHash: null,
    passwordUpdatedAt: null,
    emailVerification: null,
    passwordReset: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const member = await users.insert({
    email: `member-${label}@example.invalid`,
    normalizedEmail: `member-${label}@example.invalid`,
    emailVerifiedAt: now,
    status: 'active',
    deletedAt: null,
    purgeAfter: null,
    passwordHash: null,
    passwordUpdatedAt: null,
    emailVerification: null,
    passwordReset: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const workspace = await workspaces.insert({
    name: `Workspace ${label}`,
    ownerUserId: owner._id,
    timezone: 'Europe/Berlin',
    retentionDays: DEFAULT_RETENTION_DAYS,
    status: 'active',
    deletedAt: null,
    purgeAfter: null,
    createdAt: now,
    updatedAt: now,
  });

  const scope = workspaceScope(workspace._id);

  const membership = await new MembershipRepository(db).insert(scope, {
    userId: member._id,
    role: 'member',
    createdAt: now,
    updatedAt: now,
  });

  const invitation = await new InvitationRepository(db).insert(scope, {
    email: `invitee-${label}@example.invalid`,
    normalizedEmail: `invitee-${label}@example.invalid`,
    role: 'member',
    invitedByUserId: owner._id,
    tokenHash: fakeTokenHash(label),
    status: 'pending',
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    acceptedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const auditEvent = await new AuditEventRepository(db).insert(scope, {
    type: 'workspace.created',
    actorUserId: owner._id,
    correlationId: `corr-${label}`,
    occurredAt: now,
    metadata: { label },
  });

  const outboxEvent = await new OutboxRepository(db).insert(scope, {
    type: 'invitation.send',
    payload: { invitationId: invitation._id.toHexString() },
    status: 'pending',
    attempts: 0,
    nextAttemptAt: now,
    idempotencyKey: `invitation-send-${label}`,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });

  return {
    workspaceId: workspace._id,
    scope,
    ownerUserId: owner._id,
    memberUserId: member._id,
    membershipId: membership._id,
    invitationId: invitation._id,
    auditEventId: auditEvent._id,
    outboxEventId: outboxEvent._id,
  };
}

export async function seedTwoTenants(db: Db): Promise<TwoTenantFixture> {
  const tenantA = await seedTenant(db, 'a');
  const tenantB = await seedTenant(db, 'b');

  return {
    tenantA,
    tenantB,
    repositories: {
      users: new UserRepository(db),
      workspaces: new WorkspaceRepository(db),
      memberships: new MembershipRepository(db),
      invitations: new InvitationRepository(db),
      auditEvents: new AuditEventRepository(db),
      outbox: new OutboxRepository(db),
    },
  };
}
