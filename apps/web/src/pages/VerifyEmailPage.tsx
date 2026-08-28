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
  // Confirming an address also redeems any invitations waiting for it, so the
  // page can tell someone they have already been let in.
  const [joined, setJoined] = useState(0);
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
      const result = await api.post<{ joinedWorkspaces?: number }>('/auth/verify', { token });
      if (result.ok) {
        setJoined(result.data.joinedWorkspaces ?? 0);
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
        intro={
          joined > 0
            ? 'Your address is verified, and the invitations waiting for it have been accepted.'
            : 'Your address is verified. You can now invite teammates to your workspace.'
        }
        footer={<Link to="/login">Continue to sign in</Link>}
      >
        <Alert tone="success">
          {joined > 0
            ? `All set. You joined ${String(joined)} workspace${joined === 1 ? '' : 's'}.`
            : 'All set.'}
        </Alert>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel title="That link did not work" footer={<Link to="/login">Back to sign in</Link>}>
      <Alert tone="error">{message}</Alert>
    </AuthPanel>
  );
}
