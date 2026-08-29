import type { Db, ObjectId, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { ConsentEventRecord } from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import type { WorkspaceScope } from './workspace-scope.js';

/** Append-only consent evidence (blueprint 9.2). */
export class ConsentEventRepository extends WorkspaceScopedRepository<ConsentEventRecord> {
  protected readonly collectionName = COLLECTIONS.consentEvents;

  constructor(db: Db) {
    super(db);
  }

  async listForContact(
    scope: WorkspaceScope,
    contactId: ObjectId,
  ): Promise<WithId<ConsentEventRecord>[]> {
    return this.findMany(scope, { contactId }, { sort: { occurredAt: -1 } });
  }
}
