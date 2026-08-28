import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import QRCode from 'qrcode';
import type { MfaEnrollment, MfaRecoveryCodes } from '@lcp/contracts';
import { api, invalidateCsrfToken, type ApiFailure } from '../lib/api.js';
import { Alert, AuthPanel, Button, CodeList, Field } from '../components/ui.jsx';

/**
 * Turning on two-step verification.
 *
 * This is the one place in the auth surface where numbered steps are used,
 * because the flow genuinely IS an ordered sequence the user must complete in
 * order: scan the code, prove the app has it, then save the recovery codes.
 * Numbering anything else here would be decoration.
 */
type Step = 'scan' | 'confirm' | 'codes';

export function MfaSetupPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('scan');
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[]>([]);
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  /**
   * Guard against enrolling twice.
   *
   * StrictMode invokes mount effects twice in development, and a remount or a
   * double submit could do the same in production. Each enroll REPLACES the
   * pending secret, so two in flight can leave the displayed key belonging to
   * one response while the stored secret came from the other - and then the
   * code the user types never matches. This is the same guard the verification
   * page uses for its single-use token.
   */
  const enrollmentRequested = useRef(false);

  useEffect(() => {
    if (enrollmentRequested.current) return;
    enrollmentRequested.current = true;

    void (async () => {
      const result = await api.post<MfaEnrollment>('/mfa/enroll');
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setEnrollment(result.data);
      // Rendered client-side from the URI, so the secret never becomes an
      // image on the server or in a cache.
      setQrDataUrl(await QRCode.toDataURL(result.data.otpauthUri, { margin: 1, width: 200 }));
    })();
  }, []);

  async function onConfirm(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFailure(null);

    const result = await api.post<MfaRecoveryCodes>('/mfa/confirm', { totpCode });
    setBusy(false);

    if (!result.ok) {
      setFailure(result);
      return;
    }

    // The session identifier rotated, so the cached CSRF token is stale.
    invalidateCsrfToken();
    setRecoveryCodes(result.data.recoveryCodes);
    setStep('codes');
  }

  if (step === 'codes') {
    return (
      <AuthPanel
        eyebrow="step 3 of 3"
        title="Save your recovery codes"
        intro="Each code signs you in once if you lose your authenticator app. This is the only time they are shown."
        wide
      >
        <Alert tone="success">Two-step verification is on.</Alert>
        <CodeList codes={recoveryCodes} />
        <div className="mt-6">
          <Button onClick={() => void navigate('/account')}>I have saved these codes</Button>
        </div>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel
      eyebrow={step === 'scan' ? 'step 1 of 3' : 'step 2 of 3'}
      title="Turn on two-step verification"
      intro="Scan this code with an authenticator app, then enter the 6-digit code it shows."
      footer={<Link to="/account">Cancel and go back</Link>}
    >
      {failure !== null && <Alert tone="error">{failure.message}</Alert>}

      {enrollment === null ? (
        <Alert tone="info">Preparing your setup code.</Alert>
      ) : (
        <>
          <div className="mb-6 flex flex-col items-center gap-4 border border-edge bg-paper p-5">
            {qrDataUrl !== null && (
              <img
                src={qrDataUrl}
                width={200}
                height={200}
                alt="QR code for enrolling this account in your authenticator app"
              />
            )}
            <div className="w-full text-center">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                Or enter this key manually
              </p>
              <p
                data-testid="manual-entry-key"
                className="mt-1.5 break-all font-mono text-sm tracking-wider text-ink"
              >
                {enrollment.manualEntryKey}
              </p>
            </div>
          </div>

          <form
            onSubmit={(event) => {
              setStep('confirm');
              void onConfirm(event);
            }}
            noValidate
          >
            <Field
              label="Code from your app"
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
            <Button type="submit" busy={busy}>
              Turn on two-step verification
            </Button>
          </form>
        </>
      )}
    </AuthPanel>
  );
}
