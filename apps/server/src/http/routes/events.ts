import { Router } from 'express';
import type { WorkspaceEvent, Logger } from '@lcp/contracts';
import { ERROR_CODES } from '@lcp/contracts';
import type { RedisEventHub } from '../../infrastructure/redis/event-hub.js';
import type { MembershipService } from '../../application/workspace/membership-service.js';
import type { WorkspaceService } from '../../application/workspace/workspace-service.js';
import { ApiError } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/session.js';
import { requireCapability, requireWorkspaceContext } from '../middleware/workspace.js';

/**
 * The authenticated, workspace-scoped SSE stream (blueprint 13.1).
 *
 * One stream per dashboard, carrying every live update for the workspace the
 * session is currently in. Not one stream per feature: browsers cap concurrent
 * connections per origin, and a dashboard showing contacts, usage, and delivery
 * health would spend that budget on plumbing.
 */

/**
 * Heartbeat interval.
 *
 * Blueprint 13.1: "Heartbeats keep intermediaries from silently closing active
 * connections." Proxies commonly idle out at 60 seconds, so 25 gives two
 * heartbeats inside that window - one can be lost without the connection being
 * reaped. It is sent as an SSE comment, which a compliant client ignores, so it
 * costs the application nothing to interpret.
 */
export const HEARTBEAT_MS = 25_000;

/**
 * How long a client should wait before reconnecting.
 *
 * Sent once as the SSE `retry:` field, so the bounded backoff blueprint 13.1
 * asks for is the SERVER's decision rather than each client's. The browser's
 * EventSource applies it automatically.
 */
export const RETRY_MS = 3_000;

export interface EventsRouterDeps {
  readonly hub: RedisEventHub;
  readonly memberships: MembershipService;
  readonly workspaces: WorkspaceService;
  readonly logger: Logger;
}

function frame(event: WorkspaceEvent): string {
  // `id:` is what a reconnecting client sends back as Last-Event-ID.
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function createEventsRouter(deps: EventsRouterDeps): Router {
  const router = Router();
  const { hub, memberships, workspaces, logger } = deps;

  router.use(requireAuth());

  /**
   * `requireWorkspaceContext` runs on this request like any other, which is
   * what satisfies "Authorization is rechecked when the stream begins": the
   * membership is read from the database at connect time, not taken from the
   * session, so a user removed a moment ago cannot open a stream.
   */
  router.get(
    '/',
    requireWorkspaceContext(memberships, workspaces),
    requireCapability('workspace.view'),
    async (request, response, next) => {
      try {
        const scope = request.workspaceScope;
        const user = request.currentUser;
        if (scope === undefined || user === undefined) {
          throw new ApiError(ERROR_CODES.NOT_FOUND, 'Not available');
        }
        const workspaceId = scope.workspaceId.toHexString();

        response.status(200);
        response.setHeader('content-type', 'text/event-stream; charset=utf-8');
        response.setHeader('cache-control', 'no-cache, no-transform');
        response.setHeader('connection', 'keep-alive');
        // Named explicitly because a proxy that buffers an event stream turns a
        // live feed into a very slow batch job.
        response.setHeader('x-accel-buffering', 'no');
        response.flushHeaders();

        response.write(`retry: ${String(RETRY_MS)}\n\n`);

        const unsubscribe = await hub.subscribe(workspaceId, (event) => {
          // `write` returning false means the socket buffer is full. Nothing is
          // dropped - Node queues it - and a client too slow to keep up is
          // handled by the connection closing, which the cleanup below sees.
          response.write(frame(event));
        });

        /**
         * Reconnect replay (blueprint 13.1: "a last-event cursor when
         * available"). The browser sends the id of the last event it saw; we
         * send anything newer that is still buffered. Subscribed BEFORE the
         * replay so an event arriving during it is not lost between the two.
         */
        const lastEventId = request.header('last-event-id');
        if (lastEventId !== undefined && lastEventId !== '') {
          for (const missed of hub.replaySince(workspaceId, lastEventId)) {
            response.write(frame(missed));
          }
        }

        /**
         * The heartbeat doubles as the revocation check.
         *
         * Blueprint 13.1: "workspace membership changes revoke future access."
         * An SSE connection can live for hours, so checking only at connect
         * time would let a removed member keep receiving a workspace's leads
         * indefinitely. Re-reading the membership on each heartbeat bounds that
         * exposure to one interval without needing a second message channel,
         * and it costs one indexed lookup per connection per 25 seconds.
         */
        const heartbeat = setInterval(() => {
          void (async () => {
            const role = await memberships.roleOf(scope, user._id);
            if (role === null) {
              logger.info('events.stream_revoked', {
                result: 'success',
                reason: 'membership_removed',
              });
              response.write('event: revoked\ndata: {"reason":"membership_removed"}\n\n');
              cleanup();
              response.end();
              return;
            }
            response.write(': heartbeat\n\n');
          })().catch(() => {
            // A failed check must not kill the process; the next tick retries,
            // and a genuinely broken connection is closed by the client.
          });
        }, HEARTBEAT_MS);

        let closed = false;
        const cleanup = (): void => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
        };

        request.on('close', cleanup);
        response.on('close', cleanup);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
