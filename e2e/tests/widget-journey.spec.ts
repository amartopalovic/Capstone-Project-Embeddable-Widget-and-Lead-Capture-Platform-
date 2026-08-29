import { expect, test, uniqueEmail } from '../fixtures.js';
import {
  acceptAsNewUser,
  addAllowedDomain,
  createOwnerWithWorkspace,
  createPublishableWidget,
  createWidget,
  invite,
  onboard,
  publishWidget,
  register,
  saveDraft,
  signIn,
} from '../helpers/journeys.js';

/**
 * Blueprint 18.3, journey 3: "Create a widget, preview it, publish it, and copy
 * its snippet" - driven through the real UI against the real stack.
 *
 * This file closes blueprint Stage 5's exit gate through the browser, the same
 * way Stage 4b closed Stage 4's. Stage 5a already proved the server refuses the
 * wrong caller; what matters here is that the interface never offers a control
 * it would then be refused for, and that a draft edit provably leaves the live
 * revision alone.
 */

test.describe('building and previewing', () => {
  test('a widget is created, previewed live, and its fields respect the locked ones', async ({
    page,
  }) => {
    await createOwnerWithWorkspace(page, 'w-build');
    await createWidget(page, 'Contact form', 'Front page form');

    const preview = page.getByTestId('widget-preview');
    await expect(preview).toBeVisible();

    // The preview follows the settings as they are edited, with no save.
    await page.getByLabel('Headline').fill('Talk to our team');
    await expect(preview).toContainText('Talk to our team');

    await page.getByLabel('Button label').fill('Send it');
    await expect(preview).toContainText('Send it');

    // A contact form keeps email and message: blueprint 4.3 locks them, so
    // they have no remove control at all rather than one that would 400.
    const fields = page.getByTestId('field-list');
    await expect(fields.getByRole('listitem').filter({ hasText: 'email' })).toContainText(
      'required',
    );
    await expect(fields.getByRole('button', { name: 'Remove the email field' })).toHaveCount(0);
    await expect(fields.getByRole('button', { name: 'Remove the message field' })).toHaveCount(0);

    // A non-mandatory field can be removed, and the preview follows.
    await expect(preview).toContainText('Subject');
    await fields.getByRole('button', { name: 'Remove the subject field' }).click();
    await expect(preview).not.toContainText('Subject');

    // And a new one can be added.
    await page.getByTestId('add-field').selectOption('phone');
    await expect(fields.getByRole('listitem').filter({ hasText: 'phone' })).toBeVisible();
    await expect(preview).toContainText('Phone');
  });

  test('fields can be reordered, and the preview follows the order', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'w-reorder');
    await createWidget(page, 'Contact form', 'Ordered form');

    const rows = page.getByTestId('field-list').getByRole('listitem');
    await expect(rows.first()).toContainText('name');

    // Move the second field above the first.
    await rows
      .nth(1)
      .getByRole('button', { name: /Move .* earlier/ })
      .click();
    await expect(rows.first()).toContainText('email');
  });

  test('the builder refuses a javascript: redirect with the server message', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'w-xss');
    await createWidget(page, 'Contact form', 'Redirecting form');

    await page.getByLabel('Outcome').selectOption('redirect');
    await page.getByLabel('Redirect to').fill('javascript:alert(1)');
    await expect(page.getByLabel('Redirect to')).toHaveValue('javascript:alert(1)');
    await page.getByRole('button', { name: 'Save draft' }).click();

    // The message is the server's own; the client does not decide this.
    await expect(page.getByText('Only http and https addresses are allowed')).toBeVisible();
  });
});

