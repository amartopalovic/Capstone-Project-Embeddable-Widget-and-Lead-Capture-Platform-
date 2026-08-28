import type { Db } from 'mongodb';
import type Redis from 'ioredis';
import { createLogger, type Logger } from '@lcp/contracts';
import { UserRepository } from '@lcp/database';
import type { ServerEnv } from './config/env.js';
import { AuthService } from './application/auth/auth-service.js';
import { SessionService } from './application/auth/session-service.js';
import { MfaService } from './application/auth/mfa-service.js';
import { AccountAuditRepository } from './application/auth/account-audit-repository.js';
import { Argon2PasswordHasher } from './infrastructure/auth/argon2-password-hasher.js';
import {
  CompositeBreachChecker,
  HibpBreachChecker,
  LocalListBreachChecker,
} from './infrastructure/auth/breach-checker.js';
import { RedisSessionStore } from './infrastructure/redis/session-store.js';
import { RedisRateLimiter } from './infrastructure/redis/rate-limiter.js';
import { RedisEmailBudget } from './infrastructure/redis/email-budget.js';
import { RedisMfaChallengeStore } from './infrastructure/redis/mfa-challenge-store.js';
import { AesSecretCipher, parseMasterKey } from './infrastructure/auth/aes-secret-cipher.js';
import { OtpauthTotpService } from './infrastructure/auth/otpauth-totp-service.js';
import { RedisKeyBuilder } from './infrastructure/redis/key-policy.js';
import { BudgetedEmailSender } from './infrastructure/email/budgeted-sender.js';
import { BrevoEmailSender } from './infrastructure/email/brevo-sender.js';
import { MailpitEmailSender } from './infrastructure/email/mailpit-sender.js';
import { CapturingEmailSender } from './infrastructure/email/noop-sender.js';
import { systemClock, type Clock } from './ports/clock.js';
import type { EmailSender } from './ports/email-sender.js';
import type { BreachChecker } from './ports/breach-checker.js';

/**
 * Composition root.
 *
 * Every concrete adapter is chosen here and injected downward, so the
 * application services depend only on ports (blueprint section 6.2). Tests
 * build the same graph with fakes substituted.
 */

export interface AppDependencies {
  readonly logger: Logger;
  readonly authService: AuthService;
  readonly sessionService: SessionService;
  readonly mfaService: MfaService;
  readonly mfaChallengeStore: RedisMfaChallengeStore;
  readonly userRepository: UserRepository;
  readonly rateLimiter: RedisRateLimiter;
  readonly emailSender: EmailSender;
  readonly emailBudget: RedisEmailBudget;
  readonly keys: RedisKeyBuilder;
}

export interface CompositionOverrides {
  readonly clock?: Clock;
  readonly logger?: Logger;
  /** Substituted in tests that assert on sent mail without SMTP. */
  readonly emailSender?: EmailSender;
  readonly breachChecker?: BreachChecker;
}

/**
 * Select the outbound email provider.
 *
 * Blueprint section 15.1 requires local development to work with no Brevo
 * credentials, so Brevo is used only when explicitly selected AND a key is
 * present; otherwise the local capture sender is used rather than silently
 * failing to send.
 */
function selectEmailSender(env: ServerEnv, logger: Logger): EmailSender {
  if (env.emailProvider === 'brevo') {
    if (env.brevoApiKey === '') {
      logger.warn('email.provider_downgraded', {
        reason: 'brevo_selected_without_api_key',
        result: 'degraded',
      });
      return new CapturingEmailSender();
    }
    return new BrevoEmailSender({
      apiKey: env.brevoApiKey,
      fromEmail: env.brevoSenderEmail,
      fromName: env.brevoSenderName,
    });
  }

  if (env.emailProvider === 'mailpit') {
    return new MailpitEmailSender({
      host: env.mailpitHost,
      port: env.mailpitPort,
      fromEmail: env.brevoSenderEmail,
      fromName: env.brevoSenderName,
    });
  }

  return new CapturingEmailSender();
}

function selectBreachChecker(env: ServerEnv): BreachChecker {
  const offline = new LocalListBreachChecker();
  // The offline list is always first, so the remote checker can only ever add
  // coverage and its failure can never remove any.
  return env.breachCheckRemote
    ? new CompositeBreachChecker([offline, new HibpBreachChecker()])
    : offline;
}

export function buildDependencies(
  env: ServerEnv,
  db: Db,
  redis: Redis,
  overrides: CompositionOverrides = {},
): AppDependencies {
  const logger =
    overrides.logger ??
    createLogger({
      bindings: { service: 'server', environment: env.nodeEnv, release: env.release },
      minLevel: env.nodeEnv === 'test' ? 'error' : 'info',
    });

  const clock = overrides.clock ?? systemClock;
  const keys = new RedisKeyBuilder(env.redisKeyPrefix);

  const userRepository = new UserRepository(db);
  const auditEvents = new AccountAuditRepository(db);

  const emailBudget = new RedisEmailBudget(redis, keys);
  const rawEmailSender = overrides.emailSender ?? selectEmailSender(env, logger);
  const emailSender = new BudgetedEmailSender(rawEmailSender, emailBudget, clock, logger);

  const sessionStore = new RedisSessionStore(redis, keys, {
    idleTtlSeconds: env.sessionIdleTtlSeconds,
    absoluteTtlSeconds: env.sessionAbsoluteTtlSeconds,
  });

  const passwordHasher = new Argon2PasswordHasher();

  /**
   * Key ring for readable-secret encryption.
   *
   * Only the current version is configured today. Rotation adds older versions
   * here so existing ciphertext stays readable (blueprint 12.4).
   */
  const cipher = new AesSecretCipher({
    currentKeyVersion: env.encryptionKeyVersion,
    keysByVersion: new Map([[env.encryptionKeyVersion, parseMasterKey(env.encryptionMasterKey)]]),
  });

  const authService = new AuthService({
    users: userRepository,
    auditEvents,
    hasher: passwordHasher,
    breachChecker: overrides.breachChecker ?? selectBreachChecker(env),
    email: emailSender,
    clock,
    logger,
    appBaseUrl: env.appBaseUrl,
  });

  const sessionService = new SessionService({
    sessions: sessionStore,
    auditEvents,
    clock,
    logger,
    idleTtlSeconds: env.sessionIdleTtlSeconds,
    absoluteTtlSeconds: env.sessionAbsoluteTtlSeconds,
  });

  const mfaService = new MfaService({
    users: userRepository,
    auditEvents,
    totp: new OtpauthTotpService(env.totpIssuer),
    cipher,
    hasher: passwordHasher,
    clock,
    logger,
  });

  return {
    logger,
    authService,
    sessionService,
    mfaService,
    mfaChallengeStore: new RedisMfaChallengeStore(redis, keys),
    userRepository,
    rateLimiter: new RedisRateLimiter(redis, keys),
    emailSender,
    emailBudget,
    keys,
  };
}
