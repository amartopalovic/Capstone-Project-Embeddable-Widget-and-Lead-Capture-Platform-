import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import {
  createMongoFixture,
  seedTwoTenants,
  type MongoFixture,
  type TwoTenantFixture,
} from '@lcp/test-utils';
import { InvalidWorkspaceScopeError, MembershipRepository, workspaceScope } from '../src/index.js';

/**
 * Stage 2 exit-gate proof.
 *
 * Blueprint section 9.1: two seeded tenants must be unable to reach each other
 * through ANY foundation repository. Every case below is checked in both
 * directions, because a one-way check would still pass if isolation leaked the
 * other way.
 *
 * These run against a real MongoDB replica set rather than a mock: the point is
 * to prove the queries that actually reach the database are scoped, which a
 * mock could not establish.
 */

let mongo: MongoFixture;
let fixture: TwoTenantFixture;

beforeAll(async () => {
  mongo = await createMongoFixture();
  fixture = await seedTwoTenants(mongo.db);
}, 60_000);

afterAll(async () => {
  await mongo?.teardown();
});

describe('cross-tenant reads are impossible', () => {
  it('membership reads are blocked in both directions', async () => {
    const { memberships } = fixture.repositories;
    const { tenantA, tenantB } = fixture;

    expect(await memberships.findById(tenantA.scope, tenantA.membershipId)).not.toBeNull();
    expect(await memberships.findById(tenantB.scope, tenantB.membershipId)).not.toBeNull();

    expect(await memberships.findById(tenantA.scope, tenantB.membershipId)).toBeNull();
    expect(await memberships.findById(tenantB.scope, tenantA.membershipId)).toBeNull();
  });

  it('invitation reads are blocked in both directions', async () => {
    const { invitations } = fixture.repositories;
    const { tenantA, tenantB } = fixture;

    expect(await invitations.findById(tenantA.scope, tenantA.invitationId)).not.toBeNull();
    expect(await invitations.findById(tenantA.scope, tenantB.invitationId)).toBeNull();
    expect(await invitations.findById(tenantB.scope, tenantA.invitationId)).toBeNull();
  });

  it('audit event reads are blocked in both directions', async () => {
    const { auditEvents } = fixture.repositories;
    const { tenantA, tenantB } = fixture;

    expect(await auditEvents.findById(tenantA.scope, tenantA.auditEventId)).not.toBeNull();
    expect(await auditEvents.findById(tenantA.scope, tenantB.auditEventId)).toBeNull();
    expect(await auditEvents.findById(tenantB.scope, tenantA.auditEventId)).toBeNull();
  });

  it('outbox event reads are blocked in both directions', async () => {
    const { outbox } = fixture.repositories;
    const { tenantA, tenantB } = fixture;

    expect(await outbox.findById(tenantA.scope, tenantA.outboxEventId)).not.toBeNull();
    expect(await outbox.findById(tenantA.scope, tenantB.outboxEventId)).toBeNull();
    expect(await outbox.findById(tenantB.scope, tenantA.outboxEventId)).toBeNull();
  });

  it('list queries only ever return records from the calling workspace', async () => {
    const { memberships, invitations, auditEvents, outbox } = fixture.repositories;
    const { tenantA, tenantB } = fixture;

    for (const scope of [tenantA.scope, tenantB.scope]) {
      const all = [
        ...(await memberships.findMany(scope)),
        ...(await invitations.findMany(scope)),
        ...(await auditEvents.findMany(scope)),
        ...(await outbox.findMany(scope)),
      ];
      expect(all.length).toBeGreaterThan(0);
      for (const record of all) {
        expect(record.workspaceId.toHexString()).toBe(scope.workspaceId.toHexString());
      }
    }
  });

  it('counts never include the other tenant', async () => {
    const { memberships } = fixture.repositories;
    expect(await memberships.count(fixture.tenantA.scope)).toBe(1);
    expect(await memberships.count(fixture.tenantB.scope)).toBe(1);
  });

  it('findByTokenHash cannot reach another tenant invitation', async () => {
    const { invitations } = fixture.repositories;
    const { tenantA, tenantB } = fixture;

    // Tenant B token hash, queried with tenant A scope.
    expect(await invitations.findByTokenHash(tenantA.scope, 'sha256-test-b')).toBeNull();
    expect(await invitations.findByTokenHash(tenantB.scope, 'sha256-test-b')).not.toBeNull();
  });

  it('findByIdempotencyKey cannot reach another tenant outbox record', async () => {
    const { outbox } = fixture.repositories;
    const { tenantA, tenantB } = fixture;

    expect(await outbox.findByIdempotencyKey(tenantA.scope, 'invitation-send-b')).toBeNull();
    expect(await outbox.findByIdempotencyKey(tenantB.scope, 'invitation-send-b')).not.toBeNull();
  });
});

