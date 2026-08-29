import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import type { AuthenticatedUser, Capability, WorkspaceSummary } from '@lcp/contracts';
import { api, workspaceApi } from '../lib/api.js';
import { WorkspaceContextProvider } from '../lib/workspace-context.js';
import { RoleChip } from './ui.jsx';

/**
 * The minimal shell for the workspace surface.
 *
 * This is NOT the dashboard: blueprint section 19 puts the real product chrome
 * in Stage 12. It is the smallest frame that can host a switcher and the pages
 * this stage adds, and it is deliberately shallow so Stage 12 can replace it
 * without unpicking anything.
 *
 * It is also the single place workspace state is loaded. Four pages need the
 * active workspace, the caller's capabilities, and the switcher list; fetching
 * that once here and sharing it through context avoids four copies of the same
 * request and four chances for them to disagree.
 */
export function WorkspaceShell(): React.JSX.Element {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [active, setActive] = useState<WorkspaceSummary | null>(null);
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([]);
  const [capabilities, setCapabilities] = useState<readonly Capability[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    const me = await api.get<{ user: AuthenticatedUser }>('/auth/me');
    if (!me.ok) {
      await navigate('/login', { replace: true });
      return;
    }
    setUser(me.data.user);

    const list = await workspaceApi.list();
    if (!list.ok) {
      await navigate('/login', { replace: true });
      return;
    }

    // No memberships at all: onboarding is the only thing to show.
    if (list.data.workspaces.length === 0) {
      await navigate('/onboarding', { replace: true });
      return;
    }
    setWorkspaces(list.data.workspaces);

    /**
     * Signing in starts a fresh session with no workspace selected, so a
     * returning member arrives here with memberships but nothing active.
     * Selecting the first is a convenience, not an authorization decision: the
     * id comes from the list the server just said this user belongs to, and
     * `/switch` re-verifies membership before it writes anything.
     */
    let current = await workspaceApi.current();
    if (!current.ok) {
      const first = list.data.workspaces[0];
      if (first === undefined) {
        await navigate('/onboarding', { replace: true });
        return;
      }
      const switched = await workspaceApi.switchTo(first.id);
      if (!switched.ok) {
        await navigate('/onboarding', { replace: true });
        return;
      }
      current = await workspaceApi.current();
      if (!current.ok) {
        await navigate('/onboarding', { replace: true });
        return;
      }
    }

    setActive(current.data.workspace);
    setCapabilities(current.data.capabilities);
    setLoading(false);
  }, [navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || user === null || active === null) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <p className="text-muted">Loading your workspace.</p>
      </main>
    );
  }

  return (
    <WorkspaceContextProvider value={{ user, active, workspaces, capabilities, refresh: load }}>
      <div className="min-h-dvh">
        <WorkspaceBar
          active={active}
          workspaces={workspaces}
          capabilities={capabilities}
          onSwitched={load}
        />
        <Outlet />
      </div>
    </WorkspaceContextProvider>
  );
}

interface WorkspaceBarProps {
  readonly active: WorkspaceSummary;
  readonly workspaces: readonly WorkspaceSummary[];
  readonly capabilities: readonly Capability[];
  readonly onSwitched: () => Promise<void>;
}

function WorkspaceBar({
  active,
  workspaces,
  capabilities,
  onSwitched,
}: WorkspaceBarProps): React.JSX.Element {
  return (
    <header className="border-b border-edge bg-panel">
      {/* Wider than the narrow pages so the chrome spans the builder too. */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
        <WorkspaceSwitcher active={active} workspaces={workspaces} onSwitched={onSwitched} />

        <nav aria-label="Workspace" className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <ShellLink to="/workspace" end>
            Overview
          </ShellLink>
          <ShellLink to="/workspace/widgets">Widgets</ShellLink>
          {/* Every role may view contacts, so this link is never conditional. */}
          <ShellLink to="/workspace/contacts">Inbox</ShellLink>
          {/*
           * `delivery.view` is `limited` for a Member rather than denied, so
           * the link is shown to everyone and the page itself omits the
           * management controls the server did not grant.
           */}
          {capabilities.includes('delivery.view') && (
            <ShellLink to="/workspace/delivery">Delivery</ShellLink>
          )}
          <ShellLink to="/workspace/members">Members</ShellLink>
          {/* Hidden entirely, not disabled: a Member has no audit log to read. */}
          {capabilities.includes('audit.view') && (
            <ShellLink to="/workspace/audit">Audit log</ShellLink>
          )}
          <ShellLink to="/workspace/settings">Settings</ShellLink>
        </nav>

        <div className="ml-auto">
          <ShellLink to="/account">Account</ShellLink>
        </div>
      </div>
    </header>
  );
}

interface ShellLinkProps {
  readonly to: string;
  readonly end?: boolean;
  readonly children: ReactNode;
}

function ShellLink({ to, end = false, children }: ShellLinkProps): React.JSX.Element {
  return (
    <NavLink
      to={to}
      end={end}
      // aria-current is what tells a screen reader which page this is; the
      // underline is the matching visual cue rather than the only one.
      className={({ isActive }) =>
        `text-sm ${
          isActive
            ? 'font-medium text-ink underline decoration-signal decoration-2 underline-offset-[6px]'
            : 'text-muted hover:text-ink'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

interface SwitcherProps {
  readonly active: WorkspaceSummary;
  readonly workspaces: readonly WorkspaceSummary[];
  readonly onSwitched: () => Promise<void>;
}

/**
 * The workspace switcher.
 *
 * A native `details` disclosure rather than a scripted menu widget. The summary
 * is focusable, Enter and Space toggle it, and the expanded state is announced
 * - all without a line of JavaScript. A custom menu button would have to
 * re-implement every one of those behaviours to arrive back where the native
 * element already is.
 */
function WorkspaceSwitcher({ active, workspaces, onSwitched }: SwitcherProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function choose(workspaceId: string): Promise<void> {
    if (workspaceId === active.id) {
      setOpen(false);
      return;
    }
    setBusy(true);
    const result = await workspaceApi.switchTo(workspaceId);
    setBusy(false);
    setOpen(false);
    if (result.ok) await onSwitched();
  }

  // One workspace: a disclosure that reveals a list of one is noise.
  if (workspaces.length <= 1) {
    return (
      <p className="flex items-center gap-2">
        <span data-testid="active-workspace" className="text-sm font-medium text-ink">
          {active.name}
        </span>
        <RoleChip role={active.role} />
      </p>
    );
  }

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="relative"
    >
      <summary
        data-testid="workspace-switcher"
        className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink"
      >
        <span data-testid="active-workspace">{active.name}</span>
        <RoleChip role={active.role} />
        <span className="sr-only">Change workspace</span>
      </summary>

      <ul className="absolute left-0 top-full z-10 mt-2 min-w-56 border border-edge bg-panel py-1">
        {workspaces.map((workspace) => {
          const isActive = workspace.id === active.id;
          return (
            <li key={workspace.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void choose(workspace.id)}
                // The active row carries a signal-coloured edge, echoing the
                // corner ticks that frame the auth panels.
                className={`flex w-full items-center justify-between gap-3 border-l-2 px-3 py-2 text-left text-sm hover:bg-paper disabled:opacity-55 ${
                  isActive ? 'border-signal text-ink' : 'border-transparent text-muted'
                }`}
                {...(isActive ? { 'aria-current': true as const } : {})}
              >
                <span>{workspace.name}</span>
                <RoleChip role={workspace.role} />
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
