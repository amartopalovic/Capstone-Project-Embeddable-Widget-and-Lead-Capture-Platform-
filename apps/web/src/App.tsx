import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { RegisterPage } from './pages/RegisterPage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { MfaChallengePage } from './pages/MfaChallengePage.jsx';
import { MfaSetupPage } from './pages/MfaSetupPage.jsx';
import { VerifyEmailPage } from './pages/VerifyEmailPage.jsx';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.jsx';
import { ResetPasswordPage } from './pages/ResetPasswordPage.jsx';
import { AccountPage } from './pages/AccountPage.jsx';
import { OnboardingPage } from './pages/OnboardingPage.jsx';
import { AcceptInvitationPage } from './pages/AcceptInvitationPage.jsx';
import { WorkspaceShell } from './components/WorkspaceShell.jsx';
import { WorkspaceHomePage } from './pages/WorkspaceHomePage.jsx';
import { WidgetsPage } from './pages/WidgetsPage.jsx';
import { WidgetBuilderPage } from './pages/WidgetBuilderPage.jsx';
import { ContactsPage } from './pages/ContactsPage.jsx';
import { ContactDetailPage } from './pages/ContactDetailPage.jsx';
import { ContactTrashPage } from './pages/ContactTrashPage.jsx';
import { AnalyticsPage } from './pages/AnalyticsPage.jsx';
import { DeliveryPage } from './pages/DeliveryPage.jsx';
import { MembersPage } from './pages/MembersPage.jsx';
import { AuditLogPage } from './pages/AuditLogPage.jsx';
import { WorkspaceSettingsPage } from './pages/WorkspaceSettingsPage.jsx';
import { ConsentPage } from './pages/ConsentPage.jsx';
import { PrivacyRequestPage } from './pages/PrivacyRequestPage.jsx';
import { PrivacyConfirmPage } from './pages/PrivacyConfirmPage.jsx';
import { LandingPage } from './pages/public/LandingPage.jsx';
import { InstallDoc } from './pages/public/docs/InstallDoc.jsx';
import { DomainsDoc } from './pages/public/docs/DomainsDoc.jsx';
import { ConsentDoc } from './pages/public/docs/ConsentDoc.jsx';
import { WebhooksDoc } from './pages/public/docs/WebhooksDoc.jsx';
import { ApiDoc } from './pages/public/docs/ApiDoc.jsx';
import { TroubleshootingDoc } from './pages/public/docs/TroubleshootingDoc.jsx';
import {
  AcceptableUsePage,
  PrivacyPolicyPage,
  StoragePage,
  TermsPage,
} from './pages/public/PolicyPages.jsx';

/**
 * Application routes.
 *
 * Two areas: the auth surface from Stage 3b, and the workspace surface added in
 * Stage 4b. `/` now points into the workspace rather than at sign-in, because
 * there is finally somewhere to land.
 *
 * The workspace routes sit under one `WorkspaceShell` parent. The shell is what
 * decides where an authenticated user actually belongs - sign-in for a stranger,
 * onboarding for someone with no workspace yet, otherwise the workspace itself -
 * so the guard exists once instead of on each child.
 *
 * The guard is a component rather than a route loader. React Router supports
 * loaders here in data mode, and they avoid a render pass before redirecting,
 * but every existing page in this app fetches from a component; introducing a
 * second data-loading paradigm for four routes would cost more in consistency
 * than the extra render costs. Stage 12 can move the whole surface to loaders
 * at once if the dashboard warrants it.
 *
 * Paths match the links the server puts in its emails (`/auth/verify?token=`,
 * `/auth/reset?token=`, `/invitations/accept?token=`, and Stage 11's
 * `/consent/*` and `/privacy/confirm?token=`), so those links resolve.
 *
 * The catch-all redirects to sign-in, which is right for a stray dashboard URL
 * and wrong for a stranger who mistyped a consent link - they have no account
 * to sign in to. That is why the consent pages handle a missing token
 * themselves rather than relying on the route to be exact.
 */
const router = createBrowserRouter([
  /*
   * --- the public site (Stage 12a) ---
   *
   * `/` is the landing page rather than a redirect into the workspace. Until
   * this stage the root sent everybody to sign-in, which is the right answer
   * for a customer and the wrong one for the far more common visitor here: an
   * evaluator with no account, who needs to find out what this is.
   *
   * A signed-in person is one click from the dashboard in the header, and the
   * workspace routes are unchanged.
   */
  { path: '/', element: <LandingPage /> },

  { path: '/docs/install', element: <InstallDoc /> },
  { path: '/docs/domains', element: <DomainsDoc /> },
  { path: '/docs/consent', element: <ConsentDoc /> },
  { path: '/docs/webhooks', element: <WebhooksDoc /> },
  { path: '/docs/api', element: <ApiDoc /> },
  { path: '/docs/troubleshooting', element: <TroubleshootingDoc /> },
  { path: '/docs', element: <Navigate to="/docs/install" replace /> },

  { path: '/policies/privacy', element: <PrivacyPolicyPage /> },
  { path: '/policies/terms', element: <TermsPage /> },
  { path: '/policies/storage', element: <StoragePage /> },
  { path: '/policies/acceptable-use', element: <AcceptableUsePage /> },
  { path: '/policies', element: <Navigate to="/policies/privacy" replace /> },

  // --- auth surface (Stage 3a/3b) ---
  { path: '/register', element: <RegisterPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/mfa-challenge', element: <MfaChallengePage /> },
  { path: '/mfa-setup', element: <MfaSetupPage /> },
  { path: '/auth/verify', element: <VerifyEmailPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/auth/reset', element: <ResetPasswordPage /> },
  { path: '/account', element: <AccountPage /> },

  /*
   * --- public consent and privacy surface (Stage 11) ---
   *
   * Outside every guard, and deliberately not under the workspace shell. Nobody
   * who lands here has an account: they followed a link out of an email, and
   * the token in the query string is the only thing identifying them. Paths
   * match the links the server puts in its emails.
   */
  { path: '/consent/unsubscribe', element: <ConsentPage purpose="unsubscribe" /> },
  { path: '/consent/confirm', element: <ConsentPage purpose="confirm" /> },
  { path: '/privacy', element: <PrivacyRequestPage /> },
  { path: '/privacy/confirm', element: <PrivacyConfirmPage /> },

  // --- workspace surface (Stage 4b) ---
  { path: '/onboarding', element: <OnboardingPage /> },
  { path: '/invitations/accept', element: <AcceptInvitationPage /> },
  {
    path: '/workspace',
    element: <WorkspaceShell />,
    children: [
      { index: true, element: <WorkspaceHomePage /> },
      { path: 'widgets', element: <WidgetsPage /> },
      { path: 'widgets/:widgetId', element: <WidgetBuilderPage /> },
      /*
       * `trash` is declared before `:contactId` so the literal path wins; a
       * route order that let the parameter match first would send someone to a
       * lead detail page for a lead called "trash".
       */
      { path: 'contacts', element: <ContactsPage /> },
      { path: 'contacts/trash', element: <ContactTrashPage /> },
      { path: 'contacts/:contactId', element: <ContactDetailPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'delivery', element: <DeliveryPage /> },
      { path: 'members', element: <MembersPage /> },
      { path: 'audit', element: <AuditLogPage /> },
      { path: 'settings', element: <WorkspaceSettingsPage /> },
    ],
  },

  { path: '*', element: <Navigate to="/login" replace /> },
]);

export function App(): React.JSX.Element {
  return <RouterProvider router={router} />;
}
