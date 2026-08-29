import { expect, test, uniqueEmail } from '../fixtures.js';
import {
  acceptAsNewUser,
  createOwnerWithWorkspace,
  invite,
  openInbox,
  publishWidgetForLeads,
  submitLead,
} from '../helpers/journeys.js';

/**
 * Automated accessibility checks for the contact inbox (blueprint 14.1: WCAG
 * 2.2 AA), matching the bar the auth, workspace, and widget surfaces already
 * meet.
 *
 * Empty, error, and conflict states are scanned as well as populated ones.
 * Those are where violations hide: a page gets built and reviewed with data in
 * it, and the state nobody looks at is the one that ships broken.
 */

test.describe('accessibility of the contact inbox', () => {
  test('the inbox, empty and populated, with filters open', async ({ page, checkA11y }) => {
    await createOwnerWithWorkspace(page, 'a11y-inbox');

    // The empty state, before a single lead exists.
    await openInbox(page);
    await expect(page.getByTestId('contacts-empty')).toBeVisible();
    await checkA11y(page);

    const publicId = await publishWidgetForLeads(page, 'a11y-inbox');
    await submitLead(page, publicId, {
      email: 'a11y-lead@example.invalid',
      name: 'Accessible Lead',
      message: 'Scanned by axe.',
    });

    await openInbox(page);
    await expect(page.getByTestId('contact-list')).toContainText('Accessible Lead');
    await checkA11y(page);

    // The filter disclosure open: nine controls that only exist when expanded.
    await page.getByTestId('filters-toggle').click();
    await expect(page.getByLabel('Domain')).toBeVisible();
    await checkA11y(page);

    // The bulk action bar, which only exists while rows are selected.
    await page.getByLabel('Select Accessible Lead').check();
    await expect(page.getByTestId('bulk-bar')).toBeVisible();
    await checkA11y(page);

    // The merge panel, which replaces the bulk bar.
    await submitLead(page, publicId, {
      email: 'a11y-second@example.invalid',
      name: 'Second Lead',
      message: 'Also scanned.',
    });
    await openInbox(page);
    await page.getByLabel('Select Accessible Lead').check();
    await page.getByLabel('Select Second Lead').check();
    await page.getByTestId('bulk-merge').click();
    await expect(page.getByTestId('merge-panel')).toBeVisible();
    await checkA11y(page);
  });

  test('the no-results empty state, which is a different message', async ({ page, checkA11y }) => {
    await createOwnerWithWorkspace(page, 'a11y-noresults');
    const publicId = await publishWidgetForLeads(page, 'a11y-noresults');
    await submitLead(page, publicId, {
      email: 'present@example.invalid',
      name: 'Present Lead',
      message: 'Here.',
    });

    await openInbox(page);
    await page.getByRole('searchbox', { name: 'Search' }).fill('nothingmatchesthisterm');
    await page.getByRole('searchbox', { name: 'Search' }).press('Enter');

    const empty = page.getByTestId('contacts-empty');
    await expect(empty).toBeVisible();
    // A filtered-to-nothing inbox must not say "no leads yet": that is a
    // different fact and points at the wrong fix.
    await expect(empty).toContainText('No leads match these filters');
    await checkA11y(page);
  });

  test('the lead detail page and its timeline', async ({ page, checkA11y }) => {
    await createOwnerWithWorkspace(page, 'a11y-detail');
    const publicId = await publishWidgetForLeads(page, 'a11y-detail');
    await submitLead(page, publicId, {
      email: 'detail@example.invalid',
      name: 'Detail Lead',
      message: 'A message in the timeline.',
    });

    await openInbox(page);
    await page.getByRole('link', { name: 'Detail Lead' }).click();
    await expect(page.getByTestId('timeline')).toBeVisible();
    await checkA11y(page);

    // With an activity entry beside the submission, so both timeline weights
    // are on screen when the scan runs.
    await page.getByLabel('Add a note').fill('A note, for the activity half.');
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByTestId('timeline-activity').first()).toBeVisible();
    await checkA11y(page);
  });

  test('the concurrency conflict state', async ({ page, browser, checkA11y }) => {
    await createOwnerWithWorkspace(page, 'a11y-conflict');
    const publicId = await publishWidgetForLeads(page, 'a11y-conflict');
    await submitLead(page, publicId, {
      email: 'a11y-conflict@example.invalid',
      name: 'Conflicted Lead',
      message: 'Two editors.',
    });

    const adminEmail = uniqueEmail('a11y-conflict-admin');
    const acceptUrl = await invite(page, adminEmail, 'Admin');
    const adminPage = await acceptAsNewUser(browser, acceptUrl, adminEmail);

    await openInbox(page);
    await page.getByRole('link', { name: 'Conflicted Lead' }).click();
    await openInbox(adminPage);
    await adminPage.getByRole('link', { name: 'Conflicted Lead' }).click();

    await adminPage.getByLabel('Company').fill('First Writer Ltd');
    await adminPage.getByRole('button', { name: 'Save details' }).click();
    await expect(adminPage.getByText('Details saved')).toBeVisible();

    await page.getByLabel('Company').fill('Second Writer Ltd');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByTestId('canonical-conflict')).toBeVisible();
    await checkA11y(page);

    await adminPage.close();
  });

  test('the trash, empty and populated', async ({ page, checkA11y }) => {
    await createOwnerWithWorkspace(page, 'a11y-trash');

    await page.goto('/workspace/contacts/trash');
    await expect(page.getByTestId('trash-empty')).toBeVisible();
    await checkA11y(page);

    const publicId = await publishWidgetForLeads(page, 'a11y-trash');
    await submitLead(page, publicId, {
      email: 'a11y-trash@example.invalid',
      name: 'Trashed Lead',
      message: 'Going in the bin.',
    });

    await openInbox(page);
    await page.getByRole('link', { name: 'Trashed Lead' }).click();
    await page.getByRole('button', { name: 'Move to trash' }).click();
    // Wait for the delete to land before navigating, or the goto races it and
    // the trash renders before the lead is in it.
    await expect(page).toHaveURL(/\/workspace\/contacts$/);

    await page.goto('/workspace/contacts/trash');
    await expect(page.getByTestId('trash-list')).toContainText('Trashed Lead');
    await checkA11y(page);
  });

  test('the inbox is fully operable from the keyboard', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'a11y-keyboard');
    const publicId = await publishWidgetForLeads(page, 'a11y-keyboard');
    await submitLead(page, publicId, {
      email: 'keyboard@example.invalid',
      name: 'Keyboard Lead',
      message: 'Reached without a mouse.',
    });

    await openInbox(page);

    // The search box is reachable by tabbing from the top of the page, and the
    // filter disclosure is a real summary element, so Enter toggles it.
    await page.getByRole('searchbox', { name: 'Search' }).focus();
    await expect(page.getByRole('searchbox', { name: 'Search' })).toBeFocused();

    await page.getByTestId('filters-toggle').press('Enter');
    await expect(page.getByLabel('Domain')).toBeVisible();

    // Selecting a row with the keyboard reveals the action bar.
    await page.getByLabel('Select Keyboard Lead').press('Space');
    await expect(page.getByTestId('bulk-bar')).toBeVisible();

    // And the lead opens from the keyboard.
    await page.getByRole('link', { name: 'Keyboard Lead' }).press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Keyboard Lead' })).toBeVisible();
  });
});
