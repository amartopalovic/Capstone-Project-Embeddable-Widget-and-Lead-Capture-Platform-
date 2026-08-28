import * as OTPAuth from 'otpauth';
import type { Page } from '@playwright/test';
import { register, signIn, verifyViaEmail } from '../helpers/journeys.js';
import {
  AFTER_SIGN_IN_NO_WORKSPACE,
  STRONG_PASSWORD,
  expect,
  linkFromEmail,
  test,
  uniqueEmail,
  waitForEmail,
} from '../fixtures.js';

/**
 * Blueprint 18.3, journey 1 (auth portion): register, verify, sign in, and
 * manage sessions - driven through the real UI against the real stack.
 */

/**
 * Wait until the TOTP period rolls over.
 *
 * The server refuses a code whose counter it has already accepted, which is a
 * real replay defence rather than a test inconvenience: a code stays valid for
 * its whole 30-second window, so accepting one twice would let an observed code
 * be reused. A test that needs a second, genuinely different code has to wait.
 */
async function waitForNextTotpPeriod(secret: string): Promise<void> {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
  await new Promise((resolve) => setTimeout(resolve, totp.remaining() + 1000));
}

/** Enable MFA through the UI, returning the secret and the recovery codes. */
async function enableMfa(page: Page): Promise<{ secret: string; recoveryCodes: string[] }> {
  await page.goto('/mfa-setup');
  await expect(page.getByRole('heading', { name: 'Turn on two-step verification' })).toBeVisible();

  // The manual-entry key is the same secret the QR image encodes.
  const secret = (await page.getByTestId('manual-entry-key').textContent())?.trim() ?? '';
  expect(secret.length).toBeGreaterThan(20);

  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
  await page.getByLabel('Code from your app').fill(totp.generate());
  await page.getByRole('button', { name: 'Turn on two-step verification' }).click();

  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  const recoveryCodes = await page
    .getByTestId('recovery-codes')
    .getByRole('listitem')
    .allTextContents();
  expect(recoveryCodes.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'I have saved these codes' }).click();
  await expect(page).toHaveURL(/\/account$/);

  return { secret, recoveryCodes: recoveryCodes.map((code) => code.trim()) };
}

test.describe('registration, verification, and sign in', () => {
  test('a new user can register, confirm their email, and sign in', async ({ page }) => {
    const email = uniqueEmail('journey');

    await register(page, email);
    await verifyViaEmail(page, email);
    await signIn(page, email);

    // Stage 4b: a verified user with no workspace yet lands on onboarding.
    await expect(page).toHaveURL(AFTER_SIGN_IN_NO_WORKSPACE);

    await page.goto('/account');
    await expect(page.getByRole('heading', { name: email })).toBeVisible();
    await expect(page.getByText('Email confirmed')).toBeVisible();
  });

  test('an unconfirmed account can still sign in, and the page says so', async ({ page }) => {
    // Blueprint 4.1: unverified users may use the dashboard; only publishing
    // and inviting are gated, and neither exists yet.
    const email = uniqueEmail('unverified');
    await register(page, email);
    await signIn(page, email);

    // Blueprint 4.1 gives unverified users the dashboard, so they land in the
    // same place; only inviting and publishing are blocked.
    await expect(page).toHaveURL(AFTER_SIGN_IN_NO_WORKSPACE);

    await page.goto('/account');
    await expect(page.getByText('Email not confirmed yet.')).toBeVisible();
  });

  test('a wrong password shows a generic error that does not reveal the account', async ({
    page,
  }) => {
    const known = uniqueEmail('generic');
    await register(page, known);

    await signIn(page, known, 'definitely-not-the-password');
    await expect(page.getByRole('alert')).toBeVisible();
    const wrongPasswordText = await page.getByRole('alert').textContent();

    await signIn(page, uniqueEmail('ghost'), 'definitely-not-the-password');
    await expect(page.getByRole('alert')).toBeVisible();
    const unknownAccountText = await page.getByRole('alert').textContent();

    // Identical wording for a real account and one that does not exist.
    expect(wrongPasswordText).toBe(unknownAccountText);
    expect(wrongPasswordText).toContain('Email or password is incorrect');
  });

  test('a verification link cannot be used twice', async ({ page }) => {
    const email = uniqueEmail('replay');
    await register(page, email);

    const message = await waitForEmail(email, 'Confirm');
    const link = await linkFromEmail(message.ID);

    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();

    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'That link did not work' })).toBeVisible();
  });

  test('a weak or breached password is rejected with a reason', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Email').fill(uniqueEmail('weak'));
    await page.getByLabel('Password').fill('password1234');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText(/breach|too common/i)).toBeVisible();
  });
});

test.describe('password reset', () => {
  test('resetting the password signs out existing sessions and lets the new one in', async ({
    page,
    context,
  }) => {
    const email = uniqueEmail('reset');
    await register(page, email);
    await verifyViaEmail(page, email);
    await signIn(page, email);
    await expect(page).toHaveURL(AFTER_SIGN_IN_NO_WORKSPACE);

    const browser = context.browser();
    if (browser === null) throw new Error('No browser available');
    const other = await browser.newContext();
    const resetPage = await other.newPage();

    await resetPage.goto('/forgot-password');
    await resetPage.getByLabel('Email').fill(email);
    await resetPage.getByRole('button', { name: 'Send reset link' }).click();
    await expect(resetPage.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    const message = await waitForEmail(email, 'Reset');
    const link = await linkFromEmail(message.ID);

    const newPassword = 'amber-tortoise-window-5512';
    await resetPage.goto(link);
    await resetPage.getByLabel('New password').fill(newPassword);
    await resetPage.getByRole('button', { name: 'Change password' }).click();
    await expect(resetPage.getByRole('heading', { name: 'Password changed' })).toBeVisible();

    // The original session is dead: the account page bounces to sign in.
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login$/);

    // The new password works.
    await signIn(page, email, newPassword);
    await expect(page).toHaveURL(AFTER_SIGN_IN_NO_WORKSPACE);

    await other.close();
  });
});

