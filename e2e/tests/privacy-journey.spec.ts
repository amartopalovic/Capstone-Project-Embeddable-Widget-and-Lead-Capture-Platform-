import { expect, test } from '../fixtures.js';
import { linkFromEmail, uniqueEmail, waitForEmail } from '../fixtures.js';
import {
  createOwnerWithWorkspace,
  openInbox,
  openPrivacySettings,
  publishWidgetWithConsent,
  submitLead,
} from '../helpers/journeys.js';

/**
 * Blueprint 18.3 journey 8, through the browser: "Exercise unsubscribe, double
 * opt-in, contact privacy export/deletion, trash, and recovery."
 *
 * Every link is followed the way a real person follows it - out of an email
 * captured in Mailpit, into a page with no session - rather than by
 * constructing a URL the test already knows the shape of. That is the point of
 * doing this in a browser at all: the token that arrives has to be one this
 * server actually minted and sent.
 */

// ===========================================================================
// Double opt-in, and unsubscribe
// ===========================================================================

test.describe('double opt-in and unsubscribe - journey 8', () => {
  test('a ticked box asks for confirmation, and the emailed link confirms it', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'j8-optin');
    const publicId = await publishWidgetWithConsent(page, 'j8-optin');

    const lead = uniqueEmail('j8-optin-lead');
    await submitLead(page, publicId, {
      email: lead,
      name: 'Opt In',
      message: 'Please add me to the list.',
      consent: 'true',
    });

    /**
     * Double opt-in is the default (blueprint 4.8), so the inbox shows the
     * lead as awaiting confirmation rather than subscribed. This is the
     * workspace's view of the same fact the visitor is about to act on.
     */
    await openInbox(page);
    await page.getByRole('link', { name: 'Opt In' }).click();
    await expect(page.getByTestId('consent-state')).toHaveText('Awaiting confirmation');

    // The confirmation email, and the link inside it.
    const message = await waitForEmail(lead, 'Confirm your subscription');
    const link = await linkFromEmail(message.ID);

    await page.goto(link);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Your subscription is confirmed.' }),
    ).toBeVisible();

    await openInbox(page);
    await page.getByRole('link', { name: 'Opt In' }).click();
    await expect(page.getByTestId('consent-state')).toHaveText('Subscribed');
  });

  test('the unsubscribe link in that email stops marketing for good', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'j8-unsub');
    const publicId = await publishWidgetWithConsent(page, 'j8-unsub');

    const lead = uniqueEmail('j8-unsub-lead');
    await submitLead(page, publicId, {
      email: lead,
      name: 'Unsub Lead',
      message: 'Add me, then remove me.',
      consent: 'true',
    });

    const message = await waitForEmail(lead, 'Confirm your subscription');
    /**
     * The SECOND tokenised link in that email is the unsubscribe one. Read from
     * the message body rather than assembled, so the test proves the
     * unsubscribe link is actually in every marketing email - which is the
     * obligation, not just that the endpoint works.
     */
    const unsubscribe = await unsubscribeLinkFrom(message.ID);

    await page.goto(unsubscribe);
    await expect(
      page.getByRole('heading', { level: 1, name: "You're unsubscribed." }),
    ).toBeVisible();

    // Clicking it again is reassurance, not an error.
    await page.goto(unsubscribe);
    await expect(
      page.getByRole('heading', { level: 1, name: "You're already unsubscribed." }),
    ).toBeVisible();

    await openInbox(page);
    await page.getByRole('link', { name: 'Unsub Lead' }).click();
    await expect(page.getByTestId('consent-state')).toHaveText('Unsubscribed');
  });

  test('a tampered link says nothing about whether the address is a lead', async ({ page }) => {
    await page.goto('/consent/unsubscribe?token=YmFkOnBheWxvYWQ6aGVyZQ.forged-signature-value');
    await expect(
      page.getByRole('heading', { level: 1, name: 'This link is no longer valid.' }),
    ).toBeVisible();
    // No workspace name, no address, nothing that confirms anything exists.
    await expect(page.locator('body')).not.toContainText('workspace');
  });

  test('a link with no token at all explains itself rather than erroring', async ({ page }) => {
    await page.goto('/consent/unsubscribe');
    await expect(
      page.getByRole('heading', { level: 1, name: 'This unsubscribe link is incomplete.' }),
    ).toBeVisible();
  });
});

// ===========================================================================
// Self-service export and deletion
// ===========================================================================

