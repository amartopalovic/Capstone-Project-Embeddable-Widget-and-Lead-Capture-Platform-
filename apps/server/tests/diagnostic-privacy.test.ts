import { afterEach, describe, expect, it, vi } from 'vitest';
import { RedisConnection } from '../src/infrastructure/redis/connection.js';
import { loadEnv } from '../src/config/env.js';

afterEach(() => vi.unstubAllEnvs());

describe('out-of-band diagnostic privacy', () => {
  it.each(['PORT', 'MAILPIT_SMTP_PORT', 'EMAIL_PROVIDER'])(
    'does not echo invalid %s environment values',
    (name) => {
      vi.stubEnv(name, 'AUDIT_PRIVATE_SENTINEL');
      let failure: unknown;
      try {
        loadEnv();
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).not.toContain('AUDIT_PRIVATE_SENTINEL');
    },
  );

  it('handles Redis error events instead of the raw ioredis stderr fallback', async () => {
    const connection = new RedisConnection({ url: 'redis://127.0.0.1:6379', keyPrefix: 'unused' });
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(connection.client.listenerCount('error')).toBeGreaterThan(0);
      connection.client.emit('error', new Error('AUDIT_PRIVATE_SENTINEL'));
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      await connection.close();
      stderr.mockRestore();
    }
  });
});
