import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type { Migration } from './types.js';

/**
 * Stage 3b: TOTP MFA fields on User.
 *
 * Append-only, per the rule in runner.ts. Existing users are backfilled with
 * MFA off and no secret, which is the correct default: blueprint 4.2 makes MFA
 * optional, so nobody is opted in by a migration.
 */
export const migration003Mfa: Migration = {
  id: '003_mfa',
  description: 'Encrypted TOTP secret, enrollment state, and hashed recovery codes on users',

  async up(db: Db): Promise<void> {
    const users = db.collection(COLLECTIONS.users);

    await users.updateMany(
      { mfaEnabled: { $exists: false } },
      {
        $set: {
          totpSecret: null,
          mfaEnabled: false,
          mfaEnabledAt: null,
          lastTotpCounter: null,
          recoveryCodes: [],
        },
      },
    );

    await users.createIndexes([
      // Supports operator reporting on MFA adoption without a collection scan.
      { key: { mfaEnabled: 1 }, name: 'mfa_enabled' },
      // Recovery codes are looked up by hash during a challenge. The index is
      // partial because most users have none.
      {
        key: { 'recoveryCodes.codeHash': 1 },
        name: 'recovery_code_hash',
        partialFilterExpression: { mfaEnabled: true },
      },
    ]);
  },
};
