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
 * Blueprint 18.3, journeys 5 and 6 - driven through the real UI against the
 * real stack:
 *
 *   5. "See the Contact arrive live through SSE."
 *   6. "Change workflow state as Member; verify forbidden publish/export/delete
 *      actions."
 *
 * This file closes blueprint Stage 8's exit gate through the browser, the way
 * 4b and 5b closed Stages 4 and 5. Stage 8a already proved the server refuses
 * the wrong caller; what matters here is that the interface never offers a
 * control it would then be refused for, that the export downloads what the
 * screen is showing, and that a live arrival reaches only its own workspace.
 */

// ===========================================================================
// GATE 1 - role-aware journeys
// ===========================================================================

test.describe('GATE 1: role-aware inbox - EXIT GATE', () => {
  test('a Member works a lead but is never shown export, merge, or delete', async ({
    page,
    browser,
  }) => {
    await createOwnerWithWorkspace(page, 'inbox-member');
    const publicId = await publishWidgetForLeads(page, 'inbox-member');
    await submitLead(page, publicId, {
      email: 'member-lead@example.invalid',
      name: 'Mary Member-Lead',
      message: 'Please call me back.',
    });

    const memberEmail = uniqueEmail('inbox-member-user');
    const acceptUrl = await invite(page, memberEmail, 'Member');
    const memberPage = await acceptAsNewUser(browser, acceptUrl, memberEmail);

    await openInbox(memberPage);
    await expect(memberPage.getByTestId('contact-list')).toContainText('Mary Member-Lead');

    /**
     * Blueprint 4.7 gives a Member status, assign, and tag - and nothing else.
     * These controls are ABSENT rather than disabled: an action a role may
     * never take should not be presented at all, which is the same treatment
     * the audit-log link gets in the workspace bar.
     */
    await expect(memberPage.getByTestId('export-csv')).toHaveCount(0);
    await expect(memberPage.getByRole('link', { name: 'Trash' })).toHaveCount(0);

    await memberPage.getByLabel('Select Mary Member-Lead').check();
    const bulkBar = memberPage.getByTestId('bulk-bar');
    await expect(bulkBar).toBeVisible();
    await expect(memberPage.getByTestId('bulk-delete')).toHaveCount(0);
    await expect(memberPage.getByTestId('bulk-merge')).toHaveCount(0);

    // What a Member CAN do, done through the UI.
    await bulkBar.getByLabel('Set status').selectOption('qualified');
    await expect(memberPage.getByText('1 contact updated')).toBeVisible();
    /*
     * The selection SURVIVES a bulk action whose rows are still present, so the
     * bar stays and a second action can be applied to the same set. Only a row
     * that left the list - a soft-delete - drops out of the selection.
     */
    await expect(bulkBar).toBeVisible();
    // Scoped to the list: the same chip is also used as a filter label inside
    // the (collapsed but still rendered) filter panel.
    await expect(
      memberPage.getByTestId('contact-list').getByTestId('contact-status-qualified'),
    ).toBeVisible();

    // And on the detail page: workflow yes, canonical edit no.
    await memberPage.getByRole('link', { name: 'Mary Member-Lead' }).click();
    await expect(memberPage.getByRole('heading', { level: 2, name: 'Workflow' })).toBeVisible();
    await expect(memberPage.getByRole('heading', { level: 2, name: 'Details' })).toHaveCount(0);
    await expect(memberPage.getByRole('button', { name: 'Move to trash' })).toHaveCount(0);

    await memberPage.getByLabel('Add a tag').fill('callback');
    await memberPage.getByRole('button', { name: 'Add tag' }).click();
    await expect(memberPage.getByText('Added the tag "callback"')).toBeVisible();

    await memberPage.getByLabel('Add a note').fill('Left a voicemail on Tuesday.');
    await memberPage.getByRole('button', { name: 'Add note' }).click();
    await expect(memberPage.getByText('Note added')).toBeVisible();
    await expect(memberPage.getByTestId('timeline')).toContainText('Left a voicemail on Tuesday.');

    await memberPage.close();
  });

  test('an Owner sees the full action set the Member was refused', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'inbox-owner');
    const publicId = await publishWidgetForLeads(page, 'inbox-owner');
    await submitLead(page, publicId, {
      email: 'owner-lead@example.invalid',
      name: 'Oscar Owner-Lead',
      message: 'Pricing question.',
    });

    await openInbox(page);
    await expect(page.getByTestId('export-csv')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Trash' })).toBeVisible();

    await page.getByLabel('Select Oscar Owner-Lead').check();
    await expect(page.getByTestId('bulk-delete')).toBeVisible();

    await page.getByRole('link', { name: 'Oscar Owner-Lead' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Details' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Move to trash' })).toBeVisible();
  });
});

