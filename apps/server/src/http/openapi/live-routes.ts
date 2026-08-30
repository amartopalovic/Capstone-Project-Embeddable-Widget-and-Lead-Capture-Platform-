import type { Router } from 'express';

/**
 * The routes this server actually serves.
 *
 * Blueprint 10.1 makes OpenAPI "the contract source", and the failure that
 * ruins an OpenAPI document is drift: a route is added, the spec is not, and
 * the published contract quietly starts lying. A spec that lies is worse than
 * no spec, because a reader trusts it. So the document is checked against
 * reality rather than against a reviewer's memory.
 *
 * Reality here means two things, and both are the same objects the server
 * dispatches from - never a description of them:
 *
 *  - the MOUNT TABLE in `app.ts`, which is the array `createApp` iterates to
 *    call `app.use`. It is not a list of where the routers are mounted; it is
 *    what mounts them, so it cannot disagree with the app.
 *  - each Router's own `stack`, which is where Express records the paths and
 *    methods it will match.
 *
 * An earlier version tried to recover mount prefixes from Express's internals
 * instead. Express 5 keeps them in a closure over a compiled matcher, so they
 * are not readable, and the check silently compared unprefixed paths. Passing
 * the table in is both simpler and harder to get wrong.
 */

/** One mounted router, exactly as `createApp` mounts it. */
export interface RouteMount {
  readonly prefix: string;
  readonly router: Router;
}

/** A route registered directly on the app rather than through a router. */
export interface DirectRoute {
  readonly method: string;
  readonly path: string;
}

interface StackLayer {
  readonly route?: {
    readonly path: string | readonly string[];
    readonly methods: Readonly<Record<string, boolean>>;
  };
}

/** Methods that are dispatched, ignoring the HEAD/OPTIONS Express adds itself. */
const DOCUMENTED_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

function collect(router: Router, prefix: string, found: Set<string>): void {
  const stack = (router as unknown as { stack?: readonly StackLayer[] }).stack;
  if (stack === undefined) {
    throw new Error(
      `Could not read the stack of the router mounted at "${prefix}". The contract check cannot verify the OpenAPI document against reality, so it fails rather than passing vacuously.`,
    );
  }

  for (const layer of stack) {
    if (layer.route === undefined) continue;
    const paths = Array.isArray(layer.route.path)
      ? (layer.route.path as readonly string[])
      : [layer.route.path as string];

    for (const routePath of paths) {
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (!enabled || !DOCUMENTED_METHODS.has(method)) continue;
        const full = `${prefix}${routePath === '/' ? '' : routePath}`;
        found.add(`${method.toUpperCase()} ${full === '' ? '/' : full}`);
      }
    }
  }
}

/**
 * Every route the app dispatches, as `METHOD /path` with Express parameter
 * syntax preserved (`/api/v1/widgets/:widgetId`).
 */
export function liveRoutes(
  mounts: readonly RouteMount[],
  direct: readonly DirectRoute[] = [],
): readonly string[] {
  const found = new Set<string>();
  for (const mount of mounts) collect(mount.router, mount.prefix, found);
  for (const route of direct) found.add(`${route.method.toUpperCase()} ${route.path}`);

  if (found.size === 0) {
    throw new Error('The mount table yielded no routes, which cannot be right.');
  }
  return [...found].sort();
}
