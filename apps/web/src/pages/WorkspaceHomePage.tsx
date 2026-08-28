import { useEffect, useState } from 'react';
import type { WorkspaceUsage } from '@lcp/contracts';
import { workspaceApi } from '../lib/api.js';
import { useWorkspace } from '../lib/workspace-context.js';
import { Alert, Meter, RoleChip } from '../components/ui.jsx';

/**
 * Workspace overview: who you are here, and the usage meters from blueprint
 * 4.10.
 *
 * Only the user meter has a real number at this stage. The rest are reported as
 * not-yet-tracked rather than as zero, which is the same distinction the API
 * makes by sending null: "nothing has happened" and "this is not counted yet"
 * are different claims, and showing a confident 0 would quietly make the wrong
 * one.
 */
export function WorkspaceHomePage(): React.JSX.Element {
  const { active, user } = useWorkspace();
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);

  useEffect(() => {
    async function load(): Promise<void> {
      const result = await workspaceApi.usage();
      if (result.ok) setUsage(result.data);
    }
    void load();
  }, [active.id]);

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <header className="mb-10 border-b border-edge pb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">Workspace</p>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight text-ink">
          {active.name}
          <RoleChip role={active.role} />
        </h1>
        <p className="mt-2 font-mono text-xs text-muted">{active.timezone}</p>
      </header>

      {!user.emailVerified && (
        <Alert tone="info">
          Your email is not confirmed yet. You can look around, but inviting people and publishing
          stay blocked until you confirm it.
        </Alert>
      )}

      <section aria-labelledby="usage-heading">
        <h2 id="usage-heading" className="text-lg font-semibold text-ink">
          Usage
        </h2>
        <p className="mt-1.5 text-sm text-muted">
          This public demo caps every workspace at the limits below.
        </p>

        {usage === null ? (
          <p className="mt-4 text-sm text-muted">Loading usage.</p>
        ) : (
          <div
            data-testid="usage-meters"
            className="mt-4 divide-y divide-edge border-y border-edge"
          >
            <Meter
              label="People in this workspace"
              used={usage.users.used}
              limit={usage.users.limit}
              pending=""
            />
            <Meter
              label="Active widgets"
              used={usage.activeWidgets.used}
              limit={usage.activeWidgets.limit}
              pending="Counted once widgets exist"
            />
            <Meter
              label="Submissions this month"
              used={usage.submissionsThisMonth.used}
              limit={usage.submissionsThisMonth.limit}
              pending="Counted once submissions exist"
            />
            <Meter
              label="Interaction events this month"
              used={usage.interactionEventsThisMonth.used}
              limit={usage.interactionEventsThisMonth.limit}
              pending="Counted once analytics exist"
            />
          </div>
        )}
      </section>
    </main>
  );
}
