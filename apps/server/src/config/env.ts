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

  // --- Stage 3b: MFA and secret encryption ---------------------------------
  readonly encryptionMasterKey: string;
  readonly encryptionKeyVersion: number;
  /**
   * Retired encryption keys that must stay readable (blueprint 12.4, 17).
   *
   * Written as `version:base64key`, comma separated. Rotating the master key
   * without these would make every webhook signing secret already in the
   * database permanently undecryptable - the cipher has supported multiple key
   * versions since Stage 3b, but until Stage 13 nothing could configure a
   * second one, which made the whole key-version design unusable in practice
   * and the rotation runbook impossible to actually follow.
   */
  readonly encryptionPreviousKeys: readonly (readonly [number, string])[];
  /** Shown by authenticator apps beside the account name. */
  readonly totpIssuer: string;

  // --- Stage 7: public submission path -------------------------------------

  /**
   * HMAC key material for the rotating IP pseudonym (blueprint 9.4).
   *
   * Separate from the encryption master key on purpose: this one derives a
   * pseudonym that is written into stored events, while that one protects
   * secrets we must be able to read back. Rotating or leaking one should not
   * implicate the other.
   */
  readonly ipHmacSecret: string;
  /** Whether to call the real geo providers. Off outside production. */
  readonly geoEnabled: boolean;
  readonly geoTimeoutMs: number;

  // --- Stage 12b: the public sandbox ---------------------------------------

  /**
   * Where the anonymous demo is served from (blueprint 14.3).
   *
   * A separate origin on purpose - "hosted on a different provider subdomain
   * from the API so it proves the capstone's cross-origin behavior" - so this
   * is the value the seeded widgets put on their allowed-domain list. In
   * development it is the demo dev server; a deployment sets its own subdomain.
   */
  readonly demoOrigin: string;

  // --- Stage 13: error monitoring -------------------------------------------

  /**
   * Sentry DSN (blueprint 16.3). Empty disables error monitoring entirely,
   * which is the normal state locally and in tests.
   *
   * A DSN is not a secret in the way a key is - it is embedded in the browser
   * bundle of every application that uses one, and it only grants the ability
   * to SEND events. It is still read from the environment rather than committed,
   * because it identifies a project.
   */
  readonly sentryDsn: string;
  /** Share of requests traced. Blueprint 16.3 asks for "selected" traces. */
  readonly sentryTracesSampleRate: number;

  // --- Stage 13: operator diagnostics ---------------------------------------

  readonly platformOperatorEmails: readonly string[];
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
    encryptionMasterKey: readEncryptionMasterKey(),
    encryptionKeyVersion: readNumber('ENCRYPTION_KEY_VERSION', 1),
    encryptionPreviousKeys: readVersionedKeys('ENCRYPTION_PREVIOUS_KEYS'),
    totpIssuer: readString('TOTP_ISSUER', 'Lead Capture Platform'),
    ipHmacSecret: readIpHmacSecret(),
    /**
     * Real geo lookups are opt-in, and default ON only in production.
     *
     * ip-api's free endpoint allows 45 requests a minute per source address and
     * excludes commercial use, so a test suite that called it would be both
     * flaky and rude. Blueprint 18.4 wants deterministic provider outcomes
     * anyway.
     */
    geoEnabled: readString('GEO_ENABLED', isProductionEnv() ? 'true' : 'false') === 'true',
    geoTimeoutMs: readNumber('GEO_TIMEOUT_MS', 1500),
    demoOrigin: readString('DEMO_ORIGIN', 'http://localhost:5174'),
    sentryDsn: readString('SENTRY_DSN', ''),
    /**
     * A tenth of traffic by default.
     *
     * Blueprint 5.2 puts this on free tiers with a service that sleeps, and
     * Sentry's own developer plan has a monthly event quota. Tracing every
     * request would spend that quota on a portfolio deployment's idle traffic
     * and leave nothing for the week something actually breaks.
     */
    sentryTracesSampleRate: readNumber('SENTRY_TRACES_SAMPLE_RATE', 0.1),

    /**
     * Who may read the operator diagnostics surface (blueprint 16.4).
     *
     * Email addresses, comma separated, matched against the signed-in user.
     * Deliberately NOT a shared token: a token is new secret material to store,
     * rotate, and leak, and it would authenticate a caller rather than a person.
     * This reuses the session, the verified-email gate, and the audit trail that
     * every other privileged action in the product already goes through.
     *
     * Empty by default, and the surface is closed to everybody when it is empty
     * - an operator view that defaults to open is a data breach with a
     * changelog entry.
     */
    platformOperatorEmails: readList('PLATFORM_OPERATOR_EMAILS'),
  };
}

/**
 * AES-256-GCM master key for readable secrets (blueprint 12.4).
 *
 * Same discipline as the session secret: production refuses to start without a
 * real value, development falls back to a fixed obviously-fake key so
 * `docker compose up` needs no credentials.
 */
function readEncryptionMasterKey(): string {
  const configured = process.env['ENCRYPTION_MASTER_KEY'];
  const isProduction = readString('NODE_ENV', 'development') === 'production';

  if (configured === undefined || configured === '' || configured.startsWith('replace-me')) {
    if (isProduction) {
      throw new Error(
        'ENCRYPTION_MASTER_KEY must be set to a real 32-byte base64 key in production',
      );
    }
    // 32 bytes of the literal text below, base64 encoded. Not a secret.
    return Buffer.from('development-only-insecure-key-32').toString('base64');
  }
  return configured;
}

/**
 * HMAC key material for IP pseudonyms (blueprint 9.4).
 *
 * Same discipline as the session and encryption secrets: production refuses to
 * start without a real value; development falls back to an obviously-fake one
 * so `docker compose up` needs no credentials. A weak key here would make the
 * pseudonyms reversible by brute force over the IPv4 space, which is the whole
 * thing the HMAC exists to prevent.
 */
function readIpHmacSecret(): string {
  const configured = process.env['IP_HMAC_SECRET'];

  if (configured === undefined || configured === '' || configured.startsWith('replace-me')) {
    if (isProductionEnv()) {
      throw new Error('IP_HMAC_SECRET must be set to a real random value in production');
    }
    return 'development-only-insecure-ip-hmac-secret';
  }
  return configured;
}

function isProductionEnv(): boolean {
  return readString('NODE_ENV', 'development') === 'production';
}

/**
 * A comma-separated list, normalised and de-blanked.
 *
 * Lower-cased because it is compared against email addresses, which this
 * product already treats case-insensitively everywhere else.
 */
/**
 * Parse `version:base64key` pairs.
 *
 * Refuses anything malformed rather than skipping it. A retired key that was
 * silently dropped because of a typo would present as data that cannot be
 * decrypted, days later, with nothing pointing at the cause.
 */
function readVersionedKeys(name: string): readonly (readonly [number, string])[] {
  return readString(name, '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const separator = entry.indexOf(':');
      const version = Number.parseInt(entry.slice(0, separator), 10);
      const key = entry.slice(separator + 1);
      if (separator < 1 || Number.isNaN(version) || key === '') {
        throw new Error(`${name} entries must be written as version:base64key`);
      }
      return [version, key] as const;
    });
}

function readList(name: string): readonly string[] {
  return readString(name, '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
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
