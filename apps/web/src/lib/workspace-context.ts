import { createContext, useContext } from 'react';
import type { AuthenticatedUser, Capability, WorkspaceSummary } from '@lcp/contracts';

/**
 * The active workspace, as the server describes it.
 *
 * `capabilities` is the list the API derived from the section 11 matrix for
 * this caller. The UI asks "may I?" by looking in that list and never by
 * reasoning about the role itself, so there is exactly one copy of the policy
 * and it lives on the server. `role` is here for display - the chip next to a
 * workspace name - not for deciding what to render.
 */
export interface WorkspaceContextValue {
  readonly user: AuthenticatedUser;
  readonly active: WorkspaceSummary;
  readonly workspaces: readonly WorkspaceSummary[];
  readonly capabilities: readonly Capability[];
  /** Re-read workspace, member, and capability state after a change. */
  readonly refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const WorkspaceContextProvider = WorkspaceContext.Provider;

/** Read the active workspace. Throws if used outside the workspace shell. */
export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (value === null) {
    throw new Error('useWorkspace must be used inside the workspace shell');
  }
  return value;
}
