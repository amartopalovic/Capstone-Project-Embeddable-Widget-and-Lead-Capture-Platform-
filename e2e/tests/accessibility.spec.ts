import * as OTPAuth from 'otpauth';
import {
  STRONG_PASSWORD,
  expect,
  linkFromEmail,
  test,
  uniqueEmail,
  waitForEmail,
} from '../fixtures.js';

/**
 * Automated accessibility checks on every auth page (blueprint 14.1: WCAG 2.2
 * AA target).
 *
 * Automated scanning catches roughly a third of real accessibility problems, so
 * a clean run is a floor rather than a certificate. The keyboard-operation test
 * at the bottom covers one of the things axe cannot: whether the flow can
 * actually be completed without a mouse.
 */

test.describe('accessibility of the auth surface', () => {
  test('registration page', async ({ page, checkA11y }) => {
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await checkA11y(page);
  });

  test('sign-in page', async ({ page, checkA11y }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await checkA11y(page);
  });

  test('forgot-password page', async ({ page, checkA11y }) => {
    await page.goto('/forgot-password');
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await checkA11y(page);
  });

  test('reset-password page', async ({ page, checkA11y }) => {
    await page.goto('/auth/reset?token=placeholder-token-for-rendering');
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await checkA11y(page);
  });

  test('a form showing validation errors stays accessible', async ({ page, checkA11y }) => {
    // Error states are a common source of violations, so scan one rather than
    // only the pristine form.
    await page.goto('/register');
    await page.getByLabel('Email').fill(uniqueEmail('a11y'));
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await checkA11y(page);
  });

  test('verification result page', async ({ page, checkA11y }) => {
    const email = uniqueEmail('a11yverify');
    await page.goto('/register');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(STRONG_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await checkA11y(page);

    const message = await waitForEmail(email, 'Confirm');
    await page.goto(await linkFromEmail(message.ID));
    await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
    await checkA11y(page);
  });

  test('account, MFA setup, MFA challenge, and recovery-code pages', async ({
    page,
    checkA11y,
  }) => {
    const email = uniqueEmail('a11yaccount');

    await page.goto('/register');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(STRONG_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(STRONG_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/account$/);

    // Account page, MFA off.
    await checkA11y(page);

    // MFA setup, step 1.
    await page.goto('/mfa-setup');
    await expect(page.getByTestId('manual-entry-key')).toBeVisible();
    await checkA11y(page);

    // MFA setup, recovery codes.
    const secret = (await page.getByTestId('manual-entry-key').textContent())?.trim() ?? '';
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
    await page.getByLabel('Code from your app').fill(totp.generate());
    await page.getByRole('button', { name: 'Turn on two-step verification' }).click();
    await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
    await checkA11y(page);

    await page.getByRole('button', { name: 'I have saved these codes' }).click();
    await expect(page).toHaveURL(/\/account$/);

    // Account page with MFA on and a device list.
    await checkA11y(page);

    // MFA challenge page.
    await page.getByTestId('sign-out').click();
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(STRONG_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/mfa-challenge$/);
    await checkA11y(page);
  });

  test('sign-in can be completed with the keyboard alone', async ({ page }) => {
    const email = uniqueEmail('keyboard');

    /**
     * Walk forward with Tab until the wanted control has focus.
     *
     * Asserting focus ORDER rather than an exact tab count is the property that
     * actually matters, and it does not depend on where the browser happens to
     * place initial focus on a fresh document.
     */
    async function tabTo(label: string, limit = 8): Promise<void> {
      for (let step = 0; step < limit; step += 1) {
        if (await page.getByLabel(label).evaluate((node) => node === document.activeElement)) {
          return;
        }
        await page.keyboard.press('Tab');
      }
      throw new Error(`Could not reach "${label}" with the keyboard in ${String(limit)} steps`);
    }

    await page.goto('/register');
    await tabTo('Email');
    await page.keyboard.type(email);

    // The very next stop must be the password field: a logical order.
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Password')).toBeFocused();
    await page.keyboard.type(STRONG_PASSWORD);

    // And the next is the submit button.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Create account' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    // Sign in the same way, with no mouse at any point.
    await page.goto('/login');
    await tabTo('Email');
    await page.keyboard.type(email);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Password')).toBeFocused();
    await page.keyboard.type(STRONG_PASSWORD);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/account$/);
  });
});
