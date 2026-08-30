import { expect, test } from '../fixtures.js';
import { linkFromEmail, uniqueEmail, waitForEmail } from '../fixtures.js';
import {
  createOwnerWithWorkspace,
  openPrivacySettings,
  publishWidgetWithConsent,
  submitLead,
} from '../helpers/journeys.js';

/**
 * Accessibility of the consent and privacy surface (blueprint 14.1: WCAG 2.2 AA).
 *
 * These pages carry a heavier obligation than the rest of the product, and the
 * reason is worth stating. Everywhere else the audience is a customer who chose
 * this tool and can ask for help; here it is a stranger exercising a data right,
 * on a page they did not choose, with no account and nobody to ask. If an
 * unsubscribe is unusable with a screen reader, the person cannot opt out at
 * all - there is no second route.
 *
 * So every state is scanned, including the ones that only appear when something
 * has gone wrong.
 */

test.describe('accessibility of the consent and privacy pages', () => {
  test('the unsubscribe page, in both its outcomes', async ({ page, checkA11y }) => {
    await createOwnerWithWorkspace(page, 'a11y-unsub');
    const publicId = await publishWidgetWithConsent(page, 'a11y-unsub');

    const lead = uniqueEmail('a11y-unsub-lead');
    await submitLead(page, publicId, {
      email: lead,
      name: 'A11y Unsub',
      message: 'Scan me.',
      consent: 'true',
    });

    const message = await waitForEmail(lead, 'Confirm your subscription');
    const unsubscribe = await unsubscribeLinkFrom(message.ID);

    await page.goto(unsubscribe);
    await expect(
      page.getByRole('heading', { level: 1, name: "You're unsubscribed." }),
    ).toBeVisible();
    await checkA11y(page);

    // The second-click state, which is a different page and a different tone.
    await page.goto(unsubscribe);
    await expect(
      page.getByRole('heading', { level: 1, name: "You're already unsubscribed." }),
    ).toBeVisible();
    await checkA11y(page);
  });

  test('the confirmation page, and the invalid-link state', async ({ page, checkA11y }) => {
    await createOwnerWithWorkspace(page, 'a11y-confirm');
    const publicId = await publishWidgetWithConsent(page, 'a11y-confirm');

    const lead = uniqueEmail('a11y-confirm-lead');
    await submitLead(page, publicId, {
      email: lead,
      name: 'A11y Confirm',
      message: 'Scan me too.',
      consent: 'true',
    });

    const message = await waitForEmail(lead, 'Confirm your subscription');
    await page.goto(await linkFromEmail(message.ID));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Your subscription is confirmed.' }),
    ).toBeVisible();
    await checkA11y(page);

    /**
     * The refused state. Scanned deliberately: an error page is the one a
     * frustrated person reads most carefully, and it is the state most likely
     * to have been styled without being checked.
     */
    await page.goto('/consent/confirm?token=YmFkOnBheWxvYWQ.forged-signature');
    await expect(
      page.getByRole('heading', { level: 1, name: 'This link is no longer valid.' }),
    ).toBeVisible();
    await checkA11y(page);
  });

  test('the privacy request form, its error state, and the export', async ({ page, checkA11y }) => {
    await createOwnerWithWorkspace(page, 'a11y-privacy');
    const publicId = await publishWidgetWithConsent(page, 'a11y-privacy');

    const lead = uniqueEmail('a11y-privacy-lead');
    await submitLead(page, publicId, {
      email: lead,
      name: 'A11y Privacy',
      message: 'Everything about me.',
      consent: 'true',
    });

    await page.goto('/privacy');
    await expect(
      page.getByRole('heading', { level: 1, name: 'See or delete your data.' }),
    ).toBeVisible();
    await checkA11y(page);

    // A rejected submission, so the error alert is in the tree when scanned.
    await page.getByLabel('Your email address').fill('not-an-address');
    await page.getByLabel('Form ID').fill('nope');
    await page.getByRole('button', { name: 'Email me the link' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await checkA11y(page);

    // The real thing, through to the export.
    await page.getByLabel('Your email address').fill(lead);
    await page.getByLabel('Form ID').fill(publicId);
    await page.getByRole('button', { name: 'Email me the link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email.' })).toBeVisible();
    await checkA11y(page);

    const message = await waitForEmail(lead, 'Confirm your data request');
    await page.goto(await linkFromEmail(message.ID));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Everything they hold about you.' }),
    ).toBeVisible();
    await checkA11y(page);
  });

  test('the export reads as a record, not a data dump', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'a11y-export-semantics');
    const publicId = await publishWidgetWithConsent(page, 'a11y-export-semantics');

    const lead = uniqueEmail('a11y-export-lead');
    await submitLead(page, publicId, {
      email: lead,
      name: 'Semantic Lead',
      message: 'Structured, please.',
      consent: 'true',
    });

    await page.goto('/privacy');
    await page.getByLabel('Your email address').fill(lead);
    await page.getByLabel('Form ID').fill(publicId);
    await page.getByRole('button', { name: 'Email me the link' }).click();
    const message = await waitForEmail(lead, 'Confirm your data request');
    await page.goto(await linkFromEmail(message.ID));

    /**
     * Each section is a landmark with its own name, so somebody navigating by
     * region can jump straight to the part they care about rather than reading
     * a wall of pairs. If these were plain divs, none of this would resolve.
     */
    await expect(page.getByRole('region', { name: 'Your details' })).toBeVisible();
    await expect(page.getByRole('region', { name: /^What you sent/ })).toBeVisible();
    await expect(page.getByRole('region', { name: /^Consent history/ })).toBeVisible();

    // The consent history is a real table with a caption, not a styled list.
    const history = page.getByRole('table');
    await expect(history.getByRole('columnheader', { name: 'When' })).toBeVisible();
    await expect(
      history.getByRole('columnheader', { name: 'The wording you were shown' }),
    ).toBeVisible();
  });

  test('the consent and retention settings are operable from the keyboard', async ({
    page,
    checkA11y,
  }) => {
    await createOwnerWithWorkspace(page, 'a11y-settings');
    await openPrivacySettings(page);
    await checkA11y(page);

    /**
     * A real radio group, so arrow keys move within it and Space selects -
     * nothing was reimplemented to get that. The warning it reveals has to be
     * reachable the same way, since it is the whole point of the control.
     */
    const thirty = page.getByRole('radio', { name: '30 days' });
    await thirty.focus();
    await expect(thirty).toBeFocused();
    await page.keyboard.press('Space');
    await expect(thirty).toBeChecked();

    const warning = page.getByRole('alert');
    await expect(warning).toContainText('permanently anonymised');
    // Scanned again with the warning present: it is a state, not a decoration.
    await checkA11y(page);
  });
});

/** The unsubscribe link out of a marketing email, which every one must carry. */
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
