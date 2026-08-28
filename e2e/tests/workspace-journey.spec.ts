import type { Page } from '@playwright/test';
import { expect, test, uniqueEmail } from '../fixtures.js';
import {
  acceptAsNewUser,
  createOwnerWithWorkspace,
  invite,
  onboard,
  register,
  signIn,
  signInAndLand,
  verifyViaEmail,
} from '../helpers/journeys.js';

/**
 * Blueprint 18.3 journey 2 ("Invite and accept Member/Admin roles with
 * permission checks") plus the onboarding half of journey 1, driven through the
 * real UI against the real stack.
 *
 * The point of this file is the part the API tests cannot reach: that the role
 * matrix is visible in the interface. Stage 4a already proved the server
 * refuses forbidden calls. What matters here is that a Member is never SHOWN a
 * control they would be refused for using, because a button that always fails
 * is a defect even when the refusal is correct.
 */

/** Every control this stage gates on a capability, by its accessible name. */
const PRIVILEGED_CONTROLS = [
  'Send invitation',
  'Transfer ownership',
  'Delete this workspace',
] as const;

async function expectControlsHidden(page: Page, names: readonly string[]): Promise<void> {
  for (const name of names) {
    await expect(
      page.getByRole('button', { name }),
      `"${name}" must not be offered to this role`,
    ).toHaveCount(0);
  }
}

test.describe('onboarding', () => {
  test('a new verified user creates their first workspace and lands in it', async ({ page }) => {
    const email = uniqueEmail('onboard');
    await register(page, email);
    await verifyViaEmail(page, email);
    await signIn(page, email);

    // With no workspace, signing in goes to onboarding rather than a dashboard.
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('heading', { name: 'Name your workspace' })).toBeVisible();

    // The timezone is detected and pre-filled, and stays editable.
    const timezone = page.getByLabel('Time zone');
    await expect(timezone).not.toHaveValue('');

    await page.getByLabel('Workspace name').fill('Northwind Studio');
    await page.getByRole('button', { name: 'Create workspace' }).click();

    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByTestId('active-workspace')).toContainText('Northwind Studio');
    // The chip appears in the shell and again in the page heading, so scope
    // the assertion to the shell rather than matching both.
    await expect(page.getByRole('banner').getByTestId('role-owner')).toBeVisible();
  });

  test('a rejected time zone is reported on the field, not as a crash', async ({ page }) => {
    const email = uniqueEmail('badzone');
    await register(page, email);
    await verifyViaEmail(page, email);
    await signIn(page, email);
    await expect(page).toHaveURL(/\/onboarding$/);

    await page.getByLabel('Workspace name').fill('Bad Zone Co');
    await page.getByLabel('Time zone').fill('Mars/Olympus_Mons');
    await page.getByRole('button', { name: 'Create workspace' }).click();

    await expect(page.getByText('This is not a time zone this server recognises')).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('an unverified user is blocked from inviting, and told why', async ({ page }) => {
    // Blueprint 4.1: "Dashboard is available, but publishing and invitations
    // are blocked." So they reach the workspace, but not the invite form.
    const email = uniqueEmail('unverified-invite');
    await register(page, email);
    await signIn(page, email);

    await onboard(page, 'Unconfirmed Co');
    await page.goto('/workspace/members');

    await expect(page.getByText('Confirm your email address to invite people.')).toBeVisible();
    await expectControlsHidden(page, ['Send invitation']);
    await expect(page.getByLabel('Email address')).toHaveCount(0);
  });
});

