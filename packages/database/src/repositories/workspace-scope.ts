import { ObjectId } from 'mongodb';

/**
 * The tenancy invariant, expressed as a type (blueprint section 9.1).
 *
 * Every workspace-scoped repository method takes a WorkspaceScope as its FIRST
 * required parameter. There is no overload, default, or ambient context that
 * lets a caller omit it, so a query that forgets its tenant does not compile.
 *
 * The scope must be derived from authenticated session context by the
 * application layer. The repository layer cannot verify where it came from,
 * which is exactly why it refuses to run without one.
 */
export interface WorkspaceScope {
  readonly workspaceId: ObjectId;
}

export class InvalidWorkspaceScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWorkspaceScopeError';
  }
}

/**
 * Runtime guard behind the compile-time one.
 *
 * TypeScript cannot protect a JavaScript caller, a deserialized value, or an
 * `any` that slipped through a boundary, so the scope is validated on every
 * use rather than trusted.
 */
export function assertWorkspaceScope(scope: WorkspaceScope): ObjectId {
  if (scope === null || typeof scope !== 'object') {
    throw new InvalidWorkspaceScopeError('A workspace scope is required');
  }
  const { workspaceId } = scope;
  if (!(workspaceId instanceof ObjectId)) {
    throw new InvalidWorkspaceScopeError(
      'workspaceId must be an ObjectId supplied from authenticated session context',
    );
  }
  return workspaceId;
}

export function workspaceScope(workspaceId: ObjectId): WorkspaceScope {
  return { workspaceId };
}
