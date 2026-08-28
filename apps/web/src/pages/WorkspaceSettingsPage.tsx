import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { MemberSummary } from '@lcp/contracts';
import { workspaceApi, type ApiFailure } from '../lib/api.js';
import { useWorkspace } from '../lib/workspace-context.js';
import { Alert, Button, RoleChip } from '../components/ui.jsx';

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
