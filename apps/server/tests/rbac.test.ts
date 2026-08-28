import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  type Capability,
  type PolicyDecision,
  type WorkspaceRoleName,
} from '@lcp/contracts';
import {
  blockedOnlyByVerification,
  can,
  canChangeRole,
  canRemoveMember,
  decisionFor,
  isLimited,
} from '../src/domain/workspace/capabilities.js';
import { isValidTimezone, normaliseTimezone } from '../src/domain/workspace/timezone.js';
import {
  isRecoverable,
  purgeDeadline,
  RECOVERY_WINDOW_DAYS,
} from '../src/domain/workspace/retention.js';

/**
 * The blueprint section 11 matrix, transcribed INDEPENDENTLY of the
 * implementation.
 *
 * This table is written straight from the blueprint rather than imported from
 * the policy module, so it is a genuine second reading. If the implementation
 * table were reused here the test would only prove the code equals itself.
 *
 * | Capability | Owner | Admin | Member |
 */
const BLUEPRINT_MATRIX: Record<Capability, [PolicyDecision, PolicyDecision, PolicyDecision]> = {
  // | View workspace dashboard | Yes | Yes | Yes |
  'workspace.view': ['allow', 'allow', 'allow'],
  // | Create/edit widget draft | Yes | Yes | Yes |
  'widget.draft.write': ['allow', 'allow', 'allow'],
  // | Publish/unpublish widget | Yes, verified | Yes, verified | No |
  'widget.publish': ['requires_verified_email', 'requires_verified_email', 'deny'],
  // | Delete/recover widget | Yes | Yes | No |
  'widget.delete': ['allow', 'allow', 'deny'],
  // | View contacts/submissions | Yes | Yes | Yes |
  'contact.view': ['allow', 'allow', 'allow'],
  // | Change status/assignee/tags/notes | Yes | Yes | Yes |
  'contact.workflow.write': ['allow', 'allow', 'allow'],
  // | Edit/merge canonical Contact | Yes | Yes | No |
  'contact.canonical.write': ['allow', 'allow', 'deny'],
  // | Export leads | Yes | Yes | No |
  'contact.export': ['allow', 'allow', 'deny'],
  // | Soft-delete/recover leads | Yes | Yes | No |
  'contact.delete': ['allow', 'allow', 'deny'],
  // | Manage webhook/email settings | Yes | Yes | No |
  'settings.delivery.write': ['allow', 'allow', 'deny'],
  // | View delivery operations | Yes | Yes | Limited per-lead activity only |
  'delivery.view': ['allow', 'allow', 'limited'],
  // | Invite/remove Members | Yes | Yes | No |  (verified, per section 4.1)
  'member.manage': ['requires_verified_email', 'requires_verified_email', 'deny'],
  // | Assign/remove Admin role | Yes | No | No |
  'admin.manage': ['allow', 'deny', 'deny'],
  // | Transfer ownership | Yes | No | No |
  'workspace.transfer': ['allow', 'deny', 'deny'],
  // | Delete/recover workspace | Yes | No | No |
  'workspace.delete': ['allow', 'deny', 'deny'],
  // | View workspace audit log | Yes | Yes | No |
  'audit.view': ['allow', 'allow', 'deny'],
};

const ROLES: readonly WorkspaceRoleName[] = ['owner', 'admin', 'member'];

describe('section 11 authorization matrix', () => {
  it('covers every capability the code declares, with no extras', () => {
    // Guards against a capability being added to one table and not the other.
    expect(Object.keys(BLUEPRINT_MATRIX).sort()).toEqual([...CAPABILITIES].sort());
  });

  it.each(CAPABILITIES)('matches the blueprint for every role: %s', (capability) => {
    const expected = BLUEPRINT_MATRIX[capability];
    ROLES.forEach((role, index) => {
      expect(decisionFor(role, capability), `${capability} / ${role}`).toBe(expected[index]);
    });
  });

  it('resolves every cell for a verified subject', () => {
    for (const capability of CAPABILITIES) {
      const expected = BLUEPRINT_MATRIX[capability];
      ROLES.forEach((role, index) => {
        const decision = expected[index];
        // Verified: anything but an outright deny is permitted.
        const shouldAllow = decision !== 'deny';
        expect(can({ role, emailVerified: true }, capability), `${capability} / ${role}`).toBe(
          shouldAllow,
        );
      });
    }
  });

  it('resolves every cell for an UNVERIFIED subject', () => {
    for (const capability of CAPABILITIES) {
      const expected = BLUEPRINT_MATRIX[capability];
      ROLES.forEach((role, index) => {
        const decision = expected[index];
        // Unverified: the two "Yes, verified" rows now fail closed.
        const shouldAllow = decision === 'allow' || decision === 'limited';
        expect(can({ role, emailVerified: false }, capability), `${capability} / ${role}`).toBe(
          shouldAllow,
        );
      });
    }
  });
});

