import type { Db, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { ContactRecord } from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import type { WorkspaceScope } from './workspace-scope.js';

export class ContactRepository extends WorkspaceScopedRepository<ContactRecord> {
  protected readonly collectionName = COLLECTIONS.contacts;

  constructor(db: Db) {
    super(db);
  }

  async findByNormalizedEmail(
    scope: WorkspaceScope,
    normalizedEmail: string,
  ): Promise<WithId<ContactRecord> | null> {
    return this.findOne(scope, { normalizedEmail, recordStatus: 'active' });
  }

  async countActive(scope: WorkspaceScope): Promise<number> {
    return this.count(scope, { recordStatus: 'active' });
  }
}
