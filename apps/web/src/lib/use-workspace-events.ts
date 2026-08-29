import { useEffect, useRef } from 'react';
import { API_PREFIX, type WorkspaceEvent, type WorkspaceEventType } from '@lcp/contracts';

/**
 * Subscribe to the workspace's live event stream (blueprint 13.1).
 *
 * Built on the browser's own `EventSource`, which is not laziness - it is what
 * gets two of the blueprint's requirements for free and correctly:
 *
 *  - **reconnect with a last-event cursor.** EventSource remembers the last
 *    `id:` it received and sends it back as `Last-Event-ID` on reconnect, which
 *    is exactly the cursor the Stage 8a stream replays from. Hand-rolling this
 *    over `fetch` would mean tracking that id manually and getting it wrong on
 *    the first partially-delivered frame.
 *  - **the retry interval.** The server sends `retry:`, so the delay between
 *    ordinary reconnects is a SERVER decision applied by every client
 *    identically, rather than each client inventing its own.
 *
 * What EventSource does not do is give up gracefully. It retries a transient
 * drop on its own (readyState returns to CONNECTING), but on a hard failure -
 * the stream refused because membership was revoked, say - it sets readyState
 * to CLOSED and stops. That case needs the bounded backoff blueprint 13.1 asks
 * for, so this hook adds one layer: on a CLOSED socket it reopens after a delay
 * that doubles up to a cap, and stops entirely after a handful of attempts.
 * Without the cap a revoked member's browser would sit in a reconnect loop
 * against an endpoint that will never accept it again.
 */

const INITIAL_RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;
/** After this many consecutive hard failures, stop and let the page reload. */
const MAX_ATTEMPTS = 6;

export type WorkspaceEventHandler = (event: WorkspaceEvent) => void;

export interface UseWorkspaceEventsOptions {
  /** Event names to listen for. */
  readonly types: readonly WorkspaceEventType[];
  readonly onEvent: WorkspaceEventHandler;
  /** Set false to leave the stream closed, e.g. while the page is loading. */
  readonly enabled?: boolean;
}

export function useWorkspaceEvents({
  types,
  onEvent,
  enabled = true,
}: UseWorkspaceEventsOptions): void {
  /**
   * The handler is held in a ref rather than listed as an effect dependency.
   *
   * A page's handler closes over its current rows, so it is a new function on
   * every render; depending on it would tear the stream down and reopen it on
   * every keystroke - and each reopen is a fresh authorization check and a
   * fresh replay. The ref keeps one long-lived connection calling the latest
   * handler.
   */
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  const typeKey = [...types].sort().join(',');

  useEffect(() => {
    if (!enabled) return;

    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let stopped = false;

    const open = (): void => {
      if (stopped) return;
      source = new EventSource(`${API_PREFIX}/events`, { withCredentials: true });

      source.onopen = () => {
        // A successful connection clears the backoff, so a long-lived session
        // that drops once an hour never accumulates its way to the cap.
        attempts = 0;
      };

      for (const type of typeKey.split(',')) {
        if (type === '') continue;
        source.addEventListener(type, (message: MessageEvent<string>) => {
          try {
            handlerRef.current(JSON.parse(message.data) as WorkspaceEvent);
          } catch {
            // A frame we cannot parse is another publisher's problem; dropping
            // it must not take the stream down.
          }
        });
      }

      source.onerror = () => {
        // Still CONNECTING means EventSource is handling it. Only a CLOSED
        // socket is ours to deal with.
        if (source === null || source.readyState !== EventSource.CLOSED) return;
        source.close();
        source = null;

        attempts += 1;
        if (attempts > MAX_ATTEMPTS) {
          stopped = true;
          return;
        }
        const delay = Math.min(INITIAL_RETRY_MS * 2 ** (attempts - 1), MAX_RETRY_MS);
        timer = setTimeout(open, delay);
      };
    };

    open();

    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      source?.close();
    };
  }, [enabled, typeKey]);
}