describe('the specific asymmetries the blueprint calls out', () => {
  it('lets an Admin manage Members but never Admin status', () => {
    const admin = { role: 'admin' as const, emailVerified: true };
    expect(can(admin, 'member.manage')).toBe(true);
    expect(can(admin, 'admin.manage')).toBe(false);
  });

  it('reserves ownership transfer and workspace deletion to the Owner', () => {
    for (const role of ['admin', 'member'] as const) {
      const subject = { role, emailVerified: true };
      expect(can(subject, 'workspace.transfer')).toBe(false);
      expect(can(subject, 'workspace.delete')).toBe(false);
    }
    const owner = { role: 'owner' as const, emailVerified: true };
    expect(can(owner, 'workspace.transfer')).toBe(true);
    expect(can(owner, 'workspace.delete')).toBe(true);
  });

  it('blocks an unverified Owner from inviting and publishing, but not from viewing', () => {
    // Blueprint 4.1: the dashboard stays available; publishing and invitations
    // are what get blocked.
    const unverifiedOwner = { role: 'owner' as const, emailVerified: false };
    expect(can(unverifiedOwner, 'workspace.view')).toBe(true);
    expect(can(unverifiedOwner, 'member.manage')).toBe(false);
    expect(can(unverifiedOwner, 'widget.publish')).toBe(false);
  });

  it('distinguishes "confirm your email" from "your role may never"', () => {
    expect(
      blockedOnlyByVerification({ role: 'owner', emailVerified: false }, 'member.manage'),
    ).toBe(true);
    // A Member is denied outright, not pending verification.
    expect(
      blockedOnlyByVerification({ role: 'member', emailVerified: false }, 'member.manage'),
    ).toBe(false);
    expect(blockedOnlyByVerification({ role: 'owner', emailVerified: true }, 'member.manage')).toBe(
      false,
    );
  });

  it('marks the one Limited cell, and only that one', () => {
    expect(isLimited('member', 'delivery.view')).toBe(true);

    const limitedCells: string[] = [];
    for (const capability of CAPABILITIES) {
      for (const role of ROLES) {
        if (isLimited(role, capability)) limitedCells.push(`${capability}/${role}`);
      }
    }
    expect(limitedCells).toEqual(['delivery.view/member']);
  });

  it('throws rather than guessing for an unknown capability', () => {
    expect(() => decisionFor('owner', 'not.a.capability' as Capability)).toThrow(/No policy/);
  });
});

describe('role changes', () => {
  const owner = { role: 'owner' as const, emailVerified: true, userId: 'owner-1' };
  const admin = { role: 'admin' as const, emailVerified: true, userId: 'admin-1' };
  const member = { role: 'member' as const, emailVerified: true, userId: 'member-1' };

  const targetMember = { userId: 'target-1', role: 'member' as const };
  const targetAdmin = { userId: 'target-2', role: 'admin' as const };
  const targetOwner = { userId: 'target-3', role: 'owner' as const };

  it('lets the Owner promote a Member to Admin and demote an Admin', () => {
    expect(canChangeRole(owner, targetMember, 'admin')).toBe(true);
    expect(canChangeRole(owner, targetAdmin, 'member')).toBe(true);
  });

  it('stops an Admin from creating or removing another Admin', () => {
    expect(canChangeRole(admin, targetMember, 'admin')).toBe(false);
    expect(canChangeRole(admin, targetAdmin, 'member')).toBe(false);
  });

  it('stops a Member from changing anyone', () => {
    expect(canChangeRole(member, targetMember, 'admin')).toBe(false);
    expect(canChangeRole(member, targetAdmin, 'member')).toBe(false);
  });

  it('never changes the Owner role through this path', () => {
    // Ownership moves only by transfer, which keeps the one-owner invariant.
    expect(canChangeRole(owner, targetOwner, 'admin')).toBe(false);
    expect(canChangeRole(owner, targetMember, 'owner')).toBe(false);
  });

  it('stops anyone from changing their own role', () => {
    expect(canChangeRole(admin, { userId: 'admin-1', role: 'admin' }, 'owner')).toBe(false);
    expect(canChangeRole(owner, { userId: 'owner-1', role: 'owner' }, 'admin')).toBe(false);
  });
});

