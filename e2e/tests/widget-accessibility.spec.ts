import { expect, test, uniqueEmail } from '../fixtures.js';
import {
  acceptAsNewUser,
  addAllowedDomain,
  createOwnerWithWorkspace,
  createPublishableWidget,
  createWidget,
  invite,
  publishWidget,
} from '../helpers/journeys.js';

/**
 * Automated accessibility checks for the widget surface (blueprint 14.1: WCAG
 * 2.2 AA), matching the bar Stages 3b and 4b set.
 *
 * The builder is the densest form in the product, so its states are scanned
 * individually: empty, populated, mid-error, and mid-confirmation. The live
 * preview is scanned too - it renders colours a creator chose, and a
 * low-contrast pairing there is exactly the kind of thing axe should be looking
 * at even though it is only a preview.
 */

test.describe('accessibility of the widget surface', () => {
  test('the widget list, empty and populated', async ({ page, checkA11y }) => {
    await createOwnerWithWorkspace(page, 'a11y-wlist');

    await page.goto('/workspace/widgets');
    await expect(page.getByRole('heading', { name: 'Create a widget' })).toBeVisible();
    await expect(page.getByText('No widgets yet')).toBeVisible();
    await checkA11y(page);

    await createWidget(page, 'Contact form', 'Listed widget');
    await page.goto('/workspace/widgets');
    await expect(page.getByTestId('widget-list')).toBeVisible();
    await checkA11y(page);
  });

  test('the builder, including its preview and every settings section', async ({
    page,
    checkA11y,
  }) => {
    await createOwnerWithWorkspace(page, 'a11y-builder');
    await createWidget(page, 'Contact form', 'Accessible form');

    await expect(page.getByTestId('widget-preview')).toBeVisible();
    await checkA11y(page);

    // With every conditional section revealed: a redirect outcome, a cooldown
    // in days, and a delay trigger with its number input.
    await page.getByLabel('Outcome').selectOption('redirect');
    await page.getByLabel('Show again').selectOption('days');
    await page.getByLabel('After a delay').check();
    await addAllowedDomain(page, 'example.com');
    await checkA11y(page);
  });

  test('the builder in its error state', async ({ page, checkA11y }) => {
    await createOwnerWithWorkspace(page, 'a11y-builder-error');
    await createWidget(page, 'Contact form', 'Broken form');

    await page.getByLabel('Outcome').selectOption('redirect');
    await page.getByLabel('Redirect to').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Save draft' }).click();

    await expect(page.getByText('Only http and https addresses are allowed')).toBeVisible();
    await checkA11y(page);
  });

  test('the builder mid-delete-confirmation, and a published widget with its snippet', async ({
    page,
    checkA11y,
  }) => {
    await createOwnerWithWorkspace(page, 'a11y-builder-published');
    await createPublishableWidget(page, 'Published form', 'Live and well');
    await publishWidget(page);

    await expect(page.getByTestId('embed-snippet')).toBeVisible();
    await checkA11y(page);

    await page.getByTestId('delete-widget').click();
    await expect(page.getByTestId('confirm-delete-widget')).toBeVisible();
    await checkA11y(page);
  });

  test('a CTA popover builder, which swaps the form for a link destination', async ({
    page,
    checkA11y,
  }) => {
    await createOwnerWithWorkspace(page, 'a11y-cta');
    await createWidget(page, 'CTA popover', 'Book a call');

    await page.getByLabel('Button action').selectOption('external_url');
    await page.getByLabel('Destination').fill('https://example.com/book');
    // With no lead form there are no fields to configure, so that section goes.
    await expect(page.getByTestId('field-list')).toHaveCount(0);
    await checkA11y(page);
  });

  test('the trash view', async ({ page, checkA11y }) => {
    await createOwnerWithWorkspace(page, 'a11y-wtrash');
    await createWidget(page, 'Email signup', 'Soon deleted');

    await page.getByTestId('delete-widget').click();
    await page.getByTestId('confirm-delete-widget').click();

    await expect(page.getByTestId('widget-trash')).toBeVisible();
    await checkA11y(page);
  });

  test('the builder as a Member, with publish and delete controls absent', async ({
    page,
    browser,
    checkA11y,
  }) => {
    await createOwnerWithWorkspace(page, 'a11y-wmember-host');
    await createWidget(page, 'Contact form', 'Member view');

    const memberEmail = uniqueEmail('a11y-wmember');
    const acceptUrl = await invite(page, memberEmail, 'Member');
    const memberPage = await acceptAsNewUser(browser, acceptUrl, memberEmail);

    await memberPage.goto('/workspace/widgets');
    await memberPage.getByRole('link', { name: 'Edit Member view' }).click();
    await expect(memberPage.getByTestId('publish-unavailable')).toBeVisible();
    await checkA11y(memberPage);

    await memberPage.context().close();
  });

  test('the builder can be operated with the keyboard alone', async ({ page }) => {
    await createOwnerWithWorkspace(page, 'a11y-wkeys');
    await createWidget(page, 'Contact form', 'Keyboard form');

    // Reach the headline field by tabbing, type into it, and watch the preview
    // follow - no mouse at any point.
    const headline = page.getByLabel('Headline');
    let reached = false;
    for (let step = 0; step < 25; step += 1) {
      await page.keyboard.press('Tab');
      if (await headline.evaluate((node) => node === document.activeElement)) {
        reached = true;
        break;
      }
    }
    expect(reached, 'the headline field must be reachable by keyboard').toBe(true);

    await page.keyboard.type('Typed with the keyboard');
    await expect(page.getByTestId('widget-preview')).toContainText('Typed with the keyboard');
  });
});
