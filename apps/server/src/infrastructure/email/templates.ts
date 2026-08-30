import type { OutboundEmail } from '../../ports/email-sender.js';

/**
 * Auth email bodies.
 *
 * Plain, allowlisted content with no customer-supplied HTML (blueprint
 * section 12.3 forbids arbitrary HTML). The only interpolated value is a URL
 * this server built itself.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout(heading: string, body: string, actionUrl: string, actionLabel: string): string {
  const safeUrl = escapeHtml(actionUrl);
  return [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">',
    `<h1 style="font-size:20px">${escapeHtml(heading)}</h1>`,
    `<p>${escapeHtml(body)}</p>`,
    `<p><a href="${safeUrl}">${escapeHtml(actionLabel)}</a></p>`,
    `<p style="color:#666;font-size:13px">If the link does not work, copy this address into your browser:<br>${safeUrl}</p>`,
    '<p style="color:#666;font-size:13px">If you did not request this, you can ignore this email.</p>',
    '</body></html>',
  ].join('');
}

export function verificationEmail(to: string, verifyUrl: string): OutboundEmail {
  const heading = 'Confirm your email address';
  const body = 'Confirm this address to finish setting up your Lead Capture account.';
  return {
    to,
    subject: heading,
    priority: 'critical',
    text: `${heading}\n\n${body}\n\n${verifyUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: layout(heading, body, verifyUrl, 'Confirm email address'),
  };
}

export function passwordResetEmail(to: string, resetUrl: string): OutboundEmail {
  const heading = 'Reset your password';
  const body =
    'Use the link below to choose a new password. It expires in one hour and can be used once.';
  return {
    to,
    subject: heading,
    priority: 'critical',
    text: `${heading}\n\n${body}\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: layout(heading, body, resetUrl, 'Choose a new password'),
  };
}

export function passwordChangedEmail(to: string, appUrl: string): OutboundEmail {
  const heading = 'Your password was changed';
  const body =
    'The password on your Lead Capture account was just changed, and all other sessions were signed out.';
  return {
    to,
    subject: heading,
    priority: 'critical',
    text: `${heading}\n\n${body}\n\n${appUrl}`,
    html: layout(heading, body, appUrl, 'Open Lead Capture'),
  };
}

export function invitationEmail(
  to: string,
  workspaceName: string,
  inviterEmail: string,
  acceptUrl: string,
): OutboundEmail {
  const heading = `Join ${workspaceName} on Lead Capture`;
  const body = `${inviterEmail} invited you to collaborate on ${workspaceName}. This invitation expires in 7 days and can be used once.`;
  return {
    to,
    subject: heading,
    // Invitations are account-critical rather than a marketing side effect, so
    // they draw on the reserved allowance (blueprint 5.3).
    priority: 'critical',
    text: `${heading}

${body}

${acceptUrl}

If you did not expect this, you can ignore this email.`,
    html: layout(heading, body, acceptUrl, 'Accept invitation'),
  };
}

// ---------------------------------------------------------------------------
// Consent and privacy - Stage 11 (blueprint 4.8, 5.3)
// ---------------------------------------------------------------------------

/**
 * The double opt-in confirmation (blueprint 4.8).
 *
 * `side_effect` priority, deliberately. Blueprint 5.3 reserves 100 messages a
 * day for "authentication and privacy-critical flows", and asking somebody to
 * confirm a marketing subscription is neither - if the allowance is tight, this
 * is exactly the mail that should wait. The privacy REQUEST email below is the
 * opposite case and is marked critical.
 */
export function optInConfirmationEmail(
  to: string,
  workspaceName: string,
  confirmUrl: string,
  unsubscribeUrl: string,
): OutboundEmail {
  const heading = 'Confirm your subscription';
  const body = `You asked to hear from ${workspaceName}. Confirm this address and you are on the list. If you do not confirm, nothing further will be sent.`;
  return {
    to,
    subject: heading,
    priority: 'side_effect',
    text: `${heading}

${body}

${confirmUrl}

Not you? Ignore this email, or unsubscribe: ${unsubscribeUrl}`,
    html: `${layout(heading, body, confirmUrl, 'Confirm subscription')}`.replace(
      '</body></html>',
      `<p style="color:#666;font-size:13px"><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p></body></html>`,
    ),
  };
}

/**
 * The verification link for a self-service export or deletion (blueprint 4.8).
 *
 * `critical`: 5.3 names "privacy-critical flows" alongside authentication as
 * the reserved allowance, and somebody exercising a data right should not be
 * queued behind marketing.
 */
export function privacyRequestEmail(
  to: string,
  workspaceName: string,
  kind: 'export' | 'deletion',
  confirmUrl: string,
): OutboundEmail {
  const heading = kind === 'export' ? 'Confirm your data request' : 'Confirm deleting your data';
  const body =
    kind === 'export'
      ? `Confirm this address and we will show you everything ${workspaceName} holds about you. The link expires in 24 hours and works once.`
      : `Confirm this address and ${workspaceName} will permanently delete your data. This cannot be undone. The link expires in 24 hours and works once.`;
  return {
    to,
    subject: heading,
    priority: 'critical',
    text: `${heading}

${body}

${confirmUrl}

If you did not request this, ignore this email and nothing will happen.`,
    html: layout(heading, body, confirmUrl, kind === 'export' ? 'Show my data' : 'Delete my data'),
  };
}
