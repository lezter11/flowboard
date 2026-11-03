import type { CreateInvitationInput, Invitation } from '@flowboard/contracts';
import type { Role } from './roles.ts';
import { createRetainedCommand } from './retained-command.ts';
import { setUnsaved } from './unsaved.ts';

export type InvitationOperation = { action: 'create'; input: CreateInvitationInput } | { action: 'resend' | 'revoke'; id: string; email: string };
export const invitationDeliveryText = (delivery: Invitation['delivery']) => ({ pending: 'Email queued', retrying: 'Email delivery retrying', delivered: 'Email delivered', failed: 'Email delivery failed', unknown: 'Email delivery unknown' }[delivery?.status ?? 'unknown']);
export function invitationActions(role: Role, invitation: Invitation, archived = false, now = Date.now()) {
  const permitted = !archived && (role === 'owner' || (role === 'manager' && invitation.role !== 'manager'));
  const expired = invitation.status === 'expired' || new Date(invitation.expiresAt).getTime() <= now;
  const pending = invitation.status === 'pending' && !expired;
  return { resend: permitted && pending, retryDelivery: permitted && pending && invitation.delivery?.canRetry === true, revoke: permitted && pending, createNew: permitted && (expired || invitation.status === 'revoked') };
}

/** Drafts and unresolved operation identity live only in this tab, scoped to its original actor and project. Tokens are excluded. */
export function createInvitationSessions() {
  const sessions = new Map<string, ReturnType<typeof makeSession>>();
  function makeSession(key: string) {
    let draft: { email: string; role: 'manager'|'member'|'viewer'; operation: InvitationOperation|null } = {email:'',role:'member',operation:null};
    const listeners = new Set<() => void>();
    const command = createRetainedCommand<InvitationOperation>();
    return { command, get:()=>draft, subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
      update(patch: Partial<typeof draft>) {
        draft = {...draft,...structuredClone(patch)};
        setUnsaved(key, !!draft.email || draft.operation !== null);
        listeners.forEach((listener)=>listener());
      },
    };
  }
  return { forProject(actorId:string,projectId:string) { const key=`invitations:${JSON.stringify([actorId,projectId])}`; let session=sessions.get(key); if(!session){session=makeSession(key);sessions.set(key,session);} return session; } };
}
export const invitationSessions = createInvitationSessions();
