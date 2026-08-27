/**
 * Environment configuration.
 *
 * Stage 1 reads only what the skeleton genuinely needs. Every value has a local
 * development default so that no developer needs Brevo, Atlas, Upstash, or
 * Render credentials to run the stack (blueprint section 15.1).
 */

function readString(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function readPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Environment variable ${name} must be a valid port number, received: ${raw}`);
  }
  return parsed;
}

export interface ServerEnv {
  readonly nodeEnv: string;
  readonly port: number;
  readonly release: string;
  readonly mongoUri: string;
  readonly mongoDbName: string | undefined;
  readonly redisUrl: string;
  readonly redisKeyPrefix: string;
}

export function loadEnv(): ServerEnv {
  return {
    nodeEnv: readString('NODE_ENV', 'development'),
    port: readPort('PORT', 3000),
    release: readString('RELEASE', 'local-dev'),
    mongoUri: readString(
      'MONGODB_URI',
      'mongodb://localhost:27017/leadcapture?directConnection=true',
    ),
    mongoDbName: process.env['MONGODB_DB_NAME'],
    redisUrl: readString('REDIS_URL', 'redis://localhost:6379'),
    redisKeyPrefix: readString('REDIS_KEY_PREFIX', 'lcp:dev'),
  };
}
