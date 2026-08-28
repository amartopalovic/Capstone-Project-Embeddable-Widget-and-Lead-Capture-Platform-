import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { AuthenticatedUser, MfaStatus, SessionSummary } from '@lcp/contracts';
import { api, invalidateCsrfToken, type ApiFailure } from '../lib/api.js';
import { Alert, Button, Field } from '../components/ui.jsx';

/**
 * Account security: verification state, two-step verification, and the device
 * list with revoke controls.
 *
 * This is deliberately NOT a dashboard. There is no navigation, no workspace
 * switcher, and no product chrome, because none of that exists until Stage 4
 * and Stage 12. It is the security surface for the account and nothing else.
 */
export function AccountPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [mfa, setMfa] = useState<MfaStatus | null>(null);
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDisable, setShowDisable] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const me = await api.get<{ user: AuthenticatedUser }>('/auth/me');
    if (!me.ok) {
      await navigate('/login');
      return;
    }
    setUser(me.data.user);

    const [mfaResult, sessionResult] = await Promise.all([
      api.get<MfaStatus>('/mfa'),
      api.get<{ sessions: SessionSummary[] }>('/sessions'),
    ]);
    if (mfaResult.ok) setMfa(mfaResult.data);
    if (sessionResult.ok) setSessions(sessionResult.data.sessions);
    setLoading(false);
  }, [navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revokeOne(sessionId: string): Promise<void> {
    setNotice(null);
    const result = await api.delete(`/sessions/${sessionId}`);
    if (result.ok) {
      setNotice('That device was signed out.');
      await load();
    } else {
      setFailure(result);
    }
  }

  async function revokeOthers(): Promise<void> {
    setNotice(null);
    const result = await api.post<{ revoked: number }>('/sessions/revoke-all');
    if (result.ok) {
      setNotice(`Signed out ${String(result.data.revoked)} other device(s).`);
      await load();
    } else {
      setFailure(result);
    }
  }

  async function signOut(): Promise<void> {
    await api.post('/auth/logout');
    invalidateCsrfToken();
    await navigate('/login');
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-16">
        <p className="text-muted">Loading your account.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <header className="mb-10 border-b border-edge pb-6">
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">
            Account security
          </p>
          {/* Stage 4b gives this page somewhere to go back to. */}
          <Link to="/workspace" className="text-sm text-muted underline hover:text-ink">
            Back to workspace
          </Link>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">{user?.email}</h1>
        <p className="mt-2 text-sm text-muted">
          {user?.emailVerified === true ? (
            <span className="text-secure">Email confirmed</span>
          ) : (
            <>Email not confirmed yet. Check your inbox for the confirmation link.</>
          )}
        </p>
      </header>

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {failure !== null && <Alert tone="error">{failure.message}</Alert>}

      {/* --- Two-step verification --- */}
      <section aria-labelledby="mfa-heading" className="mb-10">
        <h2 id="mfa-heading" className="text-lg font-semibold text-ink">
          Two-step verification
        </h2>
        <p className="mt-1.5 text-sm text-muted">
          Ask for a code from your authenticator app whenever you sign in.
        </p>

        <div className="mt-4 border border-edge bg-panel p-5">
          {mfa?.enabled === true ? (
            <>
              <p data-testid="mfa-state" className="text-sm text-secure">
                On. {mfa.recoveryCodesRemaining} recovery code(s) remaining.
              </p>
              {!showDisable ? (
                <div className="mt-4">
                  <Button variant="danger" onClick={() => setShowDisable(true)}>
                    Turn off two-step verification
                  </Button>
                </div>
              ) : (
                <DisableMfaForm
                  onCancel={() => setShowDisable(false)}
                  onDisabled={async () => {
                    invalidateCsrfToken();
                    setShowDisable(false);
                    setNotice('Two-step verification is off.');
                    await load();
                  }}
                  onFailure={setFailure}
                />
              )}
            </>
          ) : (
            <>
              <p data-testid="mfa-state" className="text-sm text-muted">
                Off.
              </p>
              <div className="mt-4">
                <Link
                  to="/mfa-setup"
                  className="inline-flex w-full items-center justify-center bg-signal px-4 py-2.5 text-sm font-medium text-white hover:bg-signal-hover"
                >
                  Set up two-step verification
                </Link>
              </div>
            </>
          )}
        </div>
      </section>

      {/* --- Devices --- */}
      <section aria-labelledby="sessions-heading" className="mb-10">
        <h2 id="sessions-heading" className="text-lg font-semibold text-ink">
          Where you are signed in
        </h2>
        <p className="mt-1.5 text-sm text-muted">Sign out any device you do not recognise.</p>

        <ul
          data-testid="device-list"
          className="mt-4 divide-y divide-edge border border-edge bg-panel"
        >
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="text-sm font-medium text-ink">
                  {session.userAgentSummary}
                  {session.current && (
                    <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.14em] text-signal">
                      this device
                    </span>
                  )}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-muted">
                  Last used {new Date(session.lastSeenAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void revokeOne(session.id)}
                className="shrink-0 border border-edge px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper"
              >
                Sign out
                <span className="sr-only"> {session.userAgentSummary}</span>
              </button>
            </li>
          ))}
        </ul>

        {sessions.length > 1 && (
          <div className="mt-4">
            <Button variant="secondary" onClick={() => void revokeOthers()}>
              Sign out all other devices
            </Button>
          </div>
        )}
      </section>

      <div className="border-t border-edge pt-6">
        <Button variant="secondary" data-testid="sign-out" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </main>
  );
}

interface DisableMfaFormProps {
  readonly onCancel: () => void;
  readonly onDisabled: () => Promise<void>;
  readonly onFailure: (failure: ApiFailure) => void;
}

/** Disabling requires the password AND a current code, not just a click. */
function DisableMfaForm({
  onCancel,
  onDisabled,
  onFailure,
}: DisableMfaFormProps): React.JSX.Element {
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    const result = await api.post('/mfa/disable', { password, totpCode });
    setBusy(false);
    if (result.ok) await onDisabled();
    else onFailure(result);
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="mt-5" noValidate>
      <p className="mb-4 text-sm text-muted">
        Confirm it is you. Enter your password and a current code.
      </p>
      <Field
        label="Password"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Field
        label="Code from your app"
        name="totpCode"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        mono
        maxLength={7}
        value={totpCode}
        onChange={(event) => setTotpCode(event.target.value)}
      />
      <div className="flex gap-3">
        <Button type="submit" variant="danger" busy={busy}>
          Turn off
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