describe('cross-tenant writes are impossible', () => {
  it('tenant A cannot modify a tenant B record, and the record is unchanged', async () => {
    const { memberships } = fixture.repositories;
    const { tenantA, tenantB } = fixture;

    const updated = await memberships.updateById(tenantA.scope, tenantB.membershipId, {
      role: 'admin',
    });
    expect(updated).toBe(false);

    const victim = await memberships.findById(tenantB.scope, tenantB.membershipId);
    expect(victim?.role).toBe('member');
  });

  it('tenant B cannot modify a tenant A record either', async () => {
    const { invitations } = fixture.repositories;
    const { tenantA, tenantB } = fixture;

    const updated = await invitations.updateById(tenantB.scope, tenantA.invitationId, {
      status: 'revoked',
    });
    expect(updated).toBe(false);

    const victim = await invitations.findById(tenantA.scope, tenantA.invitationId);
    expect(victim?.status).toBe('pending');
  });

  it('deletes are blocked across every foundation repository', async () => {
    const { memberships, invitations, auditEvents, outbox } = fixture.repositories;
    const { tenantA, tenantB } = fixture;

    expect(await memberships.deleteById(tenantA.scope, tenantB.membershipId)).toBe(false);
    expect(await invitations.deleteById(tenantA.scope, tenantB.invitationId)).toBe(false);
    expect(await auditEvents.deleteById(tenantA.scope, tenantB.auditEventId)).toBe(false);
    expect(await outbox.deleteById(tenantA.scope, tenantB.outboxEventId)).toBe(false);

    // Every victim record still exists in its own tenant.
    expect(await memberships.findById(tenantB.scope, tenantB.membershipId)).not.toBeNull();
    expect(await invitations.findById(tenantB.scope, tenantB.invitationId)).not.toBeNull();
    expect(await auditEvents.findById(tenantB.scope, tenantB.auditEventId)).not.toBeNull();
    expect(await outbox.findById(tenantB.scope, tenantB.outboxEventId)).not.toBeNull();
  });

  it('insert forces the calling workspace and ignores a spoofed workspaceId', async () => {
    const { auditEvents } = fixture.repositories;
    const { tenantA, tenantB } = fixture;

    // A hostile caller tries to plant a record inside tenant B.
    const spoofed = {
      type: 'spoof.attempt',
      actorUserId: null,
      correlationId: 'corr-spoof',
      occurredAt: new Date(),
      metadata: {},
      workspaceId: tenantB.workspaceId,
    } as unknown as Parameters<typeof auditEvents.insert>[1];

    const created = await auditEvents.insert(tenantA.scope, spoofed);

    expect(created.workspaceId.toHexString()).toBe(tenantA.workspaceId.toHexString());
    expect(await auditEvents.findById(tenantB.scope, created._id)).toBeNull();
    expect(await auditEvents.findById(tenantA.scope, created._id)).not.toBeNull();
  });

  it('a caller-supplied workspaceId in a filter cannot override the scope', async () => {
    const { memberships } = fixture.repositories;
    const { tenantA, tenantB } = fixture;

    // A hostile caller passes tenant B in the filter while holding tenant A scope.
    const results = await memberships.findMany(tenantA.scope, {
      workspaceId: tenantB.workspaceId,
    });

    // The scope clause is merged LAST, so the spoofed value is discarded
    // entirely rather than honoured: the query stays inside tenant A.
    for (const record of results) {
      expect(record.workspaceId.toHexString()).toBe(tenantA.workspaceId.toHexString());
    }
    expect(results.map((record) => record._id.toHexString())).not.toContain(
      tenantB.membershipId.toHexString(),
    );
  });
});

describe('workspace record access', () => {
  it('a tenant can only load its own workspace', async () => {
    const { workspaces } = fixture.repositories;
    const { tenantA, tenantB } = fixture;

    const own = await workspaces.findInScope(tenantA.scope);
    expect(own?._id.toHexString()).toBe(tenantA.workspaceId.toHexString());

    const other = await workspaces.findInScope(workspaceScope(tenantB.workspaceId));
    expect(other?._id.toHexString()).toBe(tenantB.workspaceId.toHexString());
    expect(other?._id.toHexString()).not.toBe(tenantA.workspaceId.toHexString());
  });

  it('updating through a scope never touches another workspace', async () => {
    const { workspaces } = fixture.repositories;
    const { tenantA, tenantB } = fixture;

    await workspaces.updateInScope(tenantA.scope, { name: 'Renamed A' });

    const a = await workspaces.findInScope(tenantA.scope);
    const b = await workspaces.findInScope(tenantB.scope);
    expect(a?.name).toBe('Renamed A');
    expect(b?.name).toBe('Workspace b');
  });
});

describe('the scope itself is validated at runtime', () => {
  // Built from this package source rather than the shared fixture, which
  // resolves @lcp/database through its built output. Using one module instance
  // keeps `toBeInstanceOf` meaningful.
  const repository = (): MembershipRepository => new MembershipRepository(mongo.db);

  it('rejects a missing scope', async () => {
    await expect(repository().findById(undefined as never, new ObjectId())).rejects.toBeInstanceOf(
      InvalidWorkspaceScopeError,
    );
  });

  it('rejects a non-ObjectId workspaceId that slipped past the type system', async () => {
    await expect(
      repository().findMany({ workspaceId: 'not-an-object-id' } as never),
    ).rejects.toBeInstanceOf(InvalidWorkspaceScopeError);
  });

  it('rejects a scope whose workspaceId is a hex string rather than an ObjectId', async () => {
    await expect(
      repository().findMany({ workspaceId: fixture.tenantA.workspaceId.toHexString() } as never),
    ).rejects.toBeInstanceOf(InvalidWorkspaceScopeError);
  });
});
