import type Redis from 'ioredis';
import type { Logger, WorkspaceEvent, WorkspaceEventType } from '@lcp/contracts';
import type { RedisKeyBuilder } from './key-policy.js';

/**
 * Workspace event fan-out over Redis pub/sub (blueprint 13.1).
 *
 * "Redis pub/sub or streams provide a shared fan-out boundary even though
 * version 1 deploys one web process." Pub/sub is the choice here, and the
 * reason is the delivery model rather than convenience: SSE is a live feed of
 * what is happening NOW, and a subscriber that was not connected has no claim
 * on an event it missed. Streams would add durable retention this stage has no
 * consumer for, and a consumer-group lifecycle to manage per browser tab.
 *
 * The boundary matters even with one process. Publishing through Redis rather
 * than an in-process emitter means a second web process - or the Stage 9 worker
 * announcing a delivery status change - is already able to reach every
 * connected dashboard without anything here changing.
 *
 * A DEDICATED subscriber connection is required, not preferred: ioredis's
 * documentation is explicit that once a client issues `subscribe` it enters
 * subscriber mode, where only subscription commands are permitted. Sharing the
 * application's Redis client would break sessions, rate limits, and idempotency
 * the moment the first dashboard connected.
 */

export type EventListener = (event: WorkspaceEvent) => void;

/**
 * How many recent events each workspace keeps for reconnect replay.
 *
 * Blueprint 13.1: "Client reconnects with bounded backoff and a last-event
 * cursor when available." This buffer is what makes the cursor mean something.
 * It is process-local and deliberately small: it closes the sub-second gap of
 * an ordinary reconnect, and it does not pretend to be durable history. A
 * client that was away longer refetches the list, which is the correct
 * behaviour anyway after a real outage.
 */
export const REPLAY_BUFFER_SIZE = 50;

interface WorkspaceChannel {
  readonly listeners: Set<EventListener>;
  /** Newest last. */
  readonly recent: WorkspaceEvent[];
}

export class RedisEventHub {
  readonly #publisher: Redis;
  readonly #subscriber: Redis;
  readonly #keys: RedisKeyBuilder;
  readonly #logger: Logger;
  readonly #channels = new Map<string, WorkspaceChannel>();
  #sequence = 0;
  #closed = false;

  /**
   * @param publisher the ordinary application Redis client
   * @param subscriber a connection used ONLY for subscribing; callers normally
   *   pass `publisher.duplicate()`
   */
  constructor(publisher: Redis, subscriber: Redis, keys: RedisKeyBuilder, logger: Logger) {
    this.#publisher = publisher;
    this.#subscriber = subscriber;
    this.#keys = keys;
    this.#logger = logger;

    this.#subscriber.on('error', () => {
      this.#logger.warn('events.subscriber_error', { result: 'degraded' });
    });

    this.#subscriber.on('message', (channel: string, payload: string) => {
      this.#deliver(channel, payload);
    });
  }

  #channelFor(workspaceId: string): string {
    return this.#keys.channel('workspace', workspaceId);
  }

  /**
   * Publish an event to everyone watching a workspace.
   *
   * Never throws. A live update is a convenience on top of a committed write:
   * if Redis is unreachable, the contact still exists and the dashboard still
   * shows it on the next load. Letting a fan-out failure propagate would turn a
   * degraded feature into a failed submission.
   */
  async publish(
    workspaceId: string,
    type: WorkspaceEventType,
    data: Readonly<Record<string, unknown>>,
    occurredAt: Date,
  ): Promise<void> {
    if (this.#closed) return;
    this.#sequence += 1;
    const event: WorkspaceEvent = {
      id: `${String(Date.now())}-${String(this.#sequence)}`,
      type,
      occurredAt: occurredAt.toISOString(),
      data,
    };

    try {
      await this.#publisher.publish(this.#channelFor(workspaceId), JSON.stringify(event));
    } catch (error) {
      this.#logger.warn('events.publish_failed', {
        result: 'degraded',
        eventType: type,
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  /**
   * Start receiving a workspace's events.
   *
   * Returns an unsubscribe function. The Redis subscription is opened on the
   * first listener and closed when the last one leaves, so an idle server holds
   * no subscriptions.
   */
  async subscribe(workspaceId: string, listener: EventListener): Promise<() => void> {
    const channel = this.#channelFor(workspaceId);
    let entry = this.#channels.get(channel);

    if (entry === undefined) {
      entry = { listeners: new Set(), recent: [] };
      this.#channels.set(channel, entry);
      await this.#subscriber.subscribe(channel);
    }

    entry.listeners.add(listener);
    const current = entry;

    return () => {
      current.listeners.delete(listener);
      if (current.listeners.size === 0) {
        this.#channels.delete(channel);
        void this.#subscriber.unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  /**
   * Events newer than a client's last-seen id, for reconnect replay.
   *
   * Returns everything buffered when the id is unknown to us, which is the
   * conservative answer: showing a handful of events the client may already
   * have is recoverable, silently skipping ones it never saw is not.
   */
  replaySince(workspaceId: string, lastEventId: string): readonly WorkspaceEvent[] {
    const entry = this.#channels.get(this.#channelFor(workspaceId));
    if (entry === undefined) return [];
    const index = entry.recent.findIndex((event) => event.id === lastEventId);
    return index < 0 ? [...entry.recent] : entry.recent.slice(index + 1);
  }

  #deliver(channel: string, payload: string): void {
    const entry = this.#channels.get(channel);
    if (entry === undefined) return;

    let event: WorkspaceEvent;
    try {
      event = JSON.parse(payload) as WorkspaceEvent;
    } catch {
      // A malformed message is another publisher's bug, not a reason to drop
      // this process's stream.
      this.#logger.warn('events.malformed_message', { result: 'degraded' });
      return;
    }

    entry.recent.push(event);
    while (entry.recent.length > REPLAY_BUFFER_SIZE) entry.recent.shift();

    for (const listener of entry.listeners) {
      try {
        listener(event);
      } catch (error) {
        // One broken connection must not stop the others being told.
        this.#logger.warn('events.listener_failed', {
          result: 'degraded',
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#channels.clear();
    this.#subscriber.disconnect();
  }
}