test.describe('publishing and the embed snippet', () => {
  test('a verified Admin publishes and copies the snippet', async ({ page, browser }) => {
    const owner = await createOwnerWithWorkspace(page, 'w-pub-owner');
    const adminEmail = uniqueEmail('w-pub-admin');
    const acceptUrl = await invite(page, adminEmail, 'Admin');
    const adminPage = await acceptAsNewUser(browser, acceptUrl, adminEmail);

    await adminPage.goto('/workspace/widgets');
    await createWidget(adminPage, 'Email signup', 'Newsletter');
    await adminPage.getByLabel('Headline').fill('Subscribe for updates');

    // Blueprint 4.4: at least one allowed domain is required before publishing.
    // Publishing without one surfaces the server's reason.
    await adminPage.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(
      adminPage.getByText('Add at least one allowed domain before publishing'),
    ).toBeVisible();
    await expect(adminPage.getByTestId('snippet-unavailable')).toBeVisible();

    await addAllowedDomain(adminPage, 'example.com');
    await publishWidget(adminPage);

    await expect(adminPage.getByTestId('widget-state-published')).toBeVisible();

    // Blueprint 7.2: one line carrying the public identifier.
    const snippet = adminPage.getByTestId('embed-snippet');
    await expect(snippet).toBeVisible();
    const value = await snippet.inputValue();
    expect(value).toContain('<script async');
    expect(value).toContain('/widget/v1/loader.js');
    expect(value).toMatch(/data-widget="w_[a-z2-9]{16}"/);

    // Clipboard access is a permission, and a headless context has none by
    // default. Granting it makes this exercise the real copy path rather than
    // the "permission refused" fallback.
    await adminPage.context().grantPermissions(['clipboard-write']);
    await adminPage.getByRole('button', { name: 'Copy' }).click();
    await expect(adminPage.getByRole('button', { name: 'Copied' })).toBeVisible();
    await expect(adminPage.getByText('Snippet copied to your clipboard.')).toBeVisible();

    // The owner sees it as published too, so this was real shared state.
    await page.goto('/workspace/widgets');
    await expect(page.getByTestId('widget-list')).toContainText('Newsletter');
    await expect(page.getByTestId('widget-state-published')).toBeVisible();

    expect(owner.workspace).not.toEqual('');
    await adminPage.context().close();
  });

  test('unpublishing takes it down and withdraws the snippet', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'w-unpub');
    await createPublishableWidget(page, 'Temporary', 'Here for a moment');
    await publishWidget(page);
    await expect(page.getByTestId('embed-snippet')).toBeVisible();

    await page.getByRole('button', { name: 'Unpublish' }).click();
    await expect(page.getByText('Unpublished. Visitors stop seeing it')).toBeVisible();
    await expect(page.getByTestId('widget-state-unpublished')).toBeVisible();
    await expect(page.getByTestId('snippet-unavailable')).toBeVisible();
  });

  test('an unverified Owner is told why publishing is unavailable', async ({ page }) => {
    // Blueprint 4.1: the dashboard is available to an unverified user; only
    // publishing and inviting are blocked.
    const email = uniqueEmail('w-unverified');
    await register(page, email);
    await signIn(page, email);
    await onboard(page, 'Unconfirmed Co');

    await createWidget(page, 'Contact form', 'Cannot publish yet');

    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('publish-unavailable')).toContainText('Confirm your email');

    // Drafting still works, because blueprint 11 gives every role
    // widget.draft.write.
    await page.getByLabel('Headline').fill('Still editable');
    await saveDraft(page);
  });
});

