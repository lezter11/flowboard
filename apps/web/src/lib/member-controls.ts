import type { Role } from './roles.ts';

export function memberControls(actorRole: Role, actorId: string, targetRole: Role, targetId: string, projectArchived: boolean) {
  const edit = !projectArchived && actorId !== targetId && targetRole !== 'owner' && (actorRole === 'owner' || (actorRole === 'manager' && targetRole !== 'manager'));
  const roles: Array<'manager' | 'member' | 'viewer'> = actorRole === 'owner' ? ['manager', 'member', 'viewer'] : actorRole === 'manager' ? ['member', 'viewer'] : [];
  return { edit, remove: edit, roles, reason: projectArchived ? 'Archived projects are read-only.' : actorId === targetId ? 'You cannot change your own project role here.' : targetRole === 'owner' ? 'Owner access is protected.' : targetRole === 'manager' && actorRole !== 'owner' ? 'Only the Owner can change a Manager.' : '' };
}
export const canEditBoardDetails = (role: Role, boardArchived: boolean, projectArchived: boolean) => role === 'owner' && !boardArchived && !projectArchived;
export const canViewPeopleDirectory = (role: string | null | undefined) => role === 'owner' || role === 'manager';
export function directoryRows<T>(role: string | null | undefined, cachedRows: readonly T[] | undefined, readFailed: boolean): readonly T[] {
  return canViewPeopleDirectory(role) && !readFailed ? cachedRows ?? [] : [];
}
