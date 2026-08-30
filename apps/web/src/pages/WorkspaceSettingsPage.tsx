import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { MemberSummary } from '@lcp/contracts';
import { workspaceApi, type ApiFailure } from '../lib/api.js';
import { useWorkspace } from '../lib/workspace-context.js';
import { Alert, Button, RoleChip } from '../components/ui.jsx';
import {
  OPT_IN_MODE_HINTS,
  OPT_IN_MODE_LABELS,
  OPT_IN_MODE_VALUES,
  RETENTION_CHOICES,
  type OptInModeValue,
  type WorkspacePrivacySettings,
} from '@lcp/contracts';
import { privacyApi } from '../lib/api.js';

/**
 * Workspace settings, ownership transfer, and the danger zone.
 *
 * Name and timezone are shown but not editable: Stage 4a exposes no endpoint
 * that changes them, and a form posting to something that does not exist would
 * be a worse lie than a read-only row. Editing arrives with the settings work
 * in a later stage.
 */
export function WorkspaceSettingsPage(): React.JSX.Element {
  const { active, capabilities, refresh } = useWorkspace();
  const canTransfer = capabilities.includes('workspace.transfer');
  const canDelete = capabilities.includes('workspace.delete');

  const [members, setMembers] = useState<readonly MemberSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const result = await workspaceApi.members();
    if (result.ok) setMembers(result.data.members);
  }, []);

  useEffect(() => {
    void load();
  }, [load, active.id]);

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <header className="mb-8 border-b border-edge pb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">Settings</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">{active.name}</h1>
      </header>

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {failure !== null && <Alert tone="error">{failure.message}</Alert>}

      <section aria-labelledby="details-heading" className="mb-10">
        <h2 id="details-heading" className="text-lg font-semibold text-ink">
          Details
        </h2>
        <dl className="mt-4 divide-y divide-edge border border-edge bg-panel">
          <div className="flex items-baseline justify-between gap-4 p-4">
            <dt className="text-sm text-muted">Name</dt>
            <dd className="text-sm font-medium text-ink">{active.name}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 p-4">
            <dt className="text-sm text-muted">Time zone</dt>
            <dd className="font-mono text-sm text-ink">{active.timezone}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 p-4">
            <dt className="text-sm text-muted">Your role</dt>
            <dd>
              <RoleChip role={active.role} />
            </dd>
          </div>
        </dl>
      </section>

      <ConsentAndRetentionSection
        canEdit={canDelete}
        onSaved={() => {
          setFailure(null);
          setNotice('Consent and retention settings saved.');
        }}
        onFailure={(value) => {
          setNotice(null);
          setFailure(value);
        }}
      />

      {canTransfer && (
        <TransferSection
          members={members}
          onTransferred={async () => {
            setFailure(null);
            setNotice('Ownership transferred. You are now an Admin in this workspace.');
            await load();
            await refresh();
          }}
          onFailure={(value) => {
            setNotice(null);
            setFailure(value);
          }}
        />
      )}

      {canDelete && (
        <DangerZone
          workspaceName={active.name}
          onFailure={(value) => {
            setNotice(null);
            setFailure(value);
          }}
        />
      )}
    </main>
  );
}

interface TransferSectionProps {
  readonly members: readonly MemberSummary[];
  readonly onTransferred: () => Promise<void>;
  readonly onFailure: (failure: ApiFailure) => void;
}

/**
 * Ownership transfer (blueprint 4.1: "Owner may transfer to a verified Admin").
 *
 * Only verified Admins are offered. The server checks both facts again and
 * refuses otherwise; offering an ineligible person here would just produce a
 * confusing failure after the fact.
 */