test.describe('the role matrix in the builder', () => {
  test('a Member edits a draft without changing live state - EXIT GATE', async ({
    page,
    browser,
  }) => {
    await createOwnerWithWorkspace(page, 'w-gate-owner');
    const builderUrl = await createPublishableWidget(page, 'Shared form', 'Original headline');
    await publishWidget(page);
    await expect(page.getByTestId('widget-state-published')).toBeVisible();

    const memberEmail = uniqueEmail('w-gate-member');
    const acceptUrl = await invite(page, memberEmail, 'Member');
    const memberPage = await acceptAsNewUser(browser, acceptUrl, memberEmail);

    await memberPage.goto('/workspace/widgets');
    // Every role holds widget.draft.write (blueprint 11), so a Member is
    // offered Edit, not a read-only View.
    await memberPage.getByRole('link', { name: 'Edit Shared form' }).click();

    // A Member gets no publish and no delete control at all.
    await expect(memberPage.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
    await expect(memberPage.getByRole('button', { name: 'Unpublish' })).toHaveCount(0);
    await expect(memberPage.getByTestId('delete-widget')).toHaveCount(0);
    await expect(memberPage.getByTestId('publish-unavailable')).toContainText(
      'available to Owners and Admins',
    );

    // They CAN edit the draft, which is what widget.draft.write grants.
    await memberPage.getByLabel('Headline').fill('Member edit');
    await expect(memberPage.getByTestId('widget-preview')).toContainText('Member edit');
    await saveDraft(memberPage);

    /**
     * The gate: the live revision is untouched. The owner reloads and still
     * sees the published headline, with the widget still published and the
     * draft flagged as unpublished changes.
     */
    // `invite` navigated the owner to the members page, so come back.
    await page.goto(builderUrl);
    await expect(page.getByTestId('widget-state-published')).toBeVisible();

    /**
     * The builder edits the DRAFT, so the headline field now holds the
     * Member's text - that is correct and expected. What must not have moved is
     * the LIVE revision, which the panel reports independently.
     */
    await expect(page.getByLabel('Headline')).toHaveValue('Member edit');
    await expect(page.getByTestId('live-headline')).toHaveText('Original headline');
    await expect(page.getByTestId('live-revision')).toContainText('revision 1');
    await expect(page.getByTestId('live-revision')).toContainText('not live yet');

    await page.goto('/workspace/widgets');
    const row = page
      .getByTestId('widget-list')
      .getByRole('listitem')
      .filter({ hasText: 'Shared form' });
    await expect(row).toContainText('unpublished changes');

    // And the Member cannot make their edit live even by asking directly.
    const direct = await memberPage.evaluate(async () => {
      const csrf = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' })
        .then(async (response) => (await response.json()) as { csrfToken: string })
        .then((body) => body.csrfToken);
      const path = window.location.pathname.split('/');
      const id = path[path.length - 1] ?? '';
      const result = await fetch(`/api/v1/widgets/${id}/publish`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ expectedVersion: 0 }),
      });
      return result.status;
    });
    expect(direct).toBe(403);

    await memberPage.context().close();
  });

  test('a Member cannot delete a widget from the list either', async ({ page, browser }) => {
    await createOwnerWithWorkspace(page, 'w-del-owner');
    await createWidget(page, 'Contact form', 'Undeletable by member');

    const memberEmail = uniqueEmail('w-del-member');
    const acceptUrl = await invite(page, memberEmail, 'Member');
    const memberPage = await acceptAsNewUser(browser, acceptUrl, memberEmail);

    await memberPage.goto('/workspace/widgets');
    await expect(memberPage.getByTestId('widget-list')).toContainText('Undeletable by member');
    await expect(
      memberPage.getByRole('button', { name: 'Delete Undeletable by member' }),
    ).toHaveCount(0);

    await memberPage.context().close();
  });
});

test.describe('trash and recovery', () => {
  test('a widget is deleted, restored, and comes back unpublished', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'w-trash');
    await createPublishableWidget(page, 'Disposable', 'Delete me');
    await publishWidget(page);

    await page.getByTestId('delete-widget').click();
    await page.getByTestId('confirm-delete-widget').click();

    await expect(page).toHaveURL(/\/workspace\/widgets$/);
    await expect(page.getByTestId('widget-list')).toHaveCount(0);
    await expect(page.getByTestId('widget-trash')).toContainText('Disposable');

    await page.getByRole('button', { name: 'Restore Disposable' }).click();
    await expect(page.getByText('not published until you publish it')).toBeVisible();

    // Blueprint 4.5: restoring does not automatically republish.
    await expect(page.getByTestId('widget-list')).toContainText('Disposable');
    await expect(page.getByTestId('widget-state-unpublished')).toBeVisible();
  });
});