test.describe('invitations and the role matrix', () => {
  test('an Owner invites a Member, who sees a read-only roster', async ({ page, browser }) => {
    const owner = await createOwnerWithWorkspace(page, 'owner-m');
    const memberEmail = uniqueEmail('member');

    const acceptUrl = await invite(page, memberEmail, 'Member');
    const memberPage = await acceptAsNewUser(browser, acceptUrl, memberEmail);

    // They are really in the owner's workspace, as a Member.
    await expect(memberPage.getByTestId('active-workspace')).toContainText(owner.workspace);
    await expect(memberPage.getByRole('banner').getByTestId('role-member')).toBeVisible();

    await memberPage.goto('/workspace/members');

    // The roster is visible - `workspace.view` - and nothing else is offered.
    await expect(memberPage.getByTestId('member-list')).toBeVisible();
    await expect(memberPage.getByText(owner.email)).toBeVisible();
    await expectControlsHidden(memberPage, PRIVILEGED_CONTROLS);
    await expect(memberPage.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    await expect(memberPage.getByTestId('invitation-list')).toHaveCount(0);

    // `audit.view` is Owner and Admin only, so the link is absent...
    await expect(memberPage.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
    // ...and typing the URL still gets nowhere, because the server decides.
    await memberPage.goto('/workspace/audit');
    await expect(memberPage.getByRole('alert')).toContainText('does not allow');

    // Settings opens, but carries no owner-only controls.
    await memberPage.goto('/workspace/settings');
    await expectControlsHidden(memberPage, PRIVILEGED_CONTROLS);

    await memberPage.context().close();
  });

  test('an Admin can invite and remove Members but cannot touch Admin status', async ({
    page,
    browser,
  }) => {
    const owner = await createOwnerWithWorkspace(page, 'owner-a');
    const adminEmail = uniqueEmail('admin');

    const acceptUrl = await invite(page, adminEmail, 'Admin');
    const adminPage = await acceptAsNewUser(browser, acceptUrl, adminEmail);
    await expect(adminPage.getByRole('banner').getByTestId('role-admin')).toBeVisible();

    await adminPage.goto('/workspace/members');

    // An Admin invites - but only Members, since assigning Admin status is
    // reserved to the Owner.
    await expect(adminPage.getByRole('button', { name: 'Send invitation' })).toBeVisible();
    await expect(adminPage.getByLabel('Role').getByRole('option')).toHaveText(['Member']);

    // Ownership and deletion are Owner-only.
    await adminPage.goto('/workspace/settings');
    await expectControlsHidden(adminPage, ['Transfer ownership', 'Delete this workspace']);

    // An Admin may read the audit log.
    await expect(adminPage.getByRole('link', { name: 'Audit log' })).toBeVisible();

    // The Owner outranks them and is never removable or re-roleable.
    await adminPage.goto('/workspace/members');
    const ownerRow = adminPage.getByRole('listitem').filter({ hasText: owner.email });
    await expect(ownerRow.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    await expect(ownerRow.getByRole('combobox')).toHaveCount(0);

    // Now a Member joins, and the Admin can remove them.
    const memberEmail = uniqueEmail('admin-removes');
    const memberUrl = await invite(adminPage, memberEmail, 'Member');
    const memberPage = await acceptAsNewUser(browser, memberUrl, memberEmail);
    await memberPage.close();

    await adminPage.goto('/workspace/members');
    const memberRow = adminPage.getByRole('listitem').filter({ hasText: memberEmail });
    await expect(memberRow.getByRole('button', { name: 'Remove' })).toBeVisible();
    await memberRow.getByRole('button', { name: 'Remove' }).click();

    await expect(adminPage.getByRole('status')).toContainText('was removed');
    await expect(adminPage.getByTestId('member-list')).not.toContainText(memberEmail);

    await adminPage.context().close();
  });

  test('only the Owner is offered the Admin role when inviting', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'owner-roles');
    await page.goto('/workspace/members');

    await expect(page.getByLabel('Role').getByRole('option')).toHaveText(['Member', 'Admin']);
  });

  test('an intercepted invitation link does not let a different account in', async ({
    page,
    browser,
  }) => {
    await createOwnerWithWorkspace(page, 'owner-wrong');
    const invitedEmail = uniqueEmail('intended');
    const acceptUrl = await invite(page, invitedEmail, 'Member');

    // Somebody else, signed in as themselves, opens the link.
    const context = await browser.newContext();
    const interloper = await context.newPage();
    const otherEmail = uniqueEmail('interloper');
    await register(interloper, otherEmail);
    await verifyViaEmail(interloper, otherEmail);
    await signInAndLand(interloper, otherEmail);

    await interloper.goto(acceptUrl);

    /**
     * They get the same answer as a made-up token.
     *
     * The server refuses to distinguish "not yours" from "not real", so an
     * intercepted link cannot be used to confirm that a live invitation exists
     * for some address. The message is identical either way.
     */
    await expect(interloper.getByRole('heading', { name: 'That link did not work' })).toBeVisible();

    // And nothing was created: they are still in no workspace at all.
    await interloper.goto('/workspace');
    await expect(interloper).toHaveURL(/\/onboarding$/);

    // The invitation is still pending, so the intended recipient can still use it.
    await page.goto('/workspace/members');
    await expect(page.getByTestId('invitation-list')).toContainText(invitedEmail);
    await expect(page.getByTestId('member-list')).not.toContainText(otherEmail);

    await context.close();
  });

  test('a pending invitation can be cancelled before it is used', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'owner-revoke');
    const invitedEmail = uniqueEmail('revoked');

    await invite(page, invitedEmail, 'Member');
    await page.goto('/workspace/members');
    await expect(page.getByTestId('invitation-list')).toContainText(invitedEmail);

    const row = page.getByRole('listitem').filter({ hasText: invitedEmail });
    await row.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('status')).toContainText('was cancelled');
    await expect(page.getByText('No invitations are waiting')).toBeVisible();
  });
});