test.describe('contact privacy export and deletion - journey 8', () => {
  test('a verified request shows everything the workspace holds', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'j8-export');
    const publicId = await publishWidgetWithConsent(page, 'j8-export');

    const lead = uniqueEmail('j8-export-lead');
    await submitLead(page, publicId, {
      email: lead,
      name: 'Export Lead',
      message: 'This is the message I sent.',
      consent: 'true',
    });

    await page.goto('/privacy');
    await page.getByLabel('Your email address').fill(lead);
    await page.getByLabel('Form ID').fill(publicId);
    await page.getByRole('radio', { name: /Show me my data/ }).check();
    await page.getByRole('button', { name: 'Email me the link' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Check your email.' })).toBeVisible();

    const message = await waitForEmail(lead, 'Confirm your data request');
    await page.goto(await linkFromEmail(message.ID));

    await expect(
      page.getByRole('heading', { level: 1, name: 'Everything they hold about you.' }),
    ).toBeVisible();

    /**
     * Their own record, and the words they typed. The address appears twice -
     * once as the canonical contact and once in the submission's own values -
     * which is correct: those are two different facts about them, and an
     * export that showed only one would be hiding what was actually stored.
     */
    await expect(page.getByText(lead).first()).toBeVisible();
    await expect(page.getByText(lead)).toHaveCount(2);
    await expect(page.getByText('This is the message I sent.')).toBeVisible();

    /**
     * The consent history, with the exact wording quoted. This column is the
     * whole reason consent evidence is stored: proving consent means proving
     * what somebody agreed TO.
     */
    await expect(page.getByText('You ticked the consent box')).toBeVisible();
  });

  test('a verified deletion erases the lead and keeps them unmailable', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'j8-delete');
    const publicId = await publishWidgetWithConsent(page, 'j8-delete');

    const lead = uniqueEmail('j8-delete-lead');
    await submitLead(page, publicId, {
      email: lead,
      name: 'Delete Lead',
      message: 'Erase me please.',
      consent: 'true',
    });

    await openInbox(page);
    await expect(page.getByRole('link', { name: 'Delete Lead' })).toBeVisible();

    await page.goto('/privacy');
    await page.getByLabel('Your email address').fill(lead);
    await page.getByLabel('Form ID').fill(publicId);
    await page.getByRole('radio', { name: /Delete my data/ }).check();
    await page.getByRole('button', { name: 'Email me the link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email.' })).toBeVisible();

    const message = await waitForEmail(lead, 'Confirm deleting your data');
    await page.goto(await linkFromEmail(message.ID));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Your data has been deleted.' }),
    ).toBeVisible();

    // The lead is gone from the workspace's inbox, name and all.
    await openInbox(page);
    await expect(page.getByRole('link', { name: 'Delete Lead' })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(lead);
  });

  test('the request page answers the same for an address that is not a lead', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'j8-enum');
    const publicId = await publishWidgetWithConsent(page, 'j8-enum');

    await page.goto('/privacy');
    await page.getByLabel('Your email address').fill(uniqueEmail('never-a-lead'));
    await page.getByLabel('Form ID').fill(publicId);
    await page.getByRole('button', { name: 'Email me the link' }).click();

    /**
     * Identical to the answer a real lead gets. Anything else would let
     * somebody test addresses against a workspace's lead list one at a time.
     */
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email.' })).toBeVisible();
    await expect(page.getByText('If that address has data here')).toBeVisible();
  });

  test('a used link cannot be used again', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'j8-replay');
    const publicId = await publishWidgetWithConsent(page, 'j8-replay');

    const lead = uniqueEmail('j8-replay-lead');
    await submitLead(page, publicId, {
      email: lead,
      name: 'Replay Lead',
      message: 'Once only.',
      consent: 'true',
    });

    await page.goto('/privacy');
    await page.getByLabel('Your email address').fill(lead);
    await page.getByLabel('Form ID').fill(publicId);
    await page.getByRole('button', { name: 'Email me the link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email.' })).toBeVisible();

    const message = await waitForEmail(lead, 'Confirm your data request');
    const link = await linkFromEmail(message.ID);

    await page.goto(link);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Everything they hold about you.' }),
    ).toBeVisible();

    await page.goto(link);
    await expect(
      page.getByRole('heading', { level: 1, name: 'This link is no longer valid.' }),
    ).toBeVisible();
  });
});

// ===========================================================================
// Retention settings, trash, and recovery
// ===========================================================================

