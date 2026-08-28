import { useState, type SubmitEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PASSWORD_MIN_LENGTH } from '@lcp/contracts';
import { api, fieldError, type ApiFailure } from '../lib/api.js';
import { Alert, AuthPanel, Button, Field, PasswordStrength } from '../components/ui.jsx';

export function ResetPasswordPage(): React.JSX.Element {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFailure(null);

    const result = await api.post('/auth/password/reset-confirm', { token, password });
    setBusy(false);

    if (result.ok) setDone(true);
    else setFailure(result);
  }

  if (done) {
    return (
      <AuthPanel
        title="Password changed"
        intro="You were signed out everywhere else, so any other device will need to sign in again."
        footer={<Link to="/login">Sign in</Link>}
      >
        <Alert tone="success">Use your new password to sign in.</Alert>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel title="Choose a new password" footer={<Link to="/login">Back to sign in</Link>}>
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        {/*
          Always shown on failure, including when the detail is a field error.
          Focus stays on the submit button after a failed submission, so a
          field-level message alone is never announced; this assertive alert is
          what tells a screen-reader user that anything happened.
        */}
        {failure !== null && <Alert tone="error">{failure.message}</Alert>}

        <Field
          label="New password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint={`At least ${String(PASSWORD_MIN_LENGTH)} characters.`}
          error={failure === null ? undefined : fieldError(failure, 'password')}
        />

        <PasswordStrength value={password} />

        <Button type="submit" busy={busy}>
          Change password
        </Button>
      </form>
    </AuthPanel>
  );
}
