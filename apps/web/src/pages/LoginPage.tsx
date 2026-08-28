import { useState, type SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { LoginResult } from '@lcp/contracts';
import { api, invalidateCsrfToken, type ApiFailure } from '../lib/api.js';
import { Alert, AuthPanel, Button, Field } from '../components/ui.jsx';

export function LoginPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFailure(null);

    const result = await api.post<LoginResult>('/auth/login', { email, password });
    setBusy(false);

    if (!result.ok) {
      setFailure(result);
      return;
    }

    // A new session means the previous CSRF token no longer binds.
    invalidateCsrfToken();

    if (result.data.status === 'mfa_required') {
      await navigate('/mfa-challenge');
      return;
    }
    await navigate('/account');
  }

  return (
    <AuthPanel
      title="Sign in"
      footer={
        <>
          Need an account? <Link to="/register">Create one</Link>
        </>
      }
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        {failure !== null && <Alert tone="error">{failure.message}</Alert>}

        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <Button type="submit" busy={busy}>
          Sign in
        </Button>

        <p className="mt-5 text-center text-sm">
          <Link to="/forgot-password" className="text-muted underline">
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthPanel>
  );
}
