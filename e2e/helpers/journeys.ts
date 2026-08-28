import type { Browser, Page } from '@playwright/test';
import {
  AFTER_SIGN_IN_NO_WORKSPACE,
  STRONG_PASSWORD,
  expect,
  linkFromEmail,
  uniqueEmail,
  waitForEmail,
} from '../fixtures.js';

/**
 * Journey steps shared by the auth and workspace specs.
 *
 * These drive the real UI - filling real fields and clicking real buttons -
 * rather than seeding state through the API. A test that set up its fixtures by
 * calling endpoints directly would stop proving that the pages themselves work,
 * which is the whole point of the browser suite.
 */

export async function register(page: Page, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(STRONG_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
}

export async function verifyViaEmail(page: Page, email: string): Promise<void> {
  const message = await waitForEmail(email, 'Confirm');
  const link = await linkFromEmail(message.ID);
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
}

export async function signIn(page: Page, email: string, password = STRONG_PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/**
 * Sign in and wait until the app has actually left the sign-in page.
 *
 * `signIn` deliberately does not wait, because several auth tests submit bad
 * credentials and stay put. Anywhere the next step navigates somewhere else,
 * the wait is required: without it the `goto` races the login response that
 * sets the session cookie, and the destination renders as signed out.
 */
export async function signInAndLand(
  page: Page,
  email: string,
  password = STRONG_PASSWORD,
): Promise<void> {
  await signIn(page, email, password);
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

/** Complete onboarding through the form and land in the new workspace. */
export async function onboard(page: Page, name: string): Promise<void> {
  await expect(page).toHaveURL(AFTER_SIGN_IN_NO_WORKSPACE);
  await page.getByLabel('Workspace name').fill(name);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByTestId('active-workspace')).toContainText(name);
}

export interface OwnerSetup {
  readonly email: string;
  readonly workspace: string;
}

/** A verified owner sitting in a freshly created workspace. */
export async function createOwnerWithWorkspace(page: Page, label: string): Promise<OwnerSetup> {
  const email = uniqueEmail(label);
  const workspace = `${label}-ws-${Date.now().toString(36)}`;

  await register(page, email);
  await verifyViaEmail(page, email);
  await signIn(page, email);
  await onboard(page, workspace);

  return { email, workspace };
}

/**
 * Invite someone and return the acceptance link from their email.
 *
 * The link is read out of Mailpit rather than constructed, so the test proves
 * the address the server actually sends people to.
 */
export async function invite(
  ownerPage: Page,
  email: string,
  role: 'Member' | 'Admin',
): Promise<string> {
  await ownerPage.goto('/workspace/members');
  await ownerPage.getByLabel('Email address').fill(email);
  await ownerPage.getByLabel('Role').selectOption({ label: role });
  await ownerPage.getByRole('button', { name: 'Send invitation' }).click();
  await expect(ownerPage.getByRole('status')).toContainText('Invitation sent');

  // Subject is `Join <workspace> on Lead Capture`.
  const message = await waitForEmail(email, 'Join ');
  return linkFromEmail(message.ID);
}

/**
 * Accept an invitation as a brand-new person, in their own browser context.
 *
 * A separate context is what makes this a real second user: it has its own
 * cookie jar, so the owner's session cannot leak into it and make the test pass
 * for the wrong reason.
 */
export async function acceptAsNewUser(
  browser: Browser,
  acceptUrl: string,
  email: string,
): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Opening the link while signed out explains what to do rather than failing.
  await page.goto(acceptUrl);
  await expect(page.getByRole('heading', { name: 'Sign in to join' })).toBeVisible();

  await register(page, email);
  // Confirming the address redeems every invitation waiting for it, so the
  // recipient never has to find the original email again.
  await verifyViaEmail(page, email);
  await signIn(page, email);

  await expect(page).toHaveURL(/\/workspace$/);
  return page;
}
