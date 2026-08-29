/**
 * Canonical collection names.
 *
 * Referenced by migrations, indexes, and repositories so a rename is a one-line
 * change rather than a string hunt.
 */

export const COLLECTIONS = {
  users: 'users',
  workspaces: 'workspaces',
  memberships: 'memberships',
  invitations: 'invitations',
  widgets: 'widgets',
  widgetRevisions: 'widget_revisions',
  contacts: 'contacts',
  contactActivities: 'contact_activities',
  submissionEvents: 'submission_events',
  consentEvents: 'consent_events',
  abuseEvents: 'abuse_events',
  auditEvents: 'audit_events',
  outboxEvents: 'outbox_events',
  deliveries: 'deliveries',
  webhookEndpoints: 'webhook_endpoints',
  notificationRecipients: 'notification_recipients',
  migrations: 'migrations',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
