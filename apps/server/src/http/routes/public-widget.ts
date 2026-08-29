import { Router } from 'express';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  ERROR_CODES,
  EVENT_MAX_BODY_BYTES,
  SUBMISSION_MAX_BODY_BYTES,
  createErrorPayload,
  interactionBatchSchema,
  submissionPayloadSchema,
  validate,
  type Logger,
} from '@lcp/contracts';
import express from 'express';
import type { PublicWidgetService } from '../../application/widget/public-widget-service.js';
import type { SubmissionService } from '../../application/submission/submission-service.js';
import type { RateLimiter } from '../../ports/rate-limiter.js';
import {
  INTERACTION_RATE_RULES,
  SUBMISSION_RATE_RULES,
} from '../../infrastructure/redis/rate-limiter.js';
import type { AnalyticsService } from '../../application/analytics/analytics-service.js';
import { visitorPseudonym } from '../../domain/analytics/visitor-pseudonym.js';

/**
 * The public widget surface: loader, runtime, and config (blueprint 7.2, 8.2).
 *
 * This router is mounted OUTSIDE the session and CSRF middleware, and that is
 * the point rather than an oversight. Nothing here is authenticated: a visitor
 * on a customer's website has no account with us and never will. Authorization
 * is the Origin allowlist and the published state, both checked on the server
 * against current data.
 *
 * The cache contract from blueprint 8.2 is implemented literally:
 *
 *   loader   5 minutes          - so new loader behaviour reaches clients soon
 *   runtime  1 year, immutable  - safe only because the URL carries a content
 *                                 hash, so a new build is a new URL
 *   config   60 seconds + ETag  - short enough that unpublishing takes effect
 *                                 quickly, and the submission endpoint re-checks
 *                                 state anyway (8.2)
 */

/** Where the loader tells browsers to fetch the runtime and its config from. */
export const PUBLIC_WIDGET_PREFIX = '/widget/v1';

const FIVE_MINUTES = 300;
const ONE_MINUTE = 60;
const ONE_YEAR = 31_536_000;

/**
 * The built runtime bundle and its content hash.
 *
 * Read once at startup. The hash is what makes a one-year immutable cache safe:
 * a rebuilt runtime hashes differently, so it is a different URL and no client
 * is ever holding a stale copy of a URL whose contents changed.
 *
 * The IIFE build is used rather than the ES one because the loader injects a
 * classic `<script>` tag - a customer page may not support modules, and a
 * module script would also be deferred in ways a widget does not want.
 */
export interface RuntimeAsset {
  readonly source: string;
  readonly hash: string;
  readonly bytes: number;
}

export function loadRuntimeAsset(): RuntimeAsset | null {
  try {
    const require = createRequire(import.meta.url);
    // Resolved through node_modules, where npm workspaces links the package,
    // rather than by walking relative paths from a build output directory.
    const entry = require.resolve('@lcp/widget-runtime');
    const source = readFileSync(join(dirname(entry), 'widget-runtime.iife.js'), 'utf8');
    return {
      source,
      hash: createHash('sha256').update(source).digest('hex').slice(0, 16),
      bytes: Buffer.byteLength(source, 'utf8'),
    };
  } catch {
    // The server still starts and every other route works; only the widget
    // assets 503, with a message that says exactly what to do.
    return null;
  }
}

export interface PublicWidgetRouterDeps {
  readonly widgets: PublicWidgetService;
  readonly submissions: SubmissionService;
  readonly analytics: AnalyticsService;
  /** Shared with the submission path; the visitor pseudonym is derived here. */
  readonly ipHmacSecret: string;
  readonly limiter: RateLimiter;
  readonly logger: Logger;
  /** Absolute origin the loader points at, e.g. https://app.example.com. */
  readonly publicBaseUrl: string;
}

