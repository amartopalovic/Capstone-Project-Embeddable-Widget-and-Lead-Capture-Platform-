import type { DeliveryType } from '@lcp/database';

/**
 * Idempotency keys for side effects (blueprint 12.2).
 *
 * "Every job has a stable idempotency key, so retries do not send duplicate
 * logical notifications."
 *
 * Two properties matter, and they pull in opposite directions:
 *
 *  - **stable**, so the same logical notification computes the same key however
 *    many times it is derived - on the original enqueue, on a queue retry, and
 *    on an outbox reconciliation sweep that cannot know whether the first
 *    enqueue happened;
 *  - **distinct**, so two genuinely different notifications never collide. The
 *    same submission emailed to two recipients is TWO notifications, and a key
 *    that ignored the recipient would silently send only the first.
 *
 * So the key is built from the submission plus whatever distinguishes this
 * delivery from its siblings, and never from a timestamp or a random value -
 * either of those would make a retry look like new work, which is exactly the
 * duplicate the rule exists to prevent.
 */

function normalize(part: string): string {
  return part.trim().toLowerCase().replace(/\s+/g, '-');
}

export function notificationKey(submissionEventId: string, recipientEmail: string): string {
  return `notify:${submissionEventId}:${normalize(recipientEmail)}`;
}

export function confirmationKey(submissionEventId: string): string {
  // One visitor, one submission, one confirmation - the recipient is implied.
  return `confirm:${submissionEventId}`;
}

export function webhookKey(submissionEventId: string, endpointId: string): string {
  return `hook:${submissionEventId}:${endpointId}`;
}

/**
 * The key for a manual replay.
 *
 * A replay is DELIBERATE new work: an operator looked at a dead letter and
 * asked for it to be tried again. Reusing the original key would make the
 * unique index refuse it, so the replay carries its own key derived from the
 * delivery it replays plus the attempt number. That keeps replays idempotent
 * among themselves - pressing the button twice on the same row produces the
 * same key - without the original's success blocking a retry of a failure.
 */
export function replayKey(deliveryId: string, replayNumber: number): string {
  return `replay:${deliveryId}:${String(replayNumber)}`;
}

/** The outbox row's key, matching what Stage 7's submission path writes. */
export function outboxKey(submissionEventId: string): string {
  return `submission:${submissionEventId}`;
}

/** A stable BullMQ job id, so the queue itself refuses an obvious duplicate. */
export function jobId(type: DeliveryType, idempotencyKey: string): string {
  return `${type}:${idempotencyKey}`;
}

/**
 * Mask an address for display and logging.
 *
 * Delivery rows are shown in a dashboard and written to logs, and blueprint
 * 9.4 forbids emails in logs. Enough survives to recognise a recipient you
 * configured; not enough to harvest one you did not.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(2, local.length - 1))}@${domain}`;
}
