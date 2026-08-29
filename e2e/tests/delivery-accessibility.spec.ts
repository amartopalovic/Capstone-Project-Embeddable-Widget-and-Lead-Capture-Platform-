import { expect, test, uniqueEmail } from '../fixtures.js';
import {
  acceptAsNewUser,
  createOwnerWithWorkspace,
  invite,
  publishWidgetForLeads,
  submitLead,
} from '../helpers/journeys.js';

/**
 * The delivery health page (blueprint 12.2, 16.4), scanned against WCAG 2.2 AA
 * like every other surface in this product.
 *
 * Stage 9's exit gate is provable at the API level and does not require browser
 * proof, so this is deliberately narrow: it covers the states axe needs to see
 * - empty, populated, and the one-time secret reveal - and the role split,
 * which is the one thing about this page a screenshot cannot tell you.
 */

async function openDelivery(page: Parameters<typeof publishWidgetForLeads>[0]): Promise<void> {
  await page.goto('/workspace/delivery');
  await expect(page.getByRole('heading', { level: 1, name: /^Delivery health in / })).toBeVisible();
}

test.describe('accessibility of delivery health', () => {
  test('the page empty, then with a delivery and a webhook', async ({ page, checkA11y }) => {
    await createOwnerWithWorkspace(page, 'a11y-delivery');

    // Empty: no leads have triggered anything yet.
    await openDelivery(page);
    await expect(page.getByTestId('delivery-empty')).toBeVisible();
    await expect(page.getByTestId('webhooks-empty')).toBeVisible();
    await checkA11y(page);

    // A webhook, which reveals the signing secret exactly once. This is the
    // highest-stakes moment on the page, so it is scanned in its own right.
    /**
     * A hostname that genuinely resolves.
     *
     * The SSRF check requires the destination to resolve and then inspects
     * every address it resolves to, so an invented `receiver.example.com`
     * is refused with "that hostname does not resolve" - the check working, but
     * not what this test is about. `example.com` is IANA-reserved for exactly
     * this, resolves to public addresses, and is never actually called here.
     */
    await page.getByLabel('Endpoint URL').fill('https://example.com/hooks/leads');
    await page.getByRole('button', { name: 'Add webhook' }).click();

    const reveal = page.getByTestId('secret-reveal');
    await expect(reveal).toBeVisible();
    await expect(reveal).toContainText('cannot be shown again');
    await expect(page.getByTestId('webhook-secret')).toHaveValue(/^whsec_/);
    await checkA11y(page);

    await page.getByTestId('secret-done').click();
    await expect(reveal).toHaveCount(0);

    // A real lead, so the delivery list and the attempt ledger are populated.
    const publicId = await publishWidgetForLeads(page, 'a11y-delivery');
    await submitLead(page, publicId, {
      email: 'delivery-lead@example.invalid',
      name: 'Delivery Lead',
      message: 'Trigger a webhook.',
    });

    await openDelivery(page);
    await expect(page.getByTestId('delivery-list')).toBeVisible();
    await checkA11y(page);
  });

  test('a Member sees delivery health but none of the management controls', async ({
    page,
    browser,
    checkA11y,
  }) => {
    await createOwnerWithWorkspace(page, 'a11y-delivery-role');

    const memberEmail = uniqueEmail('a11y-delivery-member');
    const acceptUrl = await invite(page, memberEmail, 'Member');
    const memberPage = await acceptAsNewUser(browser, acceptUrl, memberEmail);

    await memberPage.goto('/workspace/delivery');
    await expect(
      memberPage.getByRole('heading', { level: 1, name: /^Delivery health in / }),
    ).toBeVisible();

    /**
     * `delivery.view` is `limited` for a Member in the section 11 matrix, so
     * they reach the page and see the state of their workspace's deliveries -
     * but every control that would change something is ABSENT rather than
     * disabled, the same treatment the audit-log link gets.
     */
    await expect(memberPage.getByRole('heading', { name: 'Webhooks' })).toHaveCount(0);
    await expect(memberPage.getByLabel('Endpoint URL')).toHaveCount(0);
    await expect(memberPage.getByTestId('delivery-summary')).toBeVisible();

    await checkA11y(memberPage);
    await memberPage.close();
  });
});
