import { useState, type SubmitEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { LoginResult } from '@lcp/contracts';
import { api, invalidateCsrfToken, type ApiFailure } from '../lib/api.js';
import { Alert, AuthPanel, Button, Field } from '../components/ui.jsx';
import { safeNext } from '../lib/navigation.js';

/**
 * The second step of signing in when MFA is on.
 *
 * The page holds nothing that grants access: the partially authenticated state
 * lives in a short-lived server-side record keyed by an opaque cookie, so
 * navigating here directly without a pending challenge simply fails.
 */
export function MfaChallengePage(): React.JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFailure(null);

    const body = useRecoveryCode ? { recoveryCode } : { totpCode };
    const result = await api.post<LoginResult>('/auth/mfa-challenge', body);
    setBusy(false);

    if (!result.ok) {
      setFailure(result);
      // The challenge is gone; sending the user back is the only way forward.
      if (result.code === 'mfa_required') await navigate('/login');
      return;
    }

    invalidateCsrfToken();
    await navigate(next);
  }

  return (
    <AuthPanel
      eyebrow="step 2 of 2"
      title="Enter your verification code"
      intro={
        useRecoveryCode
          ? 'Enter one of the recovery codes you saved when you turned on two-step verification.'
          : 'Open your authenticator app and enter the current 6-digit code.'
      }
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        {failure !== null && <Alert tone="error">{failure.message}</Alert>}

        {useRecoveryCode ? (
          <Field
            label="Recovery code"
            name="recoveryCode"
            autoComplete="one-time-code"
            required
            mono
            placeholder="xxxx-xxxx-xxxx"
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.target.value)}
            hint="Each recovery code works once."
          />
        ) : (
          <Field
            label="Authentication code"
            name="totpCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            mono
            maxLength={7}
            placeholder="000000"
            value={totpCode}
            onChange={(event) => setTotpCode(event.target.value)}
          />
        )}

        <Button type="submit" busy={busy}>
          Verify and sign in
        </Button>

        <p className="mt-5 text-center text-sm">
          <button
            type="button"
            className="text-muted underline"
            onClick={() => {
              setUseRecoveryCode(!useRecoveryCode);
              setFailure(null);
            }}
          >
            {useRecoveryCode ? 'Use your authenticator app instead' : 'Use a recovery code instead'}
          </button>
        </p>
      </form>
    </AuthPanel>
  );
}