test.describe('ownership, deletion, and recovery', () => {
  test('ownership transfers to a verified Admin, and the outgoing Owner stays as Admin', async ({
    page,
    browser,
  }) => {
    await createOwnerWithWorkspace(page, 'owner-transfer');
    const adminEmail = uniqueEmail('successor');

    const acceptUrl = await invite(page, adminEmail, 'Admin');
    const adminPage = await acceptAsNewUser(browser, acceptUrl, adminEmail);

    await page.goto('/workspace/settings');
    await page.getByLabel('New Owner').selectOption({ label: adminEmail });
    await page.getByRole('button', { name: 'Transfer ownership' }).click();

    // The confirmation states what happens to the person doing it.
    await expect(page.getByRole('status')).toContainText('You stay in this workspace as an Admin');
    await page.getByRole('button', { name: `Yes, make ${adminEmail} the Owner` }).click();

    await expect(page.getByRole('status')).toContainText('Ownership transferred');

    // The outgoing Owner is now an Admin: still here, but no longer able to
    // transfer or delete.
    await page.goto('/workspace');
    await expect(page.getByRole('banner').getByTestId('role-admin')).toBeVisible();
    await page.goto('/workspace/settings');
    await expectControlsHidden(page, ['Transfer ownership', 'Delete this workspace']);

    // And the incoming Owner has the owner-only controls.
    await adminPage.goto('/workspace/settings');
    await expect(adminPage.getByRole('button', { name: 'Delete this workspace' })).toBeVisible();

    await adminPage.context().close();
  });

  test('a workspace can be deleted and restored inside the 30-day window', async ({ page }) => {
    const owner = await createOwnerWithWorkspace(page, 'owner-delete');

    await page.goto('/workspace/settings');
    await page.getByTestId('delete-workspace').click();
    await expect(page.getByRole('alert')).toContainText('30 days');
    await page.getByTestId('confirm-delete-workspace').click();

    // With their only workspace gone, the owner is back at onboarding.
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByTestId('recoverable-list')).toContainText(owner.workspace);

    await page.getByRole('button', { name: `Restore ${owner.workspace}` }).click();

    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByTestId('active-workspace')).toContainText(owner.workspace);
  });
});

test.describe('switching and the audit log', () => {
  test('switching workspaces re-scopes what is shown', async ({ page, browser }) => {
    // This person owns one workspace and is invited into another, so the
    // switcher has two entries with different roles.
    const owner = await createOwnerWithWorkspace(page, 'switcher');

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const host = await createOwnerWithWorkspace(hostPage, 'host');

    const acceptUrl = await invite(hostPage, owner.email, 'Member');

    // Accept in the original session, which is already signed in as them.
    await page.goto(acceptUrl);
    await expect(page).toHaveURL(/\/workspace$/);

    // Now in the host's workspace, as a Member.
    await expect(page.getByTestId('active-workspace')).toContainText(host.workspace);
    await expect(page.getByRole('link', { name: 'Audit log' })).toHaveCount(0);

    // Switch back to their own workspace: Owner controls return.
    await page.getByTestId('workspace-switcher').click();
    await page.getByRole('button', { name: new RegExp(owner.workspace) }).click();

    await expect(page.getByTestId('active-workspace')).toContainText(owner.workspace);
    await expect(page.getByRole('link', { name: 'Audit log' })).toBeVisible();

    await page.goto('/workspace/settings');
    await expect(page.getByRole('button', { name: 'Delete this workspace' })).toBeVisible();

    // The other workspace's audit log is not reachable from this one.
    await page.goto('/workspace/audit');
    await expect(page.getByTestId('audit-list')).not.toContainText(host.workspace);

    await hostContext.close();
  });

  test('the audit log records what happened during this run', async ({ page, browser }) => {
    const owner = await createOwnerWithWorkspace(page, 'auditor');
    const memberEmail = uniqueEmail('audited');

    const acceptUrl = await invite(page, memberEmail, 'Member');
    const memberPage = await acceptAsNewUser(browser, acceptUrl, memberEmail);
    await memberPage.context().close();

    await page.goto('/workspace/audit');
    const log = page.getByTestId('audit-list');

    await expect(log).toContainText(`created the workspace ${owner.workspace}`);
    await expect(log).toContainText(`invited ${memberEmail} as member`);
    await expect(log).toContainText('joined as member');
  });
});