function TransferSection({
  members,
  onTransferred,
  onFailure,
}: TransferSectionProps): React.JSX.Element {
  const eligible = members.filter(
    (member) => member.role === 'admin' && member.emailVerified && !member.isSelf,
  );

  const [target, setTarget] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const chosen = eligible.find((member) => member.userId === target);

  async function transfer(): Promise<void> {
    if (chosen === undefined) return;
    setBusy(true);
    const result = await workspaceApi.transferOwnership(chosen.userId);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      onFailure(result);
      return;
    }
    setTarget('');
    await onTransferred();
  }

  return (
    <section aria-labelledby="transfer-heading" className="mb-10">
      <h2 id="transfer-heading" className="text-lg font-semibold text-ink">
        Transfer ownership
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        A workspace has exactly one Owner. You can hand that over to an Admin who has confirmed
        their email address.
      </p>

      {eligible.length === 0 ? (
        <p data-testid="no-transfer-targets" className="mt-4 text-sm text-muted">
          There is no eligible Admin yet. Promote someone to Admin first, and make sure they have
          confirmed their email address.
        </p>
      ) : (
        <div className="mt-4 border border-edge bg-panel p-5">
          <label
            htmlFor="transfer-target"
            className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted"
          >
            New Owner
          </label>
          <select
            id="transfer-target"
            value={target}
            onChange={(event) => {
              setTarget(event.target.value);
              setConfirming(false);
            }}
            className="w-full border border-edge bg-panel px-3 py-2.5 text-ink"
          >
            <option value="">Choose an Admin</option>
            {eligible.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.email}
              </option>
            ))}
          </select>

          {!confirming ? (
            <div className="mt-4">
              <Button
                type="button"
                variant="secondary"
                disabled={chosen === undefined}
                onClick={() => setConfirming(true)}
              >
                Transfer ownership
              </Button>
            </div>
          ) : (
            <div className="mt-4">
              {/*
               * Say plainly what happens to the person doing this. Stage 4a
               * makes the outgoing Owner an Admin, and someone about to give
               * away a workspace should not have to discover that afterwards.
               */}
              <Alert tone="info">
                {chosen?.email} becomes the Owner. You stay in this workspace as an Admin, and you
                will not be able to take ownership back yourself.
              </Alert>
              <div className="flex flex-wrap gap-3">
                <Button type="button" busy={busy} onClick={() => void transfer()}>
                  Yes, make {chosen?.email} the Owner
                </Button>
                <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

interface DangerZoneProps {
  readonly workspaceName: string;
  readonly onFailure: (failure: ApiFailure) => void;
}

/**
 * Workspace deletion (blueprint 4.1: soft delete, recoverable for 30 days).
 *
 * An inline confirmation rather than a modal dialog, matching how turning off
 * two-step verification already works. The reveal keeps the warning and the
 * button in one place in the reading order, which a dialog would have to
 * re-create with focus management.
 */
function DangerZone({ workspaceName, onFailure }: DangerZoneProps): React.JSX.Element {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove(): Promise<void> {
    setBusy(true);
    const result = await workspaceApi.softDelete();
    setBusy(false);
    if (!result.ok) {
      setConfirming(false);
      onFailure(result);
      return;
    }
    // The workspace is gone from under this session, so there is nothing left
    // to render here. Onboarding is where recovery is offered.
    await navigate('/onboarding', { replace: true });
  }

  return (
    <section aria-labelledby="danger-heading">
      <h2 id="danger-heading" className="text-lg font-semibold text-danger">
        Danger zone
      </h2>

      <div className="mt-4 border border-danger bg-panel p-5">
        <p className="text-sm text-ink">Delete {workspaceName}</p>
        <p className="mt-1.5 text-sm text-muted">
          Everyone loses access straight away. You can restore it for 30 days, after which it is
          permanently purged.
        </p>

        {!confirming ? (
          <div className="mt-4">
            <Button
              type="button"
              variant="danger"
              data-testid="delete-workspace"
              onClick={() => setConfirming(true)}
            >
              Delete this workspace
            </Button>
          </div>
        ) : (
          <div className="mt-4">
            <Alert tone="error">
              This removes {workspaceName} for everyone in it. You have 30 days to restore it from
              the setup screen.
            </Alert>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="danger"
                busy={busy}
                data-testid="confirm-delete-workspace"
                onClick={() => void remove()}
              >
                Yes, delete it
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Consent and retention (blueprint 4.8, 9.5)
// ---------------------------------------------------------------------------

/**
 * The two settings that decide what happens to leads over time.
 *
 * Gated on `workspace.delete`, which the server sends in the capability list.
 * That is Owner-only, and it needs saying out loud because the capability's
 * name does not obviously cover a settings form: section 11 has no retention
 * row, and choosing a shorter retention schedules the destruction of every lead
 * older than it - the same class of decision as deleting the workspace, which
 * section 11 gives to the Owner alone.
 *
 * A non-Owner still SEES the setting. What a company does with your data is not
 * a secret from the people handling it, and hiding the panel would leave a
 * Member unable to answer a question they will certainly be asked.
 */
function ConsentAndRetentionSection({
  canEdit,
  onSaved,
  onFailure,
}: {
  readonly canEdit: boolean;
  readonly onSaved: () => void;
  readonly onFailure: (failure: ApiFailure) => void;
}): React.JSX.Element {
  const [saved, setSaved] = useState<WorkspacePrivacySettings | null>(null);
  const [retentionDays, setRetentionDays] = useState(365);
  const [optInMode, setOptInMode] = useState<OptInModeValue>('double');
  const [saving, setSaving] = useState(false);

  /**
   * The form is seeded from the server exactly once.
   *
   * Without this guard a second load - React runs effects twice in development,
   * and any slow response can arrive late - overwrites whatever the person has
   * since selected with the saved value, silently discarding their change and
   * leaving Save disabled as though they had never touched anything. The
   * `saved` baseline the warning compares against is set once for the same
   * reason.
   */
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;

    void (async () => {
      const result = await privacyApi.settings();
      if (result.ok) {
        setSaved(result.data);
        setRetentionDays(result.data.retentionDays);
        setOptInMode(result.data.optInMode);
      } else {
        // Let it be tried again rather than leaving the panel stuck loading.
        seeded.current = false;
      }
    })();
  }, []);

  /**
   * The consequence, before the decision rather than after it.
   *
   * Shortening retention is the only setting in this product that destroys data
   * already collected, and it happens quietly on a nightly sweep. Telling
   * somebody afterwards would be telling them too late, so the warning appears
   * the moment the selection changes and names exactly what will go.
   */
  const shortening =
    saved !== null &&
    retentionDays !== saved.retentionDays &&
    retentionDays > 0 &&
    (saved.retentionDays === 0 || retentionDays < saved.retentionDays);

  const dirty =
    saved !== null && (retentionDays !== saved.retentionDays || optInMode !== saved.optInMode);

  async function save(): Promise<void> {
    setSaving(true);
    const result = await privacyApi.saveSettings({
      retentionDays: retentionDays as 0 | 30 | 90 | 365,
      optInMode,
    });
    setSaving(false);
    if (result.ok) {
      setSaved(result.data);
      onSaved();
    } else {
      onFailure(result);
    }
  }

  return (
    <section aria-labelledby="privacy-heading" className="mb-10">
      <h2 id="privacy-heading" className="text-lg font-semibold text-ink">
        Consent and retention
      </h2>
      <p className="mt-1 text-sm text-muted">
        How you ask for permission to email leads, and how long you keep them.
      </p>

      {/*
       * Nothing is offered until the saved values are known.
       *
       * Not a loading nicety. The warning below compares the CHOICE against the
       * SAVED value, so a panel that accepted a click before it had loaded
       * would let somebody shorten retention without ever seeing what that
       * destroys - the one consequence this panel exists to show.
       */}
      {saved === null ? (
        <p className="mt-4 text-sm text-muted">Loading your settings.</p>
      ) : (
        <div className="mt-4 space-y-6 border border-edge bg-panel p-5">
          <fieldset className="border-0 p-0" disabled={!canEdit}>
            <legend className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              Keep leads for
            </legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {RETENTION_CHOICES.map((choice) => (
                <label
                  key={choice.days}
                  className={`flex items-center gap-3 border px-4 py-3 text-sm ${
                    canEdit ? 'cursor-pointer' : 'cursor-default'
                  } ${
                    retentionDays === choice.days
                      ? 'border-signal bg-paper text-ink'
                      : 'border-edge text-ink hover:bg-paper'
                  }`}
                >
                  <input
                    type="radio"
                    name="retention"
                    value={choice.days}
                    checked={retentionDays === choice.days}
                    onChange={() => setRetentionDays(choice.days)}
                    className="accent-signal"
                  />
                  {choice.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              Counted from the last time a lead submitted something or someone on your team worked
              on them - not from when they first arrived.
            </p>
          </fieldset>

          {shortening && (
            <Alert tone="error">
              Leads with no activity for longer than the new period are permanently anonymised on
              the next daily sweep. Their name, email, and everything they submitted are erased.
              This cannot be undone.
            </Alert>
          )}

          <fieldset className="border-0 p-0" disabled={!canEdit}>
            <legend className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              Marketing opt-in
            </legend>
            <div className="mt-3 space-y-2">
              {OPT_IN_MODE_VALUES.map((mode) => (
                <label
                  key={mode}
                  className={`flex items-start gap-3 border p-4 ${canEdit ? 'cursor-pointer' : 'cursor-default'} ${
                    optInMode === mode ? 'border-signal bg-paper' : 'border-edge hover:bg-paper'
                  }`}
                >
                  <input
                    type="radio"
                    name="optInMode"
                    value={mode}
                    checked={optInMode === mode}
                    onChange={() => setOptInMode(mode)}
                    className="mt-1 accent-signal"
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink">
                      {OPT_IN_MODE_LABELS[mode]}
                    </span>
                    <span className="mt-1 block text-sm text-muted">{OPT_IN_MODE_HINTS[mode]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {canEdit ? (
            <Button type="button" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? 'Saving' : 'Save changes'}
            </Button>
          ) : (
            <p className="text-sm text-muted">Only the Owner can change these settings.</p>
          )}
        </div>
      )}
    </section>
  );
}
