import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { Migration } from './types.js';

/**
 * Stage 3a: credential fields on User.
 *
 * Append-only: this is a NEW migration rather than an edit to 001_foundation,
 * per the rule stated in runner.ts. Existing user documents are backfilled with
 * explicit nulls and zeroes so no field is silently absent.
 *
 * Token hashes are indexed uniquely but PARTIALLY, so the many users with no
 * pending token do not collide on a null value.
 */
export const migration002Auth: Migration = {
  id: '002_auth',
  description: 'Credential, verification, reset, and lockout fields on users',

  async up(db: Db): Promise<void> {
    const users = db.collection(COLLECTIONS.users);

    // Backfill. Each field is set only where it is missing, so a re-run cannot
    // clobber real data - part of what makes the migration safely repeatable.
    await users.updateMany(
      { passwordHash: { $exists: false } },
      {
        $set: {
          passwordHash: null,
          passwordUpdatedAt: null,
          emailVerification: null,
          passwordReset: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: null,
        },
      },
    );

    await users.createIndexes([
      {
        key: { 'emailVerification.tokenHash': 1 },
        name: 'uniq_email_verification_token',
        unique: true,
        partialFilterExpression: { 'emailVerification.tokenHash': { $type: 'string' } },
      },
      {
        key: { 'passwordReset.tokenHash': 1 },
        name: 'uniq_password_reset_token',
        unique: true,
        partialFilterExpression: { 'passwordReset.tokenHash': { $type: 'string' } },
      },
      // Supports the scheduled sweep that clears expired pending tokens.
      { key: { 'emailVerification.expiresAt': 1 }, name: 'email_verification_expiry' },
      { key: { 'passwordReset.expiresAt': 1 }, name: 'password_reset_expiry' },
      { key: { lockedUntil: 1 }, name: 'locked_until' },
    ]);
  },
};
