import { useEffect, useState, type SubmitEvent } from 'react';
import { useNavigate } from 'react-router';
import type { RecoverableWorkspaceSummary } from '@lcp/contracts';
import { api, fieldError, workspaceApi, type ApiFailure } from '../lib/api.js';
import { Alert, AuthPanel, Button, Field } from '../components/ui.jsx';

/**
 * First-run onboarding (blueprint 4.1: "Created during onboarding; user
 * supplies its name and confirms the detected timezone").
 *
 * The timezone is detected and pre-filled, but it stays an editable text field
 * rather than becoming a read-only fact: detection reports the browser's zone,
 * which is not always the zone the business runs on. Whether the zone is real
 * is decided by the server, which is the only party that knows what its ICU
 * build recognises - this page checks only that the box is not empty.
 */
export function OnboardingPage(): React.JSX.Element {
  const navigate = useNavigate();

  // Detected once at module-render time; the user can overwrite it.
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(() => detectTimezone());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [recoverable, setRecoverable] = useState<readonly RecoverableWorkspaceSummary[]>([]);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    async function load(): Promise<void> {
      const me = await api.get<unknown>('/auth/me');
      if (!me.ok) {
        await navigate('/login', { replace: true });
        return;
      }

      // Already in a workspace? Then this page is not the right place.
      const list = await workspaceApi.list();
      if (list.ok && list.data.workspaces.length > 0) {
        await navigate('/workspace', { replace: true });
        return;
      }

      const deleted = await workspaceApi.recoverable();
      if (deleted.ok) setRecoverable(deleted.data.workspaces);
      setChecked(true);
    }
    void load();
  }, [navigate]);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setBusy(true);
    const result = await workspaceApi.onboard(name, timezone);
    setBusy(false);

    if (!result.ok) {
      setFailure(result);
      return;
    }
    await navigate('/workspace', { replace: true });
  }

  async function recover(workspaceId: string): Promise<void> {
    setFailure(null);
    setBusy(true);
    const result = await workspaceApi.recover(workspaceId);
    setBusy(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    await navigate('/workspace', { replace: true });
  }

  if (!checked) {
    return (
      <main className="mx-auto max-w-md px-5 py-16">
        <p className="text-muted">Loading.</p>
      </main>
    );
  }

  return (
    <AuthPanel
      eyebrow="Set up"
      title="Name your workspace"
      intro="A workspace holds your widgets, contacts, and teammates."
      footer={
        recoverable.length > 0 ? undefined : (
          <>Joining someone else&rsquo;s workspace? Open the invitation link they sent you.</>
        )
      }
    >
      {failure !== null && <Alert tone="error">{failure.message}</Alert>}

      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <Field
          label="Workspace name"
          name="name"
          required
          autoFocus
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={failure === null ? undefined : fieldError(failure, 'name')}
        />
        <Field
          label="Time zone"
          name="timezone"
          required
          hint="Used for monthly usage totals and scheduled reports."
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          error={failure === null ? undefined : fieldError(failure, 'timezone')}
        />
        <Button type="submit" busy={busy}>
          Create workspace
        </Button>
      </form>

      {recoverable.length > 0 && (
        <section aria-labelledby="recover-heading" className="mt-8 border-t border-edge pt-6">
          <h2 id="recover-heading" className="text-sm font-semibold text-ink">
            Deleted workspaces
          </h2>
          <p className="mt-1 text-sm text-muted">
            You can restore these until the date shown. After that they are purged.
          </p>
          <ul
            data-testid="recoverable-list"
            className="mt-4 divide-y divide-edge border border-edge"
          >
            {recoverable.map((workspace) => (
              <li key={workspace.id} className="flex items-center justify-between gap-4 p-3">
                <div>
                  <p className="text-sm font-medium text-ink">{workspace.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted">
                    Recoverable until {new Date(workspace.purgeAfter).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void recover(workspace.id)}
                  className="shrink-0 border border-edge px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper disabled:opacity-55"
                >
                  Restore
                  <span className="sr-only"> {workspace.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AuthPanel>
  );
}

/**
 * The browser's own zone, or UTC if it will not say.
 *
 * `resolvedOptions().timeZone` is the standard detection route. UTC is the
 * fallback because it is always valid, including on the runtimes whose
 * `supportedValuesOf` list omits it.
 */
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
