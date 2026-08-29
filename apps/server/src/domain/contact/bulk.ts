import type { Capability, ContactBulkAction } from '@lcp/contracts';
import { CONTACT_BULK_ACTIONS } from '@lcp/contracts';
import { can, type PolicySubject } from '../workspace/capabilities.js';

/**
 * Which bulk actions a caller may take (blueprint 4.7, 11).
 *
 * Blueprint 4.7 states the split directly:
 *
 *   Owner/Admin: status, assign, tag, archive, soft-delete, and export;
 *   Member:      status, assign, and tag.
 *
 * That could be written as a second table keyed by role - and it would be wrong
 * to write it that way. Section 11 already decides who may archive and who may
 * soft-delete, and a second table would be a second copy of the policy that can
 * drift from the first. So each action names the capability it needs, and the
 * split falls out of the matrix that is already asserted cell by cell in
 * `tests/rbac.test.ts`.
 *
 * Reading the mapping back against 4.7 shows the two lists agree:
 *
 *   status / assign / tag / untag -> contact.workflow.write -> all three roles
 *   archive                       -> contact.workflow.write -> all three roles
 *   delete                        -> contact.delete         -> Owner/Admin
 *
 * Archive is the interesting one. Blueprint 4.7 lists "archive" only under
 * Owner/Admin, but 4.6 is explicit that "Archiving is a workflow state.
 * Deletion is a separate soft-delete operation", and section 11 grants
 * "Change status/assignee/tags/notes" to every role. Archived IS one of the
 * five statuses, so a Member who may set "Qualified" may set "Archived" by the
 * same row of the matrix; 4.7's list is about the bulk toolbar's grouping, not
 * a narrower rule for one status. The genuinely Owner/Admin-only destructive
 * action - soft-delete - stays Owner/Admin here.
 */
const ACTION_CAPABILITY: Readonly<Record<ContactBulkAction, Capability>> = {
  status: 'contact.workflow.write',
  assign: 'contact.workflow.write',
  tag: 'contact.workflow.write',
  untag: 'contact.workflow.write',
  archive: 'contact.workflow.write',
  delete: 'contact.delete',
};

export function capabilityForBulkAction(action: ContactBulkAction): Capability {
  const capability = ACTION_CAPABILITY[action];
  if (capability === undefined) {
    // Unreachable: the table is keyed by the closed action union. Throwing
    // rather than defaulting, for the same reason `decisionFor` does - an
    // authorization lookup must never quietly answer for a key it does not
    // know.
    throw new Error(`No capability defined for bulk action "${String(action)}"`);
  }
  return capability;
}

export function canPerformBulkAction(subject: PolicySubject, action: ContactBulkAction): boolean {
  return can(subject, capabilityForBulkAction(action));
}

/**
 * The actions this caller may take, derived rather than declared.
 *
 * The server sends this to the UI so Stage 8b renders its toolbar from one
 * source of truth instead of reimplementing the role split in the browser -
 * the same pattern the workspace and widget surfaces already use.
 */
export function allowedBulkActions(subject: PolicySubject): readonly ContactBulkAction[] {
  return CONTACT_BULK_ACTIONS.filter((action) => canPerformBulkAction(subject, action));
}
