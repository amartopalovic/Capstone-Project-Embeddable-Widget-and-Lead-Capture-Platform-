import type { Db, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { AuditEventRecord } from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import type { WorkspaceScope } from './workspace-scope.js';

export class AuditEventRepository extends WorkspaceScopedRepository<AuditEventRecord> {
  protected readonly collectionName = COLLECTIONS.auditEvents;

  constructor(db: Db) {
    super(db);
  }

  async listByType(scope: WorkspaceScope, type: string): Promise<WithId<AuditEventRecord>[]> {
    return this.findMany(scope, { type }, { sort: { occurredAt: -1 } });
  }

  async listRecent(scope: WorkspaceScope, limit = 50): Promise<WithId<AuditEventRecord>[]> {
    return this.findMany(scope, {}, { sort: { occurredAt: -1 }, limit });
  }
}