describe('member removal', () => {
  const owner = { role: 'owner' as const, emailVerified: true, userId: 'owner-1' };
  const admin = { role: 'admin' as const, emailVerified: true, userId: 'admin-1' };
  const member = { role: 'member' as const, emailVerified: true, userId: 'member-1' };

  it('lets the Owner remove Admins and Members', () => {
    expect(canRemoveMember(owner, { userId: 'x', role: 'admin' })).toBe(true);
    expect(canRemoveMember(owner, { userId: 'x', role: 'member' })).toBe(true);
  });

  it('lets an Admin remove Members but not other Admins', () => {
    expect(canRemoveMember(admin, { userId: 'x', role: 'member' })).toBe(true);
    expect(canRemoveMember(admin, { userId: 'x', role: 'admin' })).toBe(false);
  });

  it('never removes the Owner, even by the Owner', () => {
    // Otherwise a workspace could be left with nobody who can transfer it.
    expect(canRemoveMember(owner, { userId: 'x', role: 'owner' })).toBe(false);
    expect(canRemoveMember(admin, { userId: 'x', role: 'owner' })).toBe(false);
  });

  it('stops a Member from removing anyone', () => {
    expect(canRemoveMember(member, { userId: 'x', role: 'member' })).toBe(false);
  });

  it('is not the path for leaving voluntarily', () => {
    expect(canRemoveMember(admin, { userId: 'admin-1', role: 'admin' })).toBe(false);
  });

  it('requires a verified email, since removal is part of member.manage', () => {
    const unverifiedOwner = { role: 'owner' as const, emailVerified: false, userId: 'o' };
    expect(canRemoveMember(unverifiedOwner, { userId: 'x', role: 'member' })).toBe(false);
  });
});

describe('IANA timezone validation', () => {
  it('accepts zones the runtime can actually compute with', () => {
    for (const zone of ['Europe/Berlin', 'America/New_York', 'Asia/Tokyo', 'UTC', 'Etc/UTC']) {
      expect(isValidTimezone(zone), zone).toBe(true);
    }
  });

  it('accepts the canonical spelling of a zone that supportedValuesOf omits', () => {
    // The rationale for not using supportedValuesOf: on this runtime the list
    // carries Asia/Calcutta but not Asia/Kolkata, and omits UTC entirely.
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(Intl.supportedValuesOf('timeZone').includes('Asia/Kolkata')).toBe(false);
    expect(Intl.supportedValuesOf('timeZone').includes('UTC')).toBe(false);
  });

  it('rejects junk and empty input', () => {
    for (const zone of ['Nonsense/Zone', '', '   ', 'Europe', '../../etc/passwd']) {
      expect(isValidTimezone(zone), zone).toBe(false);
    }
  });

  it('falls back to UTC rather than guessing', () => {
    expect(normaliseTimezone(undefined)).toBe('UTC');
    expect(normaliseTimezone('Nonsense/Zone')).toBe('UTC');
    expect(normaliseTimezone('Europe/Berlin')).toBe('Europe/Berlin');
  });
});

describe('soft-delete recovery window (blueprint 9.5)', () => {
  it('is 30 days', () => {
    expect(RECOVERY_WINDOW_DAYS).toBe(30);
    const deletedAt = new Date('2026-08-28T00:00:00.000Z');
    expect(purgeDeadline(deletedAt).toISOString()).toBe('2026-09-27T00:00:00.000Z');
  });

  it('is recoverable up to, but not at or past, the deadline', () => {
    const deletedAt = new Date('2026-08-28T00:00:00.000Z');
    const deadline = purgeDeadline(deletedAt);

    expect(isRecoverable(deadline, new Date('2026-09-26T23:59:59.000Z'))).toBe(true);
    expect(isRecoverable(deadline, deadline)).toBe(false);
    expect(isRecoverable(deadline, new Date('2026-09-27T00:00:01.000Z'))).toBe(false);
  });

  it('treats a record that was never deleted as not recoverable', () => {
    expect(isRecoverable(null, new Date())).toBe(false);
  });
});
