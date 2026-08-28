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

  // --- Stage 3a: authentication --------------------------------------------
  readonly appBaseUrl: string;
  readonly sessionSecret: string;
  readonly sessionCookieName: string;
  readonly sessionIdleTtlSeconds: number;
  readonly sessionAbsoluteTtlSeconds: number;
  readonly emailProvider: 'mailpit' | 'brevo' | 'capture';
  readonly brevoApiKey: string;
  readonly brevoSenderEmail: string;
  readonly brevoSenderName: string;
  readonly mailpitHost: string;
  readonly mailpitPort: number;
  /** Opt-in remote breach check. The offline list always runs regardless. */
  readonly breachCheckRemote: boolean;
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

    appBaseUrl: readString('APP_BASE_URL', 'http://localhost:3000'),
    sessionSecret: readSessionSecret(),
    sessionCookieName: readString('SESSION_COOKIE_NAME', 'lcp.sid'),
    sessionIdleTtlSeconds: readNumber('SESSION_IDLE_TTL_DAYS', 7) * 86_400,
    sessionAbsoluteTtlSeconds: readNumber('SESSION_ABSOLUTE_TTL_DAYS', 30) * 86_400,
    emailProvider: readEmailProvider(),
    brevoApiKey: readString('BREVO_API_KEY', ''),
    brevoSenderEmail: readString('BREVO_SENDER_EMAIL', 'no-reply@example.invalid'),
    brevoSenderName: readString('BREVO_SENDER_NAME', 'Lead Capture Platform'),
    mailpitHost: readString('MAILPIT_SMTP_HOST', 'localhost'),
    mailpitPort: readNumber('MAILPIT_SMTP_PORT', 1025),
    breachCheckRemote: readString('BREACH_CHECK_REMOTE', 'false') === 'true',
  };
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, received: ${raw}`);
  }
  return parsed;
}

function readEmailProvider(): 'mailpit' | 'brevo' | 'capture' {
  const raw = readString('EMAIL_PROVIDER', 'mailpit');
  if (raw === 'mailpit' || raw === 'brevo' || raw === 'capture') return raw;
  throw new Error(`EMAIL_PROVIDER must be mailpit, brevo, or capture, received: ${raw}`);
}

/**
 * The session secret signs CSRF tokens, so a predictable value would let an
 * attacker mint valid ones.
 *
 * Outside development a real value is mandatory and startup fails without it,
 * rather than silently falling back to something guessable. In development a
 * fixed obviously-fake default keeps `docker compose up` credential-free
 * (blueprint section 15.1).
 */
function readSessionSecret(): string {
  const configured = process.env['SESSION_SECRET'];
  const isProduction = readString('NODE_ENV', 'development') === 'production';

  if (configured === undefined || configured === '' || configured.startsWith('replace-me')) {
    if (isProduction) {
      throw new Error('SESSION_SECRET must be set to a real random value in production');
    }
    return 'development-only-insecure-session-secret';
  }
  return configured;
}
