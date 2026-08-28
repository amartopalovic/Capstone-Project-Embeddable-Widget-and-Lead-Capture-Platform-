import type { Db, ObjectId, WithId } from 'mongodb';
import { AuditEventRepository, type AuditEventRecord, type WorkspaceScope } from '@lcp/database';
import type { WorkspaceAuditPort } from './types.js';

/**
 * Workspace-scoped audit (blueprint 9.3).
 *
 * This is deliberately NOT the account-level sentinel path from Stage 3a. Those
 * events happen before any workspace is selected, so they are written against
 * an all-zero workspace id. Everything here happens inside a real workspace and
 * uses its real id, so the events appear in that tenant's audit view and in no
 * other - the Stage 2 tenancy invariant applies unchanged.
 */
export class WorkspaceAuditRepository implements WorkspaceAuditPort {
  readonly #inner: AuditEventRepository;

  constructor(db: Db) {
    this.#inner = new AuditEventRepository(db);
  }

  async record(
    scope: WorkspaceScope,
    event: {
      readonly type: string;
      readonly actorUserId: ObjectId | null;
      readonly correlationId: string;
      readonly metadata: Readonly<Record<string, unknown>>;
    },
  ): Promise<void> {
    await this.#inner.insert(scope, {
      type: event.type,
      actorUserId: event.actorUserId,
      correlationId: event.correlationId,
      occurredAt: new Date(),
      metadata: event.metadata,
    });
  }

  async listRecent(scope: WorkspaceScope, limit = 50): Promise<WithId<AuditEventRecord>[]> {
    return this.#inner.listRecent(scope, limit);
  }
}
