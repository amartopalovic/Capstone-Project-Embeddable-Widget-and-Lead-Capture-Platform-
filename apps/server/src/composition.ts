import type { Db } from 'mongodb';
import type Redis from 'ioredis';
import { createLogger, type Logger } from '@lcp/contracts';
import {
  ContactActivityRepository,
  ContactRepository,
  InvitationRepository,
  MembershipRepository,
  SubmissionEventRepository,
  UserRepository,
  WidgetRepository,
  WidgetRevisionRepository,
  workspaceScope,
  WorkspaceRepository,
  type InvitationRecord,
} from '@lcp/database';
import { COLLECTIONS } from '@lcp/database';
import type { WithId } from 'mongodb';
import type { WidgetRecord, WorkspaceRecord } from '@lcp/database';
import type { WidgetConfig } from '@lcp/contracts';
import type { ServerEnv } from './config/env.js';
import { AuthService } from './application/auth/auth-service.js';
import { SessionService } from './application/auth/session-service.js';
import { MfaService } from './application/auth/mfa-service.js';
import { WidgetService } from './application/widget/widget-service.js';
import { PublicWidgetService } from './application/widget/public-widget-service.js';
import { SubmissionService } from './application/submission/submission-service.js';
import { ContactService } from './application/contact/contact-service.js';
import { RedisEventHub } from './infrastructure/redis/event-hub.js';
import {
  IpApiGeoProvider,
  IpapiCoGeoProvider,
  NullGeoProvider,
} from './infrastructure/geo/providers.js';
import type { GeoProvider } from './ports/geo-provider.js';
import { WorkspaceService } from './application/workspace/workspace-service.js';
import { MembershipService } from './application/workspace/membership-service.js';
import { InvitationService } from './application/workspace/invitation-service.js';
import { WorkspaceAuditRepository } from './application/workspace/workspace-audit.js';
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
  readonly widgetService: WidgetService;
  readonly publicWidgetService: PublicWidgetService;
  readonly submissionService: SubmissionService;
  readonly contactService: ContactService;
  readonly eventHub: RedisEventHub;
  readonly workspaceService: WorkspaceService;
  readonly membershipService: MembershipService;
  readonly invitationService: InvitationService;
  readonly workspaceAudit: WorkspaceAuditRepository;
  readonly userRepository: UserRepository;
  readonly rateLimiter: RedisRateLimiter;
  readonly emailSender: EmailSender;
  readonly emailBudget: RedisEmailBudget;
  readonly keys: RedisKeyBuilder;
}

export interface CompositionOverrides {
  readonly clock?: Clock;
  /** Substituted by the deterministic provider tests in blueprint 18.4. */
  readonly geoProviders?: readonly GeoProvider[];
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

  const widgetRepository = new WidgetRepository(db);
  const widgetRevisionRepository = new WidgetRevisionRepository(db);
  const workspaceRepository = new WorkspaceRepository(db);
  const membershipRepository = new MembershipRepository(db);
  const invitationRepository = new InvitationRepository(db);
  const workspaceAudit = new WorkspaceAuditRepository(db);

  const workspaceService = new WorkspaceService({
    workspaces: workspaceRepository,
    memberships: membershipRepository,
    users: userRepository,
    widgets: widgetRepository,
    audit: workspaceAudit,
    clock,
    logger,
  });

  const widgetService = new WidgetService({
    widgets: widgetRepository,
    revisions: widgetRevisionRepository,
    audit: workspaceAudit,
    clock,
    logger,
    // The snippet points at the same origin that serves the loader Stage 6
    // builds, so a customer pastes one line and nothing has to be reconfigured
    // when that route arrives.
    publicBaseUrl: env.appBaseUrl,
  });

  const publicWidgetService = new PublicWidgetService({
    /**
     * The unscoped widget lookup.
     *
     * Kept here in the composition root, like the invitation token lookup, so
     * the escape hatch from the tenancy invariant is visible in one place and
     * cannot be reached accidentally from ordinary workspace code. Blueprint
     * 9.1 names exactly this case: a public widget identifier resolves to one
     * workspace on the server, and the visitor asking has no tenant context to
     * scope by.
     */
    findByPublicId: async (publicId: string): Promise<WithId<WidgetRecord> | null> =>
      db.collection<WidgetRecord>(COLLECTIONS.widgets).findOne({ publicId }),

    /** The owning workspace, so a deleted tenant stops serving its widgets. */
    findWorkspace: async (widget: WithId<WidgetRecord>): Promise<WithId<WorkspaceRecord> | null> =>
      workspaceRepository.findInScope(workspaceScope(widget.workspaceId)),

    revisions: widgetRevisionRepository,
    // Stages 7 and 10 count what could block serving; nothing does yet.
    isQuotaBlocked: async () => false,
    logger,
  });