export function createPublicWidgetRouter(deps: PublicWidgetRouterDeps): Router {
  const router = Router();
  const { widgets, submissions, analytics, limiter, logger, publicBaseUrl } = deps;

  const runtime = loadRuntimeAsset();
  if (runtime === null) {
    logger.warn('widget.runtime_missing', {
      result: 'degraded',
      hint: 'Run `npm run build` so packages/widget-runtime/dist exists',
    });
  } else {
    logger.info('widget.runtime_loaded', {
      result: 'success',
      hash: runtime.hash,
      bytes: runtime.bytes,
    });
  }

  const base = publicBaseUrl.replace(/\/+$/, '');
  const runtimeUrl =
    runtime === null ? null : `${base}${PUBLIC_WIDGET_PREFIX}/runtime.${runtime.hash}.js`;

  // ------------------------------------------------------------------ loader

  router.get('/loader.js', (_request, response) => {
    if (runtimeUrl === null) {
      response.status(503).type('application/javascript').send('/* widget runtime unavailable */');
      return;
    }

    response.set('Cache-Control', `public, max-age=${String(FIVE_MINUTES)}`);
    response.type('application/javascript').send(loaderSource(runtimeUrl, base));
  });

  // ----------------------------------------------------------------- runtime

  router.get('/runtime.:hash.js', (request, response) => {
    if (runtime === null) {
      response.status(503).type('application/javascript').send('/* widget runtime unavailable */');
      return;
    }

    /**
     * A mismatched hash is a stale URL, not a different asset.
     *
     * Serving the current bundle under an old hash would break the immutability
     * promise, so it is refused; the loader will have already moved on to the
     * new URL.
     */
    const requested = String(request.params.hash ?? '');
    if (requested !== runtime.hash) {
      response.status(404).type('application/javascript').send('/* unknown runtime build */');
      return;
    }

    response.set('Cache-Control', `public, max-age=${String(ONE_YEAR)}, immutable`);
    response.type('application/javascript').send(runtime.source);
  });

  // ------------------------------------------------------------------ config

  router.get('/config/:publicId', async (request, response, next) => {
    try {
      const origin = request.get('origin');
      const publicId = String(request.params.publicId ?? '');

      /**
       * The answer depends on the Origin, so it must not be cached as if it
       * did not. Without this a shared cache could hand one site's allowed
       * response to a site that is not on the allowlist.
       */
      response.set('Vary', 'Origin');

      const outcome = await widgets.config(publicId, origin);

      if (outcome.kind === 'not_found') {
        response
          .status(404)
          .json(
            createErrorPayload(
              ERROR_CODES.NOT_FOUND,
              'Widget not available',
              request.correlationId,
            ),
          );
        return;
      }

      if (outcome.kind === 'origin_not_allowed') {
        response
          .status(403)
          .json(
            createErrorPayload(
              ERROR_CODES.FORBIDDEN,
              'This widget is not permitted on this site',
              request.correlationId,
            ),
          );
        return;
      }

      if (outcome.kind === 'quota_blocked') {
        response
          .status(429)
          .json(
            createErrorPayload(
              ERROR_CODES.QUOTA_EXCEEDED,
              'This widget is temporarily unavailable',
              request.correlationId,
            ),
          );
        return;
      }

      /**
       * CORS, only for an Origin that already passed the allowlist.
       *
       * Blueprint 7.3 is explicit that "CORS headers alone are not treated as
       * authentication" - so this header is the consequence of the check, never
       * the check itself. An unauthorised Origin has already been refused above
       * and never reaches this line.
       */
      if (origin !== undefined) response.set('Access-Control-Allow-Origin', origin);

      /**
       * An explicit ETag, derived from what actually identifies this config.
       *
       * Express can generate one by hashing the response body, but that ties
       * the cache identity to incidental things - key order, whitespace, a
       * field added later - and differs between processes. A widget's config
       * is uniquely identified by its public id and revision number, which is
       * stable across restarts and across every server behind a load balancer,
       * so the validator is built from those and the conditional request is
       * answered here rather than left to framework behaviour.
       */
      const etag = `"w-${outcome.response.publicId}-${String(outcome.response.revision)}"`;
      response.set('ETag', etag);
      response.set('Cache-Control', `public, max-age=${String(ONE_MINUTE)}`);

      if (request.get('if-none-match') === etag) {
        response.status(304).end();
        return;
      }

      response.status(200).json(outcome.response);
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------------------- submission

  /**
   * CORS preflight.
   *
   * A submission sends `content-type: application/json`, which is not a
   * simple request, so browsers ask first. This answers permissively about the
   * METHOD and headers while saying nothing about whether the widget exists -
   * the Origin allowlist is enforced on the POST itself, against the widget's
   * own current settings. Blueprint 7.3 step 1 is explicit that CORS headers
   * are not treated as authentication, so a permissive preflight grants
   * nothing.
   */
  router.options('/submit/:publicId', (request, response) => {
    const origin = request.get('origin');
    response.set('Vary', 'Origin');
    if (origin !== undefined) response.set('Access-Control-Allow-Origin', origin);
    response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'content-type');
    response.set('Access-Control-Max-Age', '600');
    response.status(204).end();
  });

  /**
   * The public submission endpoint (blueprint 7.3).
   *
   * The body parser is mounted here rather than globally so the 32 KB limit
   * applies to exactly this route, and an oversized body becomes a clean 413
   * rather than reaching the handler at all.
   */
  router.post(
    '/submit/:publicId',
    express.json({ limit: SUBMISSION_MAX_BODY_BYTES }),
    async (request, response, next) => {
      const origin = request.get('origin');
      const publicId = String(request.params.publicId ?? '');

      response.set('Vary', 'Origin');

      /**
       * The generic answer, used for success AND for a silently discarded bot.
       *
       * Declared once so the two paths cannot drift apart: blueprint 7.3 step
       * 10 requires a uniform response that does not reveal spam
       * classification, and the surest way to keep that true is to have one
       * place that writes it.
       */
      const ack = (outcome: unknown): void => {
        if (origin !== undefined) response.set('Access-Control-Allow-Origin', origin);
        response.status(202).json({ status: 'received', outcome });
      };

      const fail = (
        code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
        message: string,
        status: number,
        details?: unknown,
      ): void => {
        if (origin !== undefined) response.set('Access-Control-Allow-Origin', origin);
        response
          .status(status)
          .json(createErrorPayload(code, message, request.correlationId, details as never));
      };

      try {
        const parsed = validate(submissionPayloadSchema, request.body);
        if (!parsed.ok) {
          fail(ERROR_CODES.VALIDATION_FAILED, 'Check the submitted fields', 400, parsed.errors);
          return;
        }

        /**
         * Blueprint 7.3 step 7: the raw address is used transiently here for
         * rate limiting and geo, and is never persisted. What reaches storage
         * is the rotating HMAC pseudonym the service derives.
         */
        const ip = request.ip ?? 'unknown';

        // Step 3: three shared Redis limits.
        const pair = `${publicId}:${ip}`;
        for (const rule of [
          { rule: SUBMISSION_RATE_RULES.perIpWidgetMinute, id: pair },
          { rule: SUBMISSION_RATE_RULES.perIpWidgetHour, id: pair },
          { rule: SUBMISSION_RATE_RULES.perWidgetMinute, id: publicId },
        ]) {
          const decision = await limiter.consume(rule.rule, rule.id);
          if (!decision.allowed) {
            // Minimal evidence only (blueprint 7.4): the pseudonym and the
            // event type, never the body that was refused.
            await submissions.recordRateLimited(publicId, ip, origin);
            response.set('Retry-After', String(decision.retryAfterSeconds));
            fail(ERROR_CODES.RATE_LIMITED, 'Too many submissions. Try again shortly.', 429);
            return;
          }
        }

        const outcome = await submissions.submit({
          publicId,
          origin,
          ip,
          payload: parsed.data,
        });

        switch (outcome.kind) {
          case 'accepted':
          case 'discarded':
            // Identical answers. A bot learns nothing from the response.
            ack(outcome.outcome);
            return;
          case 'widget_unavailable':
            fail(ERROR_CODES.NOT_FOUND, 'Widget not available', 404);
            return;
          case 'origin_not_allowed':
            fail(ERROR_CODES.FORBIDDEN, 'This widget is not permitted on this site', 403);
            return;
          case 'invalid':
            fail(ERROR_CODES.VALIDATION_FAILED, 'Check the submitted fields', 400, outcome.errors);
            return;
          case 'quota_exceeded':
            fail(ERROR_CODES.QUOTA_EXCEEDED, 'This form is temporarily unavailable', 429);
            return;
        }
      } catch (error) {
        next(error);
      }
    },
  );

  // -------------------------------------------------------------- events

  router.options('/events/:publicId', (request, response) => {
    const origin = request.get('origin');
    response.set('Vary', 'Origin');
    if (origin !== undefined) response.set('Access-Control-Allow-Origin', origin);
    response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'content-type');
    response.set('Access-Control-Max-Age', '600');
    response.status(204).end();
  });

  /**
   * The public interaction-event endpoint (blueprint 13.2 step 1).
   *
   * Same hardening discipline as the submission path, because it has the same
   * exposure: unauthenticated, cross-origin, and reachable by anyone who can
   * read a public widget id. Origin allowlist, published-state check, body
   * limit, schema, rate limits, and workspace quota - in that order, so the
   * cheapest refusal happens first.
   *
   * The answer is uniform and always 202. A widget has nothing useful to do
   * with the difference between "stored", "over quota", and "throttled", and
   * telling a caller which of their events were counted is a free measurement
   * of our own limits. It also means a browser never sees an error for
   * telemetry, which would put a red line in a customer's console for something
   * that is not their problem.
   */
  router.post(
    '/events/:publicId',
    express.json({ limit: EVENT_MAX_BODY_BYTES }),
    async (request, response, next) => {
      const origin = request.get('origin');
      const publicId = String(request.params.publicId ?? '');
      response.set('Vary', 'Origin');

      /** One writer for the answer, so the paths cannot drift apart. */
      const ack = (accepted: number): void => {
        if (origin !== undefined) response.set('Access-Control-Allow-Origin', origin);
        response.status(202).json({ status: 'received', accepted });
      };

      try {
        const parsed = validate(interactionBatchSchema, request.body);
        if (!parsed.ok) {
          // A malformed batch is the one case worth answering distinctly: it is
          // a bug in a caller rather than a limit, and a silent 202 would hide
          // it from whoever has to fix it.
          if (origin !== undefined) response.set('Access-Control-Allow-Origin', origin);
          response
            .status(400)
            .json(
              createErrorPayload(
                ERROR_CODES.VALIDATION_FAILED,
                'Check the submitted events',
                request.correlationId,
                parsed.errors as never,
              ),
            );
          return;
        }

        const resolved = await widgets.resolveForPublic(publicId, origin);
        if (resolved.kind !== 'ok') {
          // Not found, unpublished, or a disallowed Origin all answer the same
          // way: a public id is not an authorization, and distinguishing them
          // would turn this endpoint into a widget-enumeration oracle.
          ack(0);
          return;
        }

        /**
         * The raw address is used transiently to derive the pseudonym and then
         * discarded (blueprint 9.4). The rate limiter keys on the pseudonym
         * rather than the address, so nothing downstream ever needs the IP.
         */
        const ip = request.ip ?? 'unknown';
        const pseudonym = visitorPseudonym(deps.ipHmacSecret, ip, publicId, new Date());

        for (const rule of [
          {
            rule: INTERACTION_RATE_RULES.perVisitorWidgetMinute,
            id: `${publicId}:${pseudonym.value}`,
          },
          { rule: INTERACTION_RATE_RULES.perWidgetMinute, id: publicId },
        ]) {
          const decision = await limiter.consume(rule.rule, rule.id);
          if (!decision.allowed) {
            ack(0);
            return;
          }
        }

        const outcome = await analytics.ingest({
          widget: resolved.widget,
          workspace: resolved.workspace,
          origin: origin ?? '',
          ip,
          events: parsed.data.events,
          // Geo enrichment is a submission-path concern: it costs a provider
          // call per request, and 20,000 events a month per workspace would
          // exhaust a free tier on telemetry alone. Country/city slices come
          // from the events that carry geo through their submission.
          geo: null,
        });

        ack(outcome.kind === 'accepted' ? outcome.stored : 0);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

/**
 * The stable loader (blueprint 7.2 steps 1-3, 8.1).
 *
 * Deliberately generated as a string rather than shipped as a built file, for
 * one reason: it has to name the CURRENT content-hashed runtime URL, and a
 * pre-built loader would need rewriting on every runtime build to stay correct.
 *
 * It does the least it possibly can - find the tags, load the runtime once, and
 * queue the work - because it is the one asset with a short cache that every
 * page pays for. Everything else is the runtime's job.
 */
export function loaderSource(runtimeUrl: string, apiBase: string): string {
  return `(function () {
  var QUEUE = '__LCP_WIDGET_QUEUE__';
  var FLAG = '__LCP_WIDGET_LOADER__';

  // Blueprint 8.1: one runtime per page, however many widget tags there are.
  if (window[FLAG]) return;
  window[FLAG] = true;

  window[QUEUE] = window[QUEUE] || [];

  var tags = document.querySelectorAll('script[data-widget]');
  for (var i = 0; i < tags.length; i += 1) {
    var id = tags[i].getAttribute('data-widget');
    if (id) window[QUEUE].push({ publicId: id, apiBase: ${JSON.stringify(apiBase)} });
  }

  if (!window[QUEUE].length) return;

  var script = document.createElement('script');
  script.src = ${JSON.stringify(runtimeUrl)};
  script.async = true;
  document.head.appendChild(script);
})();
`;
}