test.describe('two-step verification', () => {
  test('enabling MFA gates sign-in, and a recovery code works exactly once', async ({ page }) => {
    const email = uniqueEmail('mfa');
    await register(page, email);
    await verifyViaEmail(page, email);
    await signIn(page, email);
    await expect(page).toHaveURL(AFTER_SIGN_IN_NO_WORKSPACE);

    const { secret, recoveryCodes } = await enableMfa(page);
    await expect(page.getByTestId('mfa-state')).toContainText('On.');

    // Sign out, then sign back in: the password alone is no longer enough.
    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL(/\/login$/);

    await signIn(page, email);
    await expect(page).toHaveURL(/\/mfa-challenge$/);
    await expect(page.getByRole('heading', { name: 'Enter your verification code' })).toBeVisible();

    // A wrong code is refused.
    await page.getByLabel('Authentication code').fill('000000');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('did not match');

    // A recovery code completes the sign-in.
    const firstCode = recoveryCodes[0] ?? '';
    await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
    await page.getByLabel('Recovery code').fill(firstCode);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(AFTER_SIGN_IN_NO_WORKSPACE);

    // That same recovery code must not work a second time. Signing out lives
    // on the account page, which is no longer where signing in lands.
    await page.goto('/account');
    await page.getByTestId('sign-out').click();
    await signIn(page, email);
    await expect(page).toHaveURL(/\/mfa-challenge$/);
    await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
    await page.getByLabel('Recovery code').fill(firstCode);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('did not match');

    // A TOTP code still works, so the account is not locked out. The counter
    // used during enrollment has already been spent, so wait for a new one.
    await waitForNextTotpPeriod(secret);
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
    await page.getByRole('button', { name: 'Use your authenticator app instead' }).click();
    await page.getByLabel('Authentication code').fill(totp.generate());
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(AFTER_SIGN_IN_NO_WORKSPACE);
  });

  test('turning MFA off requires the password and a current code', async ({ page }) => {
    const email = uniqueEmail('mfaoff');
    await register(page, email);
    await verifyViaEmail(page, email);
    await signIn(page, email);
    // Wait for the session to be established before enrolling; otherwise the
    // enroll request races the login response setting the cookie.
    await expect(page).toHaveURL(AFTER_SIGN_IN_NO_WORKSPACE);

    const { secret } = await enableMfa(page);
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });

    // Enrollment consumed the current counter, so disabling needs a later one.
    await waitForNextTotpPeriod(secret);
    await page.getByRole('button', { name: 'Turn off two-step verification' }).click();

    // A wrong password is refused even alongside a valid code.
    await page.getByLabel('Password').fill('not-the-right-password');
    await page.getByLabel('Code from your app').fill(totp.generate());
    await page.getByRole('button', { name: 'Turn off', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('incorrect');

    // The correct password and a fresh code turns it off. The failed attempt
    // above did not consume the code, because the password is checked first.
    await page.getByLabel('Password').fill(STRONG_PASSWORD);
    await page.getByLabel('Code from your app').fill(totp.generate());
    await page.getByRole('button', { name: 'Turn off', exact: true }).click();

    await expect(page.getByTestId('mfa-state')).toContainText('Off.');
  });
});

test.describe('device and session management', () => {
  test('a user can see their devices and sign them out individually or together', async ({
    page,
    context,
  }) => {
    const email = uniqueEmail('devices');
    await register(page, email);
    await signIn(page, email);
    await expect(page).toHaveURL(AFTER_SIGN_IN_NO_WORKSPACE);

    const browser = context.browser();
    if (browser === null) throw new Error('No browser available');

    const second = await browser.newContext();
    const secondPage = await second.newPage();
    await signIn(secondPage, email);
    await expect(secondPage).toHaveURL(AFTER_SIGN_IN_NO_WORKSPACE);

    const third = await browser.newContext();
    const thirdPage = await third.newPage();
    await signIn(thirdPage, email);
    await expect(thirdPage).toHaveURL(AFTER_SIGN_IN_NO_WORKSPACE);

    // The device list lives on the account page, not where sign-in lands.
    await page.goto('/account');
    const deviceList = page.getByTestId('device-list');
    await expect(deviceList.getByRole('listitem')).toHaveCount(3);
    await expect(page.getByText('this device')).toBeVisible();

    // Sign out one other device.
    await deviceList
      .getByRole('button', { name: /^Sign out/ })
      .nth(1)
      .click();
    await expect(page.getByText('That device was signed out.')).toBeVisible();
    await expect(deviceList.getByRole('listitem')).toHaveCount(2);

    // Then sign out everything else, keeping this device signed in.
    await page.getByRole('button', { name: 'Sign out all other devices' }).click();
    await expect(page.getByText(/Signed out 1 other device/)).toBeVisible();
    await expect(deviceList.getByRole('listitem')).toHaveCount(1);

    // The other contexts really are out.
    await secondPage.goto('/account');
    await expect(secondPage).toHaveURL(/\/login$/);
    await thirdPage.goto('/account');
    await expect(thirdPage).toHaveURL(/\/login$/);

    // This device is still in.
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: email })).toBeVisible();

    await second.close();
    await third.close();
  });
});
