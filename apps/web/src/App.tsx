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
import { MembersPage } from './pages/MembersPage.jsx';
import { AuditLogPage } from './pages/AuditLogPage.jsx';
import { WorkspaceSettingsPage } from './pages/WorkspaceSettingsPage.jsx';

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
 * `/auth/reset?token=`, and `/invitations/accept?token=`), so those links
 * resolve.
 */
const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/workspace" replace /> },

  // --- auth surface (Stage 3a/3b) ---
  { path: '/register', element: <RegisterPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/mfa-challenge', element: <MfaChallengePage /> },
  { path: '/mfa-setup', element: <MfaSetupPage /> },
  { path: '/auth/verify', element: <VerifyEmailPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/auth/reset', element: <ResetPasswordPage /> },
  { path: '/account', element: <AccountPage /> },

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
