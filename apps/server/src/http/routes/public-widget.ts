import { Router } from 'express';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { ERROR_CODES, createErrorPayload, type Logger } from '@lcp/contracts';
import type { PublicWidgetService } from '../../application/widget/public-widget-service.js';

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
  readonly logger: Logger;
  /** Absolute origin the loader points at, e.g. https://app.example.com. */
  readonly publicBaseUrl: string;
}

export function createPublicWidgetRouter(deps: PublicWidgetRouterDeps): Router {
  const router = Router();
  const { widgets, logger, publicBaseUrl } = deps;

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