// ===========================================================================
// Canonical edits and the concurrency conflict
// ===========================================================================

test.describe('canonical edits', () => {
  test('an edit is saved, marked as edited, and survives a later submission', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'inbox-edit');
    const publicId = await publishWidgetForLeads(page, 'inbox-edit');
    await submitLead(page, publicId, {
      email: 'typo@example.invalid',
      name: 'Tpyo Nmae',
      message: 'First enquiry.',
    });

    await openInbox(page);
    await page.getByRole('link', { name: 'Tpyo Nmae' }).click();

    await page.getByLabel('Name').fill('Correct Name');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Details saved')).toBeVisible();

    // Blueprint 4.6 protects an edited value from a later submission, which is
    // surprising enough to be worth saying on the field itself.
    await expect(
      page.getByText('Edited by your team. A later submission will not overwrite this.').first(),
    ).toBeVisible();

    // The visitor submits again with the original spelling.
    await submitLead(page, publicId, {
      email: 'typo@example.invalid',
      name: 'Tpyo Nmae',
      message: 'Second enquiry.',
    });

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Correct Name' })).toBeVisible();
    // The raw value stays visible in the immutable event, as 4.6 requires.
    await expect(page.getByTestId('timeline')).toContainText('Tpyo Nmae');
  });

  test('a stale edit surfaces a conflict instead of overwriting - EXIT GATE', async ({
    page,
    browser,
  }) => {
    await createOwnerWithWorkspace(page, 'inbox-conflict');
    const publicId = await publishWidgetForLeads(page, 'inbox-conflict');
    await submitLead(page, publicId, {
      email: 'contested@example.invalid',
      name: 'Contested Lead',
      message: 'Two people will edit me.',
    });

    const adminEmail = uniqueEmail('inbox-conflict-admin');
    const acceptUrl = await invite(page, adminEmail, 'Admin');
    const adminPage = await acceptAsNewUser(browser, acceptUrl, adminEmail);

    // Both open the same lead, so both hold the same version.
    await openInbox(page);
    await page.getByRole('link', { name: 'Contested Lead' }).click();
    await openInbox(adminPage);
    await adminPage.getByRole('link', { name: 'Contested Lead' }).click();

    // The Admin saves first.
    await adminPage.getByLabel('Company').fill('Admin Industries');
    await adminPage.getByRole('button', { name: 'Save details' }).click();
    await expect(adminPage.getByText('Details saved')).toBeVisible();

    // The Owner's page is now holding a stale version.
    await page.getByLabel('Company').fill('Owner Industries');
    await page.getByRole('button', { name: 'Save details' }).click();

    const conflict = page.getByTestId('canonical-conflict');
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText('This lead changed while you were editing');

    // The first writer's value is intact - nothing was silently overwritten.
    await page.getByTestId('conflict-reload').click();
    await expect(page.getByLabel('Company')).toHaveValue('Admin Industries');

    await adminPage.close();
  });
});

// ===========================================================================
// Merge
// ===========================================================================

