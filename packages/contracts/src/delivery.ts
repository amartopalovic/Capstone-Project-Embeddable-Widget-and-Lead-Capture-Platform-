/**
 * Delivery operations contracts (blueprint 12.1-12.4, 16.4).
 *
 * The workspace-level delivery health surface and the settings that feed it.
 * The platform-operator-only diagnostics from 16.4 are a later stage; what is
 * here is the half a customer sees about their own workspace.
 */

import * as z from 'zod';
import { emailSchema } from './auth.js';

export const DELIVERY_TYPE_VALUES = [
  'workspace_notification',
  'visitor_confirmation',
  'webhook',
] as const;
export type DeliveryTypeValue = (typeof DELIVERY_TYPE_VALUES)[number];

export const DELIVERY_STATUS_VALUES = [
  'queued',
  'delayed',
  'retrying',
  'delivered',
  'failed',
  'dead_letter',
] as const;
export type DeliveryStatusValue = (typeof DELIVERY_STATUS_VALUES)[number];

/** Human wording for each state, so the UI and the docs agree. */
export const DELIVERY_STATUS_LABELS: Readonly<Record<DeliveryStatusValue, string>> = {
  queued: 'Queued',
  delayed: 'Waiting to retry',
  retrying: 'Sending',
  delivered: 'Delivered',
  failed: 'Rejected',
  dead_letter: 'Gave up',
};

export const DELIVERY_TYPE_LABELS: Readonly<Record<DeliveryTypeValue, string>> = {
  workspace_notification: 'Team notification',
  visitor_confirmation: 'Visitor confirmation',
  webhook: 'Webhook',
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface DeliveryAttemptSummary {
  readonly attempt: number;
  readonly at: string;
  readonly outcome: string;
  readonly detail: string;
  readonly statusCode: number | null;
}

export interface DeliverySummary {
  readonly id: string;
  readonly type: DeliveryTypeValue;
  readonly status: DeliveryStatusValue;
  /** Masked recipient or webhook host - never a full address. */
  readonly target: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: string | null;
  readonly deliveredAt: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly contactId: string | null;
  readonly history: readonly DeliveryAttemptSummary[];
  /** Server-decided: only a dead letter is worth replaying. */
  readonly canReplay: boolean;
}

export interface DeliveryHealth {
  readonly counts: Readonly<Record<DeliveryStatusValue, number>>;
  readonly byType: Readonly<Record<DeliveryTypeValue, number>>;
  readonly deliveries: readonly DeliverySummary[];
  /** Brevo's daily allowance, so a deferred email explains itself (5.3). */
  readonly emailBudget: {
    readonly usedToday: number;
    readonly sideEffectUsedToday: number;
    readonly dailyLimit: number;
    readonly sideEffectLimit: number;
  };
  readonly canManage: boolean;
}

export const deliveryQuerySchema = z.object({
  status: z.enum(DELIVERY_STATUS_VALUES).optional(),
  type: z.enum(DELIVERY_TYPE_VALUES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type DeliveryQuery = z.infer<typeof deliveryQuerySchema>;

// ---------------------------------------------------------------------------
// Webhook endpoints
// ---------------------------------------------------------------------------

export interface WebhookEndpointSummary {
  readonly id: string;
  readonly url: string;
  readonly widgetId: string | null;
  readonly enabled: boolean;
  readonly secretVersion: number;
  /** True while a rotated-out secret is still accepted (blueprint 12.4). */
  readonly rotationInProgress: boolean;
  readonly previousSecretRetiresAt: string | null;
  readonly lastRotatedAt: string | null;
  readonly createdAt: string;
}

export const createWebhookSchema = z.object({
  url: z.url({ message: 'Enter a full URL, including https://' }).max(2048),
  /** Null or absent means every widget in the workspace. */
  widgetId: z
    .string()
    .regex(/^[0-9a-f]{24}$/)
    .nullable()
    .optional(),
});
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z.object({
  enabled: z.boolean().optional(),
});

/**
 * The plaintext secret is returned exactly once, on creation and on rotation.
 *
 * It is encrypted at rest and there is no endpoint that reveals it again -
 * a "show secret" button would turn every read of the settings page into a
 * chance to leak it (blueprint 12.4, 17).
 */
export interface WebhookSecretReveal {
  readonly endpoint: WebhookEndpointSummary;
  readonly secret: string;
  readonly notice: string;
}

// ---------------------------------------------------------------------------
// Notification recipients (blueprint 12.3)
// ---------------------------------------------------------------------------

export interface RecipientSummary {
  readonly id: string;
  readonly email: string;
  readonly kind: 'workspace_user' | 'external';
  readonly verified: boolean;
  readonly createdAt: string;
}

export const addRecipientSchema = z.object({
  email: emailSchema,
});

// ---------------------------------------------------------------------------
// Notification template (blueprint 12.3)
// ---------------------------------------------------------------------------

export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 2000;

/** Rejects anything that opens a tag: 12.3 forbids arbitrary HTML outright. */
const noMarkup = (value: string): boolean => !/<[a-zA-Z/!]/.test(value);

export const notificationTemplateSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(1)
    .max(MAX_SUBJECT_LENGTH)
    .refine(noMarkup, { message: 'HTML is not allowed here' }),
  body: z
    .string()
    .trim()
    .min(1)
    .max(MAX_BODY_LENGTH)
    .refine(noMarkup, { message: 'HTML is not allowed here' }),
  replyTo: z.union([emailSchema, z.literal('')]).optional(),
  brandName: z
    .string()
    .trim()
    .max(80)
    .refine(noMarkup, { message: 'HTML is not allowed here' })
    .optional(),
});
export type NotificationTemplateInput = z.infer<typeof notificationTemplateSchema>;

export interface NotificationSettings {
  readonly template: NotificationTemplateInput;
  readonly recipients: readonly RecipientSummary[];
  /** Every placeholder a template may use, so the UI can list them. */
  readonly availableVariables: readonly string[];
  readonly confirmationEnabled: boolean;
}

export const updateNotificationSettingsSchema = z.object({
  template: notificationTemplateSchema.optional(),
  confirmationEnabled: z.boolean().optional(),
});
