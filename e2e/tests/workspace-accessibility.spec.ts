import { expect, test, uniqueEmail } from '../fixtures.js';
import {
  acceptAsNewUser,
  createOwnerWithWorkspace,
  invite,
  register,
  signIn,
  signInAndLand,
  verifyViaEmail,
} from '../helpers/journeys.js';

/**
 * Automated accessibility checks for the workspace surface (blueprint 14.1:
 * WCAG 2.2 AA), matching the bar Stage 3b set for the auth pages.
 *
 * Error and empty states are scanned as well as populated ones. They are where
 * violations hide: a page is usually built and reviewed with data in it, and
 * the empty or failed rendering is the one nobody looks at.
 */

test.describe('accessibility of the workspace surface', () => {
  test('onboarding, in its pristine and error states', async ({ page, checkA11y }) => {
    const email = uniqueEmail('a11y-onboard');
    await register(page, email);
    await verifyViaEmail(page, email);
    await signIn(page, email);

    await expect(page.getByRole('heading', { name: 'Name your workspace' })).toBeVisible();
    await checkA11y(page);

    // A rejected time zone: the field error state.
    await page.getByLabel('Workspace name').fill('A11y Co');
    await page.getByLabel('Time zone').fill('Nowhere/Nothing');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByText('This is not a time zone this server recognises')).toBeVisible();
    await checkA11y(page);
  });

  test('the invitation page with an invalid token', async ({ page, checkA11y }) => {
    // Signed in, so the page reaches the token check rather than the sign-in
    // prompt. This is the error state the auth suite scans an equivalent of.
    const email = uniqueEmail('a11y-badtoken');
    await register(page, email);
    await verifyViaEmail(page, email);
    await signInAndLand(page, email);

    await page.goto('/invitations/accept?token=not-a-real-invitation-token');
    await expect(page.getByRole('heading', { name: 'That link did not work' })).toBeVisible();
    await checkA11y(page);
  });

  test('the invitation page when signed out', async ({ page, checkA11y }) => {
    await page.goto('/invitations/accept?token=some-token-value');
    await expect(page.getByRole('heading', { name: 'Sign in to join' })).toBeVisible();
    await checkA11y(page);
  });

  test('overview, members, audit, and settings as the Owner', async ({ page, checkA11y }) => {
    await createOwnerWithWorkspace(page, 'a11y-owner');

    // Overview, including the usage meters.
    await expect(page.getByTestId('usage-meters')).toBeVisible();
    await checkA11y(page);

    // Members, with the invite form and an empty pending list.
    await page.goto('/workspace/members');
    await expect(page.getByTestId('member-list')).toBeVisible();
    await expect(page.getByText('No invitations are waiting')).toBeVisible();
    await checkA11y(page);

    // Audit log with entries in it.
    await page.goto('/workspace/audit');
    await expect(page.getByTestId('audit-list')).toBeVisible();
    await checkA11y(page);

    // Settings, including the danger zone in its confirming state.
    await page.goto('/workspace/settings');
    await expect(page.getByTestId('no-transfer-targets')).toBeVisible();
    await checkA11y(page);

    await page.getByTestId('delete-workspace').click();
    await expect(page.getByRole('alert')).toBeVisible();
    await checkA11y(page);
  });

  test('members and settings as a Member, with controls hidden', async ({
    page,
    browser,
    checkA11y,
  }) => {
    await createOwnerWithWorkspace(page, 'a11y-host');
    const memberEmail = uniqueEmail('a11y-member');
    const acceptUrl = await invite(page, memberEmail, 'Member');
    const memberPage = await acceptAsNewUser(browser, acceptUrl, memberEmail);

    await memberPage.goto('/workspace/members');
    await expect(memberPage.getByTestId('member-list')).toBeVisible();
    await checkA11y(memberPage);

    await memberPage.goto('/workspace/settings');
    await expect(memberPage.getByRole('heading', { name: 'Details' })).toBeVisible();
    await checkA11y(memberPage);

    await memberPage.context().close();
  });

  test('a populated pending-invitation list stays accessible', async ({ page, checkA11y }) => {
    await createOwnerWithWorkspace(page, 'a11y-pendinglist');

    await invite(page, uniqueEmail('a11y-pending'), 'Member');
    await page.goto('/workspace/members');
    await expect(page.getByTestId('invitation-list')).toBeVisible();
    await checkA11y(page);
  });

  test('the workspace switcher is accessible when it has something to switch', async ({
    page,
    browser,
    checkA11y,
  }) => {
    // The disclosure only renders with more than one workspace, so this user
    // owns one and is invited into another.
    const guest = await createOwnerWithWorkspace(page, 'a11y-guest');

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await createOwnerWithWorkspace(hostPage, 'a11y-switchhost');
    const acceptUrl = await invite(hostPage, guest.email, 'Member');

    await page.goto(acceptUrl);
    await expect(page).toHaveURL(/\/workspace$/);

    await page.getByTestId('workspace-switcher').click();
    await checkA11y(page);

    await hostContext.close();
  });

  test('the workspace surface can be navigated with the keyboard alone', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'a11y-keys');

    // Tab from the top of the document until the Members link has focus, then
    // activate it with the keyboard. Asserting reachability rather than an
    // exact tab count keeps this robust to layout changes.
    const membersLink = page.getByRole('link', { name: 'Members' });
    let reached = false;
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press('Tab');
      if (await membersLink.evaluate((node) => node === document.activeElement)) {
        reached = true;
        break;
      }
    }
    expect(reached, 'the Members link must be reachable by keyboard').toBe(true);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/workspace\/members$/);
    await expect(page.getByTestId('member-list')).toBeVisible();
  });
});
