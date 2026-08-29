import type { Db, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { AbuseEventRecord } from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import type { WorkspaceScope } from './workspace-scope.js';

/** Minimal abuse evidence, never a shadow lead database (blueprint 7.4). */
export class AbuseEventRepository extends WorkspaceScopedRepository<AbuseEventRecord> {
  protected readonly collectionName = COLLECTIONS.abuseEvents;

  constructor(db: Db) {
    super(db);
  }

  async listRecent(scope: WorkspaceScope, limit = 50): Promise<WithId<AbuseEventRecord>[]> {
    return this.findMany(scope, {}, { sort: { occurredAt: -1 }, limit });
  }
}
