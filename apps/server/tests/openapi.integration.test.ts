import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COLLECTIONS } from '@lcp/database';
import {
  DOCS_PATH,
  OPENAPI_PATH,
  buildOpenApiDocument,
  documentedRoutes,
} from '../src/http/openapi/document.js';
import { liveRoutes } from '../src/http/openapi/live-routes.js';
import { mountedRoutesOf } from '../src/http/app.js';
import { TestClient, createAuthHarness, type AuthHarness } from './helpers/auth-harness.js';

/**
 * The OpenAPI document against reality (blueprint 10.1).
 *
 * Blueprint 10.1 makes OpenAPI "the contract source". A contract source that
 * has drifted from the thing it describes is worse than no contract at all,
 * because a reader has no way to tell which half is wrong - so this file exists
 * to make drift a build failure rather than a discovery.
 *
 * The comparison is against the REAL app, built by the same composition root
 * production uses, with its routes read out of Express's own dispatch table.
 * Nothing here is asserted against a hand-kept list.
 */

let harness: AuthHarness;

beforeAll(async () => {
  harness = await createAuthHarness();
}, 120_000);

afterAll(async () => {
  await harness?.teardown();
});

describe('the OpenAPI document matches the live API - EXIT GATE', () => {
  it('documents every route the server dispatches, and no others', () => {
    const { mounts, direct } = mountedRoutesOf(harness.app);
    const live = new Set(liveRoutes(mounts, direct));
    const documented = new Set(documentedRoutes());

    /**
     * Express registers these itself and they are not part of the contract:
     * the catch-all 404 handler and the error handler are middleware rather
     * than routes, so they never appear, but the static asset mount for Swagger
     * UI does - and documenting the individual files of a vendored UI bundle
     * would be noise. The documentation ROUTES themselves are asserted below.
     */
    const notContract = (route: string): boolean =>
      route.startsWith(`GET ${DOCS_PATH}`) || route === `GET ${OPENAPI_PATH}`;

    const undocumented = [...live].filter((route) => !documented.has(route) && !notContract(route));
    const phantom = [...documented].filter((route) => !live.has(route));

    // Named separately so a failure says WHICH direction drifted; a combined
    // set-equality assertion would make somebody diff two 70-line lists.
    expect(undocumented, 'routes the server serves but the document omits').toEqual([]);
    expect(phantom, 'routes the document claims but the server does not serve').toEqual([]);
  });

  it('serves a structurally valid OpenAPI 3.1 document', async () => {
    const response = await new TestClient(harness.baseUrl).get(OPENAPI_PATH);
    expect(response.status).toBe(200);

    const document = response.body as {
      openapi: string;
      info: { title: string; version: string; description: string };
      paths: Record<
        string,
        Record<string, { summary?: string; description?: string; responses?: unknown }>
      >;
      components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
      tags: { name: string }[];
    };

    expect(document.openapi).toMatch(/^3\.1\./);
    expect(document.info.title).toBe('Lead Capture Platform API');
    expect(document.info.version).toBeTruthy();
    expect(Object.keys(document.paths).length).toBeGreaterThan(50);

    // Every operation is usable documentation, not a stub.
    for (const [route, operations] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const where = `${method.toUpperCase()} ${route}`;
        expect(operation.summary, `${where} has no summary`).toBeTruthy();
        expect(operation.description, `${where} has no description`).toBeTruthy();
        expect(operation.responses, `${where} documents no responses`).toBeTruthy();
        expect(
          Object.keys(operation.responses as Record<string, unknown>).length,
          `${where} documents no responses`,
        ).toBeGreaterThan(0);
      }
    }

    // Every tag an operation uses is declared, so the UI has no orphan groups.
    const declared = new Set(document.tags.map((tag) => tag.name));
    for (const operations of Object.values(document.paths)) {
      for (const operation of Object.values(operations)) {
        for (const tag of (operation as { tags?: string[] }).tags ?? []) {
          expect(declared, `undeclared tag "${tag}"`).toContain(tag);
        }
      }
    }
  }, 60_000);

  it('derives request bodies from the validators the routes actually use', async () => {
    /**
     * The property that makes the document trustworthy rather than merely
     * present. `registerRequestSchema` bounds a password at 12 characters, and
     * that number is in the published contract because the contract is
     * generated from the same object the route validates with - nobody
     * transcribed it, so nobody can forget to update it.
     */
    const document = buildOpenApiDocument('http://localhost:3000') as unknown as {
      paths: Record<
        string,
        Record<
          string,
          { requestBody?: { content: Record<string, { schema: Record<string, unknown> }> } }
        >
      >;
    };

    const register = document.paths['/api/v1/auth/register']?.['post']?.requestBody;
    const schema = register?.content['application/json']?.schema as {
      properties: { password: { minLength: number }; email: { format: string } };
      required: string[];
    };

    expect(schema.properties.password.minLength).toBe(12);
    expect(schema.properties.email.format).toBe('email');
    expect(schema.required).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('leaks no credential, secret, or seeded example', async () => {
    /**
     * A published contract is a place secrets end up by accident - a real token
     * pasted into an example, a database URI in a server list. Asserted rather
     * than assumed, because it is exactly the kind of thing that arrives in a
     * later edit rather than this one.
     */
    const response = await new TestClient(harness.baseUrl).get(OPENAPI_PATH);
    const raw = JSON.stringify(response.body);

    for (const forbidden of [
      'mongodb://',
      'mongodb+srv://',
      'redis://',
      harness.keyPrefix,
      'BEGIN PRIVATE KEY',
    ]) {
      expect(raw, `the document contains "${forbidden}"`).not.toContain(forbidden);
    }
    // No `example` values at all, which is how a real-looking credential would
    // most plausibly get in.
    expect(raw).not.toContain('"example"');
  }, 60_000);

  it('is reachable without a session, and so is Swagger UI', async () => {
    const anonymous = new TestClient(harness.baseUrl);

    expect((await anonymous.get(OPENAPI_PATH)).status).toBe(200);

    const docs = await anonymous.request('GET', DOCS_PATH);
    expect(docs.status).toBe(200);
    // The page loads the UI bundle and points it at this API's own document,
    // rather than Swagger's default petstore example.
    const html = String(docs.body);
    expect(html).toContain('swagger-ui-bundle.js');
    expect(html).toContain('swagger-ui.css');
    expect(html).not.toContain('petstore');

    const initializer = await anonymous.request('GET', `${DOCS_PATH}/swagger-initializer.js`);
    expect(initializer.status).toBe(200);
    expect(String(initializer.body)).toContain(OPENAPI_PATH);
    expect(String(initializer.body)).not.toContain('petstore');

    // And the vendored assets the page asks for are actually served.
    expect((await anonymous.request('GET', `${DOCS_PATH}/swagger-ui.css`)).status).toBe(200);
    expect((await anonymous.request('GET', `${DOCS_PATH}/swagger-ui-bundle.js`)).status).toBe(200);
  }, 60_000);

  it('exposes nothing about any tenant', async () => {
    /**
     * The document describes shapes, never data. A reader with no account gets
     * the contract and nothing else - which is checked by asking for it while a
     * workspace with a real name exists in the database.
     */
    const distinctive = `contract-check-${String(Date.now())}`;
    await harness.db.collection(COLLECTIONS.workspaces).insertOne({ name: distinctive } as never);

    const raw = JSON.stringify((await new TestClient(harness.baseUrl).get(OPENAPI_PATH)).body);
    expect(raw).not.toContain(distinctive);

    await harness.db.collection(COLLECTIONS.workspaces).deleteOne({ name: distinctive } as never);
  }, 60_000);
});
