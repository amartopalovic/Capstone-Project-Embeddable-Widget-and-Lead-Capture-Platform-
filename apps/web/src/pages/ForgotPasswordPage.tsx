import { useState, type SubmitEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api.js';
import { Alert, AuthPanel, Button, Field } from '../components/ui.jsx';

export function ForgotPasswordPage(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    await api.post('/auth/password/reset-request', { email });
    setBusy(false);
    // Always the same outcome, matching the server: whether the address exists
    // must not be observable here either (blueprint 10.3).
    setSent(true);
  }

  if (sent) {
    return (
      <AuthPanel
        title="Check your email"
        intro="If that address has an account, a reset link is on its way. The link is valid for one hour."
        footer={<Link to="/login">Back to sign in</Link>}
      >
        <Alert tone="success">Open the link to choose a new password.</Alert>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel
      title="Reset your password"
      intro="Enter the address you signed up with and we will send a reset link."
      footer={<Link to="/login">Back to sign in</Link>}
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" busy={busy}>
          Send reset link
        </Button>
      </form>
    </AuthPanel>
  );
}