  /**
   * Geo providers (blueprint 5.1, 7.3 step 8).
   *
   * Real providers only in production. Development and the test suite must not
   * depend on - or hammer - a free third-party service, and blueprint 18.4 wants
   * provider outcomes to be deterministic anyway, so the default is the
   * no-enrichment provider and the tests substitute their own.
   */
  const geoProviders =
    overrides.geoProviders ??
    (env.geoEnabled
      ? [new IpApiGeoProvider(env.geoTimeoutMs), new IpapiCoGeoProvider(env.geoTimeoutMs)]
      : [new NullGeoProvider()]);

  /**
   * SSE fan-out (blueprint 13.1).
   *
   * The subscriber is a DUPLICATE connection, not the shared client: ioredis
   * documents that a client entering subscriber mode accepts only subscription
   * commands, so sharing one would break sessions, rate limits, and idempotency
   * the moment the first dashboard connected.
   */
  const eventHub = new RedisEventHub(redis, redis.duplicate(), keys, logger);

  const submissionService = new SubmissionService({
    db,
    findWidgetByPublicId: async (publicId: string): Promise<WithId<WidgetRecord> | null> =>
      db.collection<WidgetRecord>(COLLECTIONS.widgets).findOne({ publicId }),
    findWorkspace: async (widget: WithId<WidgetRecord>): Promise<WithId<WorkspaceRecord> | null> =>
      workspaceRepository.findInScope(workspaceScope(widget.workspaceId)),
    findPublishedConfig: async (scope, widget) => {
      if (widget.publishedRevisionId === null) return null;
      const revision = await widgetRevisionRepository.findById(scope, widget.publishedRevisionId);
      if (revision === null || revision.status !== 'published') return null;
      return {
        config: revision.config as unknown as WidgetConfig,
        revisionNumber: revision.revisionNumber,
      };
    },
    geoProviders,
    ipHmacSecret: env.ipHmacSecret,
    events: eventHub,
    clock,
    logger,
  });

  const contactService = new ContactService({
    db,
    contacts: new ContactRepository(db),
    activities: new ContactActivityRepository(db),
    submissions: new SubmissionEventRepository(db),
    audit: workspaceAudit,
    clock,
    logger,
  });

  const membershipService = new MembershipService({
    memberships: membershipRepository,
    users: userRepository,
    audit: workspaceAudit,
    clock,
    logger,
  });

  const invitationService = new InvitationService({
    invitations: invitationRepository,
    memberships: membershipRepository,
    workspaces: workspaceRepository,
    users: userRepository,
    audit: workspaceAudit,
    email: emailSender,
    clock,
    logger,
    appBaseUrl: env.appBaseUrl,
    /**
     * The single unscoped invitation lookup.
     *
     * Kept here, in the composition root, rather than added to the scoped
     * repository, so the escape hatch is visible in one place and cannot be
     * reached accidentally from ordinary workspace code. The token hash is
     * globally unique, so it resolves to exactly one workspace - the same
     * shape as blueprint 9.1's public widget identifiers.
     */
    redeemByTokenHash: async (tokenHash: string): Promise<WithId<InvitationRecord> | null> =>
      db.collection<InvitationRecord>(COLLECTIONS.invitations).findOne({ tokenHash }),
  });

  return {
    logger,
    widgetService,
    publicWidgetService,
    submissionService,
    contactService,
    eventHub,
    authService,
    sessionService,
    mfaService,
    workspaceService,
    membershipService,
    invitationService,
    workspaceAudit,
    mfaChallengeStore: new RedisMfaChallengeStore(redis, keys),
    userRepository,
    rateLimiter: new RedisRateLimiter(redis, keys),
    emailSender,
    emailBudget,
    keys,
  };
}