test.describe('merging duplicates', () => {
  test('a merge completes and the retired lead leaves the active list', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'inbox-merge');
    const publicId = await publishWidgetForLeads(page, 'inbox-merge');

    await submitLead(page, publicId, {
      email: 'sam@example.invalid',
      name: 'Sam Survivor',
      message: 'Work address.',
    });
    await submitLead(page, publicId, {
      email: 's.duplicate@example.invalid',
      name: 'Sam Duplicate',
      message: 'Personal address.',
    });

    await openInbox(page);
    await page.getByLabel('Select Sam Survivor').check();
    await page.getByLabel('Select Sam Duplicate').check();

    await page.getByTestId('bulk-merge').click();
    const panel = page.getByTestId('merge-panel');
    await expect(panel).toBeVisible();
    // The consequence is stated before the action, because it cannot be undone.
    await expect(panel).toContainText('This cannot be undone');

    await panel.getByRole('radio', { name: /Sam Survivor/ }).check();
    await page.getByTestId('confirm-merge').click();

    await expect(page.getByText('Merged.')).toBeVisible();

    const list = page.getByTestId('contact-list');
    await expect(list).toContainText('Sam Survivor');
    await expect(list).not.toContainText('Sam Duplicate');

    // Both submissions now hang off the survivor.
    await page.getByRole('link', { name: 'Sam Survivor' }).click();
    await expect(page.getByTestId('timeline')).toContainText('Work address.');
    await expect(page.getByTestId('timeline')).toContainText('Personal address.');
  });
});

// ===========================================================================
// GATE 2 - export matches the visible filter
// ===========================================================================

test.describe('GATE 2: export matches the active filter - EXIT GATE', () => {
  test('the download contains exactly the leads the filter is showing', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'inbox-export');
    const publicId = await publishWidgetForLeads(page, 'inbox-export');

    await submitLead(page, publicId, {
      email: 'keep@example.invalid',
      name: 'Keep Me',
      message: 'In the export.',
    });
    await submitLead(page, publicId, {
      email: 'drop@example.invalid',
      name: 'Drop Me',
      message: 'Not in the export.',
    });

    await openInbox(page);

    // Qualify one lead, then filter the inbox down to it.
    await page.getByLabel('Select Keep Me').check();
    await page.getByTestId('bulk-bar').getByLabel('Set status').selectOption('qualified');
    await expect(page.getByText('1 contact updated')).toBeVisible();

    await page.getByTestId('filters-toggle').click();
    await page.getByRole('checkbox', { name: 'qualified' }).check();

    const list = page.getByTestId('contact-list');
    await expect(list).toContainText('Keep Me');
    await expect(list).not.toContainText('Drop Me');

    // The download is what the screen is showing, not the whole workspace.
    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-csv').click(),
    ]).then(([event]) => event);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString('utf8');

    expect(csv).toContain('keep@example.invalid');
    expect(csv).not.toContain('drop@example.invalid');
    // The header is an allowlist, never a record dump.
    expect(csv.split('\r\n')[0]).not.toContain('workspaceId');
  });
});

// ===========================================================================
// GATE 3 - live arrival, workspace-isolated
// ===========================================================================

test.describe('GATE 3: live arrival is workspace-isolated - EXIT GATE', () => {
  test('a new lead appears without a manual reload, and only in its own workspace', async ({
    page,
    browser,
  }) => {
    await createOwnerWithWorkspace(page, 'inbox-live');
    const publicId = await publishWidgetForLeads(page, 'inbox-live');

    // A second tenant, watching their own inbox at the same time.
    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();
    await createOwnerWithWorkspace(outsiderPage, 'inbox-live-other');
    await openInbox(outsiderPage);
    await expect(outsiderPage.getByTestId('contacts-empty')).toBeVisible();

    await openInbox(page);
    await expect(page.getByTestId('contacts-empty')).toBeVisible();

    // Nothing is reloaded from here on: the arrival has to reach the open page.
    await submitLead(page, publicId, {
      email: 'live@example.invalid',
      name: 'Live Arrival',
      message: 'I just submitted this.',
    });

    const banner = page.getByTestId('new-leads');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText('1 new lead arrived');

    /*
     * Queued rather than injected: blueprint 13.1 asks for live updates, but a
     * row that inserts itself moves what somebody was about to click. Pressing
     * the button is what brings it in.
     */
    await banner.click();
    await expect(page.getByTestId('contact-list')).toContainText('Live Arrival');

    // The other tenant's open inbox never heard about it.
    await expect(outsiderPage.getByTestId('new-leads')).toHaveCount(0);
    await expect(outsiderPage.getByTestId('contacts-empty')).toBeVisible();

    await outsiderContext.close();
  });
});

