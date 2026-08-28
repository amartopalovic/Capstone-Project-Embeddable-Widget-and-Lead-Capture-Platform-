import { useEffect, useState } from 'react';
import type { AuditEntrySummary, MemberSummary } from '@lcp/contracts';
import { workspaceApi } from '../lib/api.js';
import { useWorkspace } from '../lib/workspace-context.js';
import { Alert } from '../components/ui.jsx';

/**
 * The workspace audit log (blueprint 4.1, 11: `audit.view` is Owner and Admin).
 *
 * The nav link is hidden for a Member, and reaching the URL directly still
 * fails, because the API applies `requireCapability('audit.view')`. The hidden
 * link is a courtesy; the server is the enforcement.
 */
export function AuditLogPage(): React.JSX.Element {
  const { active } = useWorkspace();
  const [events, setEvents] = useState<readonly AuditEntrySummary[]>([]);
  const [members, setMembers] = useState<readonly MemberSummary[]>([]);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load(): Promise<void> {
      const [auditResult, memberResult] = await Promise.all([
        workspaceApi.audit(),
        workspaceApi.members(),
      ]);

      if (!auditResult.ok) {
        setDenied(true);
        setLoading(false);
        return;
      }
      setEvents(auditResult.data.events);
      if (memberResult.ok) setMembers(memberResult.data.members);
      setLoading(false);
    }
    void load();
  }, [active.id]);

  // Resolve an actor id to an address, so a row reads as a sentence about a
  // person rather than a row of identifiers.
  const nameFor = (userId: string | null): string => {
    if (userId === null) return 'The system';
    return members.find((member) => member.userId === userId)?.email ?? 'Someone';
  };

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <header className="mb-8 border-b border-edge pb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">History</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Audit log</h1>
        <p className="mt-2 text-sm text-muted">
          The 50 most recent changes in {active.name}. Times use your browser&rsquo;s zone.
        </p>
      </header>

      {denied && <Alert tone="error">Your role does not allow reading the audit log.</Alert>}

      {loading ? (
        <p className="text-sm text-muted">Loading the audit log.</p>
      ) : !denied && events.length === 0 ? (
        <p className="text-sm text-muted">Nothing has happened in this workspace yet.</p>
      ) : (
        !denied && (
          <ol data-testid="audit-list" className="divide-y divide-edge border border-edge bg-panel">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
                <p className="text-sm text-ink">
                  {describe(event, nameFor(event.actorUserId), members)}
                </p>
                <time
                  dateTime={event.occurredAt}
                  className="ml-auto shrink-0 font-mono text-[11px] text-muted"
                >
                  {new Date(event.occurredAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
        )
      )}
    </main>
  );
}

/**
 * Render one event as a sentence.
 *
 * Unknown types fall back to the raw type rather than being dropped. A log that
 * silently hides events it was not taught about would be worse than one that
 * shows an ugly line: the omission would be invisible.
 */
function describe(
  event: AuditEntrySummary,
  actor: string,
  members: readonly MemberSummary[],
): string {
  const target = (): string => {
    const id = event.metadata['targetUserId'] ?? event.metadata['toUserId'];
    if (typeof id !== 'string') return 'someone';
    return members.find((member) => member.userId === id)?.email ?? 'someone';
  };
  const text = (key: string): string => {
    const value = event.metadata[key];
    return typeof value === 'string' ? value : '';
  };

  switch (event.type) {
    case 'workspace.created':
      return `${actor} created the workspace ${text('name')}.`;
    case 'workspace.deleted':
      return `${actor} deleted this workspace.`;
    case 'workspace.recovered':
      return `${actor} restored this workspace.`;
    case 'workspace.ownership_transferred':
      return `${actor} transferred ownership to ${target()}.`;
    case 'membership.role_changed':
      return `${actor} changed ${target()} from ${text('fromRole')} to ${text('toRole')}.`;
    case 'membership.removed':
      return `${actor} removed ${target()} from the workspace.`;
    case 'invitation.sent':
      return `${actor} invited ${text('email')} as ${text('role')}.`;
    case 'invitation.revoked':
      return `${actor} cancelled the invitation to ${text('email')}.`;
    case 'invitation.accepted':
      return `${actor} accepted an invitation and joined as ${text('role')}.`;
    default:
      return `${actor}: ${event.type}`;
  }
}
