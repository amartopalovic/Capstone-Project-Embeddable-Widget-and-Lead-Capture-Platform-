import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../lib/api.js';
import { Alert, AuthPanel } from '../components/ui.jsx';

type State = 'working' | 'verified' | 'failed';

/** Handles the link from a verification email. */
export function VerifyEmailPage(): React.JSX.Element {
  const [params] = useSearchParams();
  const [state, setState] = useState<State>('working');
  const [message, setMessage] = useState('');
  // React 18+ StrictMode mounts effects twice in development; the token is
  // single-use, so a second submit would fail and show a spurious error.
  const submitted = useRef(false);

  useEffect(() => {
    const token = params.get('token');
    if (token === null || token === '') {
      setState('failed');
      setMessage('This link is missing its token. Request a new confirmation email.');
      return;
    }
    if (submitted.current) return;
    submitted.current = true;

    void (async () => {
      const result = await api.post('/auth/verify', { token });
      if (result.ok) {
        setState('verified');
      } else {
        setState('failed');
        setMessage(result.message);
      }
    })();
  }, [params]);

  if (state === 'working') {
    return (
      <AuthPanel title="Confirming your email">
        <Alert tone="info">Just a moment.</Alert>
      </AuthPanel>
    );
  }

  if (state === 'verified') {
    return (
      <AuthPanel
        title="Email confirmed"
        intro="Your address is verified. You can publish widgets and invite teammates once those features arrive."
        footer={<Link to="/login">Continue to sign in</Link>}
      >
        <Alert tone="success">All set.</Alert>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel title="That link did not work" footer={<Link to="/login">Back to sign in</Link>}>
      <Alert tone="error">{message}</Alert>
    </AuthPanel>
  );
}
