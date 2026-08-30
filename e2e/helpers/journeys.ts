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

// ---------------------------------------------------------------------------
// Widgets (Stage 5b)
// ---------------------------------------------------------------------------

/** Create a widget through the UI and open its builder. */
export async function createWidget(
  page: Page,
  type: 'Contact form' | 'Email signup' | 'CTA popover',
  name: string,
): Promise<void> {
  await page.goto('/workspace/widgets');
  await page.getByRole('radio', { name: new RegExp(type) }).check();
  // Addressed as a textbox: each type radio's accessible name includes its
  // description, and one of those descriptions begins with the word "Name".
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create widget' }).click();

  await expect(page.getByText('was created')).toBeVisible();
  await page.getByRole('link', { name: `Edit ${name}` }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

/** Add one allowed domain, which blueprint 4.4 requires before publishing. */
export async function addAllowedDomain(page: Page, domain: string): Promise<void> {
  await page.getByRole('button', { name: 'Add allowed domains' }).click();
  const list = page.getByTestId('allowed-domains');
  await list.getByRole('textbox').last().fill(domain);
}

export async function saveDraft(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();
}

export async function publishWidget(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText(/Published revision \d+/)).toBeVisible();
}

/**
 * A widget that is ready to publish: named, with an allowed domain, saved.
 *
 * Returns the headline it set, so a test can assert the live revision keeps it
 * after somebody else edits the draft.
 */
export async function createPublishableWidget(
  page: Page,
  name: string,
  headline: string,
): Promise<string> {
  await createWidget(page, 'Contact form', name);
  await page.getByLabel('Headline').fill(headline);
  await addAllowedDomain(page, 'example.com');
  await saveDraft(page);
  // The builder URL, because `invite` navigates the page away and callers
  // routinely need to come back to it.
  return page.url();
}

// ---------------------------------------------------------------------------
// Contacts (Stage 8b)
// ---------------------------------------------------------------------------

/** Where the widget is installed in these tests, and what the allowlist admits. */
export const LEAD_ORIGIN = 'http://localhost:5174';

/**
 * Publish a widget that accepts leads from the demo origin, and return its
 * public id.
 *
 * Built through the real builder UI rather than seeded, so the inbox tests
 * start from a widget a person could actually have made.
 */
export async function publishWidgetForLeads(page: Page, label: string): Promise<string> {
  await createWidget(page, 'Contact form', `${label} widget`);
  // The demo runs on localhost, so that is the host the allowlist must admit.
  await addAllowedDomain(page, 'localhost');
  await saveDraft(page);
  await publishWidget(page);

  const publicId = (await page.locator('main p.font-mono').first().innerText())
    .split('\u00b7')[0]
    ?.trim();
  expect(publicId).toMatch(/^w_[a-z2-9]{16}$/);
  return publicId ?? '';
}

let leadCounter = 0;

/**
 * Submit a lead to the real public endpoint.
 *
 * Posted directly rather than typed into the rendered widget, because the
 * Stage 6 runtime still stops at a typed seam and does not post anywhere yet.
 * The endpoint, the Origin check, and the whole Stage 7 pipeline are real; only
 * the visitor's keystrokes are not, and they are not what these tests are
 * about.
 */
export async function submitLead(
  page: Page,
  publicId: string,
  values: Record<string, string>,
): Promise<void> {
  leadCounter += 1;
  const response = await page.request.post(`http://localhost:5173/widget/v1/submit/${publicId}`, {
    headers: { origin: LEAD_ORIGIN, 'content-type': 'application/json' },
    data: {
      idempotencyKey: `e2e-lead-${String(Date.now())}-${String(leadCounter)}`,
      values,
      pageUrl: `${LEAD_ORIGIN}/pricing`,
      // Comfortably past the timing floor, so the heuristic accepts it.
      renderedAt: Date.now() - 30_000,
    },
  });
  expect(response.status()).toBe(202);
}

/** Open the inbox and wait for it to finish loading. */
export async function openInbox(page: Page): Promise<void> {
  await page.goto('/workspace/contacts');
  await expect(page.getByRole('heading', { level: 1, name: /^Leads in / })).toBeVisible();
}

// ---------------------------------------------------------------------------
// Analytics (Stage 10b)
// ---------------------------------------------------------------------------

/**
 * Post funnel events to the real public endpoint.
 *
 * Posted directly rather than driven through a rendered widget: the runtime's
 * instrumentation has its own coverage, and a dashboard test needs a KNOWN
 * shape of data - four impressions and two opens, exactly - which scripted
 * browser interaction cannot promise.
 */
export async function sendFunnelEvents(
  page: Page,
  publicId: string,
  types: readonly string[],
  pageUrl = `${LEAD_ORIGIN}/pricing`,
): Promise<void> {
  const response = await page.request.post(`http://localhost:5173/widget/v1/events/${publicId}`, {
    headers: { origin: LEAD_ORIGIN, 'content-type': 'application/json' },
    data: { events: types.map((type) => ({ type, pageUrl })) },
  });
  expect(response.status()).toBe(202);
}

/** Open the analytics dashboards and wait for them to settle. */
export async function openAnalytics(page: Page): Promise<void> {
  await page.goto('/workspace/analytics');
  await expect(
    page.getByRole('heading', { level: 1, name: 'How your widgets are doing' }),
  ).toBeVisible();
}