test.describe('concurrent edits', () => {
  test('a stale save shows a conflict instead of losing a change', async ({ page, browser }) => {
    await createOwnerWithWorkspace(page, 'w-conflict-owner');
    await createWidget(page, 'Contact form', 'Contested form');
    const url = page.url();

    const memberEmail = uniqueEmail('w-conflict-member');
    const acceptUrl = await invite(page, memberEmail, 'Member');
    const memberPage = await acceptAsNewUser(browser, acceptUrl, memberEmail);

    // Both open the same draft at the same version. `invite` moved the owner
    // to the members page, so they come back to it too.
    await page.goto(url);
    await expect(page.getByLabel('Headline')).toBeVisible();
    await memberPage.goto(url);
    await expect(memberPage.getByLabel('Headline')).toBeVisible();

    // The owner saves first.
    await page.getByLabel('Headline').fill('Owner got here first');
    await saveDraft(page);

    // The member's save is now stale.
    await memberPage.getByLabel('Headline').fill('Member would have overwritten');
    await memberPage.getByRole('button', { name: 'Save draft' }).click();

    await expect(memberPage.getByRole('alert')).toContainText(
      'Someone else saved this draft first',
    );
    // Nothing was thrown away: their text is still on screen.
    await expect(memberPage.getByLabel('Headline')).toHaveValue('Member would have overwritten');
    await expect(memberPage.getByTestId('conflict-retry')).toBeVisible();
    await expect(memberPage.getByTestId('conflict-discard')).toBeVisible();

    // Discarding takes the owner's version rather than silently merging.
    await memberPage.getByTestId('conflict-discard').click();
    await expect(memberPage.getByLabel('Headline')).toHaveValue('Owner got here first');

    await memberPage.context().close();
  });
});

test.describe('cross-tenant isolation - EXIT GATE', () => {
  test('another tenant cannot reach a widget through the UI', async ({ page, browser }) => {
    await createOwnerWithWorkspace(page, 'w-tenant-a');
    await createPublishableWidget(page, 'Private form', 'Not yours');
    await publishWidget(page);
    const url = page.url();
    expect(url).toContain('/workspace/widgets/');

    // A completely separate tenant.
    const context = await browser.newContext();
    const stranger = await context.newPage();
    await createOwnerWithWorkspace(stranger, 'w-tenant-b');

    // Their own list is empty.
    await stranger.goto('/workspace/widgets');
    await expect(stranger.getByTestId('widget-list')).toHaveCount(0);
    await expect(stranger.locator('body')).not.toContainText('Private form');

    // Typing the other tenant's builder URL bounces them back to their own
    // list rather than showing anything.
    await stranger.goto(url);
    await expect(stranger).toHaveURL(/\/workspace\/widgets$/);
    await expect(stranger.locator('body')).not.toContainText('Not yours');

    // And the API refuses directly, which is what the UI is reflecting.
    const status = await stranger.evaluate(async (target: string) => {
      const id = target.split('/').pop() ?? '';
      const result = await fetch(`/api/v1/widgets/${id}`, { credentials: 'same-origin' });
      return result.status;
    }, url);
    expect(status).toBe(404);

    await context.close();
  });
});

test.describe('usage meters', () => {
  test('every usage meter counts for real', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'w-usage');

    await page.goto('/workspace');
    const meters = page.getByTestId('usage-meters');
    await expect(meters).toContainText('0 / 10');

    await createWidget(page, 'Email signup', 'Counted');

    await page.goto('/workspace');
    await expect(meters).toContainText('1 / 10');

    /**
     * The two monthly meters reported "not counted yet" until Stage 10a, which
     * was honest while the data behind them did not exist. Both are now counted
     * against the workspace's own month boundary, so a fresh workspace shows a
     * truthful zero rather than a placeholder.
     */
    await expect(meters).toContainText('0 / 2000');
    await expect(meters).toContainText('0 / 20000');
    await expect(meters).not.toContainText('Not counted yet');
  });
});
