import { ObjectId, type Db } from 'mongodb';
import { AuditEventRepository as WorkspaceAuditRepository, workspaceScope } from '@lcp/database';
import type { AccountAuditEvent, AuditEventRepository } from './types.js';

/**
 * Account-level audit events.
 *
 * `AuditEvent` is a workspace-owned record and the Stage 2 repository correctly
 * refuses to write without a workspace scope. Authentication, however, happens
 * before any workspace is selected, and a user may belong to many.
 *
 * Rather than weaken the tenancy invariant with an unscoped write path, these
 * events are written against a fixed all-zero sentinel workspace id. No real
 * workspace can ever have that id, so an account event cannot appear in a
 * tenant's audit view, and the invariant proven in Stage 2 stays intact.
 *
 * Stage 4 adds genuinely workspace-scoped audit for membership changes and uses
 * the underlying repository directly.
 */
export const ACCOUNT_SCOPE_WORKSPACE_ID = new ObjectId('000000000000000000000000');

export class AccountAuditRepository implements AuditEventRepository {
  readonly #inner: WorkspaceAuditRepository;

  constructor(db: Db) {
    this.#inner = new WorkspaceAuditRepository(db);
  }

  async insertAccountEvent(event: AccountAuditEvent): Promise<void> {
    await this.#inner.insert(workspaceScope(ACCOUNT_SCOPE_WORKSPACE_ID), {
      type: event.type,
      actorUserId: event.actorUserId,
      correlationId: event.correlationId,
      occurredAt: event.occurredAt,
      metadata: event.metadata,
    });
  }
}
