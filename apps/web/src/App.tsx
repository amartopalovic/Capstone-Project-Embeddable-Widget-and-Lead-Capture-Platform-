import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { RegisterPage } from './pages/RegisterPage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { MfaChallengePage } from './pages/MfaChallengePage.jsx';
import { MfaSetupPage } from './pages/MfaSetupPage.jsx';
import { VerifyEmailPage } from './pages/VerifyEmailPage.jsx';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.jsx';
import { ResetPasswordPage } from './pages/ResetPasswordPage.jsx';
import { AccountPage } from './pages/AccountPage.jsx';

/**
 * Routes for the authentication surface.
 *
 * Only auth exists here. The landing page, dashboard, and workspace switcher
 * arrive in Stages 4 and 12, so `/` simply redirects to sign in rather than
 * pretending there is somewhere else to go.
 *
 * Paths match the links the server puts in verification and reset emails
 * (`/auth/verify?token=` and `/auth/reset?token=`), so those links resolve.
 */
const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/login" replace /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/mfa-challenge', element: <MfaChallengePage /> },
  { path: '/mfa-setup', element: <MfaSetupPage /> },
  { path: '/auth/verify', element: <VerifyEmailPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/auth/reset', element: <ResetPasswordPage /> },
  { path: '/account', element: <AccountPage /> },
  { path: '*', element: <Navigate to="/login" replace /> },
]);

export function App(): React.JSX.Element {
  return <RouterProvider router={router} />;
}
