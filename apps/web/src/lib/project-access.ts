/** What the session says about the user's access to one project, so open screens can react to a role change, archive or removal. */
export interface ProjectAccessInfo { id: string; role?: string | null; isArchived?: boolean }
export type ProjectAccess = { kind: 'removed' } | { kind: 'ok'; role: string; archived: boolean };

export function projectAccess(projects: readonly ProjectAccessInfo[], projectId: string | null | undefined): ProjectAccess {
  const p = projectId ? projects.find((x) => x.id === projectId) : undefined;
  return p ? { kind: 'ok', role: p.role ?? 'viewer', archived: !!p.isArchived } : { kind: 'removed' };
}
