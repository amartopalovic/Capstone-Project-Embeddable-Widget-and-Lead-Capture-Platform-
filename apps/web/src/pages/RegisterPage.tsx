import { useState, type SubmitEvent } from 'react';
import { Link } from 'react-router';
import { PASSWORD_MIN_LENGTH } from '@lcp/contracts';
import { api, fieldError, type ApiFailure } from '../lib/api.js';
import { Alert, AuthPanel, Button, Field, PasswordStrength } from '../components/ui.jsx';

export function RegisterPage(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFailure(null);

    const result = await api.post('/auth/register', { email, password });
    setBusy(false);

    if (result.ok) setSent(true);
    else setFailure(result);
  }

  if (sent) {
    return (
      <AuthPanel
        title="Check your email"
        intro="If that address can receive mail, a confirmation link is on its way. The link is valid for 24 hours."
        footer={<Link to="/login">Back to sign in</Link>}
      >
        <Alert tone="success">Open the link in the email to finish setting up your account.</Alert>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel
      title="Create your account"
      intro="Build lead-capture widgets and install them with one script tag."
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        {/*
          Always shown on failure, including when the detail is a field error.
          Focus stays on the submit button after a failed submission, so a
          field-level message alone is never announced; this assertive alert is
          what tells a screen-reader user that anything happened.
        */}
        {failure !== null && <Alert tone="error">{failure.message}</Alert>}

        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={failure === null ? undefined : fieldError(failure, 'email')}
        />

        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint={`At least ${String(PASSWORD_MIN_LENGTH)} characters. Avoid anything you use elsewhere.`}
          error={failure === null ? undefined : fieldError(failure, 'password')}
        />

        <PasswordStrength value={password} />

        <Button type="submit" busy={busy}>
          Create account
        </Button>
      </form>
    </AuthPanel>
  );
}
