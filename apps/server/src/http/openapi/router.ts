import { Router } from 'express';
import express from 'express';
import { createRequire } from 'node:module';
import { buildOpenApiDocument, DOCS_PATH, OPENAPI_PATH } from './document.js';
import { docsCsp } from '../middleware/security-headers.js';

/**
 * The API documentation surface (blueprint 10.1).
 *
 * "OpenAPI is the contract source and is rendered through Swagger UI." Two
 * things are served here: the document itself at a stable JSON URL, and Swagger
 * UI pointed at it.
 *
 * The UI is served from the `swagger-ui-dist` package rather than a CDN. A CDN
 * would be one line shorter and would break the promise in blueprint 15.1 that
 * one Docker command brings the whole thing up - an evaluator on a train would
 * get a blank page. It also keeps the documentation inside the same origin and
 * the same release as the API it describes.
 *
 * Everything here is public and unauthenticated by design. It describes the
 * shape of the API, not any tenant's data, and the "Try it out" button is
 * useful precisely because a reader can see an unauthenticated call fail with
 * the real 401 envelope. Nothing in the document is a secret: no example
 * payload carries a credential, and response bodies are described rather than
 * sampled, so there is no seeded data to leak.
 */

/**
 * The initialiser Swagger UI runs in the browser.
 *
 * Written out rather than using the package's own `swagger-initializer.js`,
 * which points at Swagger's public petstore example. Inlined because it is four
 * lines and a separate asset would be one more thing to keep in step.
 *
 * `persistAuthorization` is deliberately off: this API authenticates with a
 * session cookie the browser already holds, so there is nothing for the UI to
 * remember, and offering a token box would suggest an API-key model that
 * version 1 does not have.
 */
function initializer(specUrl: string): string {
  return `window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: ${JSON.stringify(specUrl)},
    dom_id: '#swagger-ui',
    deepLinking: true,
    docExpansion: 'none',
    defaultModelsExpandDepth: 0,
    tryItOutEnabled: true,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: 'StandaloneLayout',
  });
};
`;
}

function page(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>API reference - Lead Capture Platform</title>
    <link rel="stylesheet" href="${DOCS_PATH}/swagger-ui.css" />
    <style>
      body { margin: 0; background: #edeff7; }
      /* The stock topbar is a URL box for loading other specs, which is not
         what this page is for. */
      .swagger-ui .topbar { display: none; }
      .lcp-banner {
        font: 500 14px/1.5 system-ui, sans-serif;
        color: #14162b;
        background: #fff;
        border-bottom: 1px solid #d3d7e8;
        padding: 14px 20px;
      }
      .lcp-banner a { color: #3d2bd9; }
    </style>
  </head>
  <body>
    <p class="lcp-banner">
      Lead Capture Platform API reference &mdash;
      <a href="${OPENAPI_PATH}">the OpenAPI document</a> &middot;
      <a href="/docs/api">how to use this API</a>
    </p>
    <div id="swagger-ui"></div>
    <script src="${DOCS_PATH}/swagger-ui-bundle.js" crossorigin></script>
    <script src="${DOCS_PATH}/swagger-ui-standalone-preset.js" crossorigin></script>
    <script src="${DOCS_PATH}/swagger-initializer.js" crossorigin></script>
  </body>
</html>
`;
}

export interface OpenApiRouterDeps {
  /** The origin this API is reached on, used for "Try it out". */
  readonly serverUrl: string;
}

export function createOpenApiRouter(deps: OpenApiRouterDeps): Router {
  const router = Router();
  const document = buildOpenApiDocument(deps.serverUrl);

  router.get(OPENAPI_PATH, (_request, response) => {
    response.type('application/json').send(JSON.stringify(document, null, 2));
  });

  /**
   * The documentation surface gets its own CSP (blueprint 17).
   *
   * The application-wide policy is `default-src 'none'`, which is right for
   * JSON and wrong for the only HTML page this server serves. Applied to the
   * page AND to the asset routes below it, so a stylesheet fetched by that page
   * is governed by the same policy the page was rendered under.
   */
  router.use(DOCS_PATH, docsCsp());

  router.get(DOCS_PATH, (_request, response) => {
    response.type('html').send(page());
  });

  router.get(`${DOCS_PATH}/swagger-initializer.js`, (_request, response) => {
    response.type('application/javascript').send(initializer(OPENAPI_PATH));
  });

  /**
   * The rest of Swagger UI's assets.
   *
   * `createRequire` rather than a bare import, because the package has no ESM
   * entry point and resolving it from this module's own URL is what keeps it
   * working under both the compiled output and the test runner.
   *
   * Registered AFTER the initialiser above, so ours wins over the package's
   * petstore-pointing one.
   */
  const assets = createRequire(import.meta.url)('swagger-ui-dist') as {
    getAbsoluteFSPath: () => string;
  };
  router.use(
    DOCS_PATH,
    express.static(assets.getAbsoluteFSPath(), {
      index: false,
      // Content-hashed by version, and the whole directory is replaced on
      // upgrade, so a day is safe and keeps the free tier's bandwidth down.
      maxAge: '1d',
    }),
  );

  return router;
}