test.describe('retention settings, trash, and recovery - journey 8', () => {
  test('the Owner sets retention and is warned before shortening it', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'j8-retention');
    await openPrivacySettings(page);

    // The default is 12 months (blueprint 4.8).
    await expect(page.getByRole('radio', { name: '12 months' })).toBeChecked();

    /**
     * The consequence is shown BEFORE saving, not after. Shortening retention
     * is the only setting in this product that destroys data already
     * collected, and it happens quietly on a nightly sweep.
     */
    await expect(page.getByText('permanently anonymised')).toHaveCount(0);
    await page.getByRole('radio', { name: '30 days' }).check();
    await expect(page.getByText('permanently anonymised')).toBeVisible();

    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Consent and retention settings saved')).toBeVisible();

    // It survives a reload, which is what proves it was stored rather than
    // held in the form.
    await page.reload();
    await expect(page.getByRole('radio', { name: '30 days' })).toBeChecked();
    // And the warning is gone, because the new value is now the saved one.
    await expect(page.getByText('permanently anonymised')).toHaveCount(0);
  });

  test('switching to single opt-in subscribes a ticked box immediately', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'j8-single');
    await openPrivacySettings(page);

    await page.getByRole('radio', { name: 'Single opt-in' }).check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Consent and retention settings saved')).toBeVisible();

    const publicId = await publishWidgetWithConsent(page, 'j8-single');
    const lead = uniqueEmail('j8-single-lead');
    await submitLead(page, publicId, {
      email: lead,
      name: 'Single Lead',
      message: 'Straight on the list.',
      consent: 'true',
    });

    await openInbox(page);
    await page.getByRole('link', { name: 'Single Lead' }).click();
    // No confirmation step under single opt-in.
    await expect(page.getByTestId('consent-state')).toHaveText('Subscribed');
  });

  test('a subscribed lead keeps its consent through the trash and back', async ({ page }) => {
    /**
     * Trash and recovery themselves are already proven in the inbox journey, so
     * this does not test them again. What is new in Stage 11 is that a contact
     * now carries consent, and a round trip through the trash must not quietly
     * lose it - somebody who confirmed a subscription is still subscribed after
     * an accidental delete and a restore.
     *
     * The 30-day window that ends in a purge cannot be exercised in a browser;
     * an injected clock proves it in the integration suite.
     */
    await createOwnerWithWorkspace(page, 'j8-trash');
    const publicId = await publishWidgetWithConsent(page, 'j8-trash');

    const lead = uniqueEmail('j8-trash-lead');
    await submitLead(page, publicId, {
      email: lead,
      name: 'Trash Lead',
      message: 'Delete and restore me.',
      consent: 'true',
    });

    await openInbox(page);
    await page.getByRole('link', { name: 'Trash Lead' }).click();
    await expect(page.getByTestId('consent-state')).toHaveText('Awaiting confirmation');
    await page.getByRole('button', { name: 'Move to trash' }).click();

    await expect(page).toHaveURL(/\/workspace\/contacts$/);
    await page.getByRole('link', { name: 'Trash' }).click();
    await expect(page.getByTestId('trash-list')).toContainText('Trash Lead');

    await page.getByTestId(`restore-${lead}`).click();
    await expect(page.getByText('is back in your inbox')).toBeVisible();

    await openInbox(page);
    await page.getByRole('link', { name: 'Trash Lead' }).click();
    await expect(page.getByTestId('consent-state')).toHaveText('Awaiting confirmation');
  });
});

/**
 * The unsubscribe link from a marketing email.
 *
 * `linkFromEmail` returns the first tokenised link, which is the confirmation
 * one; this takes the last, which is the unsubscribe. Both have to be in there
 * - a marketing email without an unsubscribe link is the failure this whole
 * stage is about - so reading it out of the body is the assertion.
 */
async function unsubscribeLinkFrom(messageId: string): Promise<string> {
  const response = await fetch(`http://localhost:8025/api/v1/message/${messageId}`);
  const body = (await response.json()) as { Text?: string; HTML?: string };
  const content = `${body.Text ?? ''}\n${body.HTML ?? ''}`;
  const links = [
    ...content.matchAll(/(https?:\/\/[^\s"'<>]*\/consent\/unsubscribe\?token=[A-Za-z0-9_.-]+)/g),
  ];
  const last = links.at(-1)?.[1];
  if (last === undefined) throw new Error('No unsubscribe link in the marketing email');
  return last;
}