// ===========================================================================
// Search, filters, and the trash
// ===========================================================================

test.describe('finding and recovering leads', () => {
  test('search finds a lead by something they wrote, not just by name', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'inbox-search');
    const publicId = await publishWidgetForLeads(page, 'inbox-search');

    await submitLead(page, publicId, {
      email: 'searchable@example.invalid',
      name: 'Searchable Person',
      message: 'We need a quote for zylophone cases.',
    });
    await submitLead(page, publicId, {
      email: 'other@example.invalid',
      name: 'Other Person',
      message: 'Nothing relevant.',
    });

    await openInbox(page);
    // A word that appears only in the captured message, never in a name or an
    // email - so this only passes if the search reaches submission values.
    await page.getByRole('searchbox', { name: 'Search' }).fill('zylophone');
    await page.getByRole('searchbox', { name: 'Search' }).press('Enter');

    const list = page.getByTestId('contact-list');
    await expect(list).toContainText('Searchable Person');
    await expect(list).not.toContainText('Other Person');
  });

  test('a deleted lead goes to the trash and can be restored', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'inbox-trash');
    const publicId = await publishWidgetForLeads(page, 'inbox-trash');
    await submitLead(page, publicId, {
      email: 'deletable@example.invalid',
      name: 'Deletable Lead',
      message: 'Delete me.',
    });

    await openInbox(page);
    await page.getByRole('link', { name: 'Deletable Lead' }).click();
    await page.getByRole('button', { name: 'Move to trash' }).click();

    await expect(page).toHaveURL(/\/workspace\/contacts$/);
    await expect(page.getByTestId('contacts-empty')).toBeVisible();

    await page.getByRole('link', { name: 'Trash' }).click();
    await expect(page.getByTestId('trash-list')).toContainText('Deletable Lead');

    await page.getByTestId('restore-deletable@example.invalid').click();
    await expect(page.getByText('is back in your inbox')).toBeVisible();

    await openInbox(page);
    await expect(page.getByTestId('contact-list')).toContainText('Deletable Lead');
  });
});

// ===========================================================================
// Cross-tenant
// ===========================================================================

test.describe('tenant isolation in the inbox', () => {
  test('another workspace never shows this workspace leads', async ({ page, browser }) => {
    await createOwnerWithWorkspace(page, 'inbox-xt');
    const publicId = await publishWidgetForLeads(page, 'inbox-xt');
    await submitLead(page, publicId, {
      email: 'private@example.invalid',
      name: 'Private Lead',
      message: 'Confidential.',
    });

    await openInbox(page);
    await expect(page.getByTestId('contact-list')).toContainText('Private Lead');
    await page.getByRole('link', { name: 'Private Lead' }).click();
    const contactUrl = page.url();

    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();
    await createOwnerWithWorkspace(outsiderPage, 'inbox-xt-other');

    await openInbox(outsiderPage);
    await expect(outsiderPage.getByTestId('contacts-empty')).toBeVisible();

    // Even with the exact URL, which is the case a list filter alone would miss.
    await outsiderPage.goto(contactUrl);
    await expect(outsiderPage.getByRole('link', { name: 'Back to the inbox' })).toBeVisible();
    await expect(outsiderPage.locator('body')).not.toContainText('Private Lead');

    await outsiderContext.close();
  });
});
