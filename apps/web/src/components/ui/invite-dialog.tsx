'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Invitation, InvitationStatus } from '@flowboard/contracts';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useCursorFeed } from '@/lib/cursor-feed';
import { usePollKeys } from '@/components/polling';
import { ErrorNote } from '@/components/ui/error-note';
import { QuotaPanel } from '@/components/ui/quota-panel';
import { quotaAdvice } from '@/lib/quota-messages';
import { checkInvitationEmail, emailFieldAria } from '@/lib/invite-email';
import { invitationActions, invitationDeliveryText, invitationSessions, type InvitationOperation } from '@/lib/invitation-state';
import type { Role } from '@/lib/roles';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toasts';

type InviteRole = 'manager' | 'member' | 'viewer';
const ROLE_LABEL: Record<InviteRole, string> = { manager: 'Manager', member: 'Member', viewer: 'Viewer' };
const ROLE_HELP: Record<InviteRole, string> = { manager: 'Configures boards, invites people, trashes and restores cards, imports.', member: 'Creates, edits and moves cards, comments and uploads images.', viewer: 'Reads the boards they are given access to. Cannot change anything.' };
const linkFor = (token: string) => `${window.location.origin}/invitation?token=${encodeURIComponent(token)}`;
const expiresIn = (iso: string) => { const hours = Math.ceil((new Date(iso).getTime() - Date.now()) / 3_600_000); return hours <= 0 ? 'expired' : hours < 24 ? `expires in ${hours}h` : `expires in ${Math.ceil(hours / 24)} days`; };

/** Delivery is learned from the safe list summary. A successful create/rotation only means the request was accepted. */
export function InviteDialog({ projectId, projectName, actorRole, open, onClose, archived = false }: { projectId: string; projectName: string; actorRole: Role; open: boolean; onClose: () => void; archived?: boolean }) {
  const { state } = useSession();
  const actorId = state.status === 'ready' ? state.session.actor.id : '';
  const authorized = !!actorId && (actorRole === 'owner' || actorRole === 'manager');
  const session = useMemo(() => invitationSessions.forProject(actorId, projectId), [actorId, projectId]);
  const draft = useSyncExternalStore(session.subscribe, session.get, session.get);
  const queryClient = useQueryClient(); const toast = useToast();

  const [emailError, setEmailError] = useState(''); const [copyError, setCopyError] = useState('');
  const [fresh, setFresh] = useState<Invitation | null>(null); const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<InvitationStatus | 'all'>('pending');
  const [confirmRevoke, setConfirmRevoke] = useState<Invitation | null>(null);
  const roles: InviteRole[] = actorRole === 'owner' ? ['manager', 'member', 'viewer'] : ['member', 'viewer'];
  const queryKey = useMemo(() => ['invitations', projectId, actorId, status] as const, [projectId, actorId, status]);
  const list = useCursorFeed<Invitation>(queryKey, (cursor, signal) => api.listInvitations(projectId, {cursor, signal, status: status === 'all' ? undefined : status}), open && authorized);
  usePollKeys([queryKey], open && authorized);
  const unavailable = !authorized || (list.error instanceof ApiError && [401,403,404].includes(list.error.status));
  const invitations = unavailable ? [] : list.items;
  const live = useRef({actorId,projectId,open,authorized,unavailable});live.current={actorId,projectId,open,authorized,unavailable};
  const stale = !!list.error && 'code' in list.error && list.error.code === 'STALE_CURSOR';
  useEffect(() => { if (!open || unavailable) { setFresh(null); setCopied(false); setConfirmRevoke(null); } }, [open, authorized, projectId, actorId, unavailable]);
  useEffect(() => { if (!authorized) queryClient.removeQueries({queryKey:['invitations',projectId,actorId]}); }, [authorized, projectId, actorId, queryClient]);
  const operation = useMutation({
    mutationFn: (intent: InvitationOperation) => {
      session.update({ operation: session.get().operation ?? intent });
      return session.command.run(intent, async (original, key): Promise<{invitation?:Invitation; revoked?:string}> => {
        if (original.action === 'create') return {invitation:(await api.createInvitation(projectId, original.input, key)).data};
        if (original.action === 'resend') return {invitation:(await api.resendInvitation(projectId, original.id, key)).data};
        await api.revokeInvitation(projectId, original.id, key); return {revoked:original.id};
      });
    },
    onSuccess: (result, intent) => {
      session.update({operation:null,...(intent.action === 'create' ? {email:''} : {})});
      setEmailError(''); setCopyError(''); setCopied(false); setConfirmRevoke(null);
      if (result.revoked) {setFresh((old)=>old?.id === result.revoked ? null : old);toast('Invitation revoked',{icon:'check'});}
      else {if(live.current.actorId===actorId && live.current.projectId===projectId && live.current.open && live.current.authorized && !live.current.unavailable) setFresh(result.invitation?.token ? result.invitation : null);toast(intent.action === 'resend' ? 'New invitation link created. The earlier link no longer works.' : 'Invitation created. Check delivery status below.',{icon:'check'});}
      void queryClient.invalidateQueries({queryKey:['invitations',projectId]});
    },
    onError: () => { if (!session.command.unresolved()) session.update({operation:null}); void queryClient.invalidateQueries({queryKey:['invitations',projectId]}); },
  });
  const locked = operation.isPending || session.command.unresolved();
  const writable = authorized && !archived && !unavailable;
  const context = {role:actorRole,projectId};
  const advice = operation.error instanceof ApiError ? quotaAdvice(operation.error,context) : null;
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (!writable || operation.isPending) return;
    if (session.command.unresolved() && draft.operation) {operation.mutate(draft.operation);return;}
    const email = checkInvitationEmail(draft.email);
    if (!email.ok) {setEmailError(email.message);document.getElementById('inviteEmail')?.focus();return;}
    if (!roles.includes(draft.role)) {setEmailError('Choose a role you can invite.');return;}
    setEmailError(''); operation.mutate({action:'create',input:{email:email.value,role:draft.role}});
  };
  const copy = async (token:string) => {try {await navigator.clipboard.writeText(linkFor(token));setCopied(true);} catch {setCopyError('Could not copy. Select the link and copy it yourself.');}};
  return <DialogLayer open={open} onClose={onClose} labelledBy="inviteTitle" className="wide invite-dialog">
    <div className="dialog-head"><div className="dialog-head-copy"><h2 id="inviteTitle">Invite people</h2><p>to {projectName}</p></div><button className="dialog-close" type="button" onClick={onClose} aria-label="Close invite dialog"><Icon name="x" /></button></div>
    <div className="dialog-body invite-dialog-body">
      {!authorized ? <p role="status">Only the project Owner and Managers can view invitations. Your unsent draft is kept in this tab.</p> : <>
        {archived && <p role="status">This project is archived. Invitation history is read only.</p>}
        <form onSubmit={submit} noValidate className="invite-form">
          <div className="dialog-field"><label htmlFor="inviteEmail">Email address</label><input className="control" id="inviteEmail" type="email" autoComplete="off" inputMode="email" data-autofocus placeholder="name@company.com" value={draft.email} readOnly={locked || !writable} {...emailFieldAria(emailError,'inviteEmailError')} onChange={(e)=>{setEmailError('');session.update({email:e.target.value});}} />{emailError && <p id="inviteEmailError" className="field-error" role="alert">{emailError}</p>}</div>
          <div className="dialog-field"><label htmlFor="inviteRole">Project role</label><select className="control" id="inviteRole" value={draft.role} disabled={locked || !writable} onChange={(e)=>session.update({role:e.target.value as InviteRole})} aria-describedby="inviteRoleHelp">{!roles.includes(draft.role) && <option value={draft.role} disabled>{ROLE_LABEL[draft.role]} (Owner only)</option>}{roles.map((r)=><option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select><p id="inviteRoleHelp" className="field-help">{ROLE_HELP[draft.role]}</p></div>
          <button className="btn primary" type="submit" disabled={locked || !writable}><Icon name="send" />Create invitation</button>
          {!locked && !!draft.email && <button className="btn" type="button" onClick={()=>session.update({email:''})}>Discard unsent invitation</button>}
        </form>
        {draft.operation && <p className="hint" role="status">{operation.isPending ? 'Waiting for the invitation request…' : 'The earlier request may have succeeded. Retry that original request before starting another.'} {!operation.isPending && <button className="btn sm" type="button" disabled={!authorized || archived} onClick={()=>operation.mutate(draft.operation!)}>Retry original invitation request</button>}</p>}
        <p className="invite-access-note"><Icon name="lock" /><span><strong>Project access is not board access.</strong> {actorRole === 'owner' ? <>After they accept, give them boards under <Link href={`/people?project=${encodeURIComponent(projectId)}`}>People › Board access</Link>.</> : 'After they accept, the project Owner chooses which boards they can open.'} Until then they see no boards.</span></p>
        {advice ? <QuotaPanel advice={advice} role="alert" onNavigate={onClose} /> : operation.error && <ErrorNote error={operation.error} ctx={{...context,doing:'changing invitations'}} />}
        {copyError && <ErrorNote text={copyError} />}
        {!unavailable && fresh?.token && <div className="invite-fresh" role="status"><p><strong>Invitation link created for {fresh.email}</strong> as {ROLE_LABEL[fresh.role as InviteRole]}. Email delivery is tracked below. {expiresIn(fresh.expiresAt)}.</p><div className="invite-link-row"><input className="control" readOnly aria-label="Invitation link" value={linkFor(fresh.token)} onFocus={(e)=>e.currentTarget.select()} /><button className="btn" type="button" onClick={()=>void copy(fresh.token!)}><Icon name="copy" />{copied?'Copied':'Copy link'}</button></div><small>Single use, works only for {fresh.email}. Shown until you close this dialog. Replacing the link invalidates the earlier link.</small></div>}
        <section aria-labelledby="inviteListTitle" className="invite-list-wrap">
          <h3 id="inviteListTitle">Invitation history</h3><label htmlFor="invitationStatus">Status</label><select className="control" id="invitationStatus" value={status} onChange={(e)=>setStatus(e.target.value as InvitationStatus|'all')}><option value="all">All statuses</option>{(['pending','accepted','revoked','expired'] as const).map((value)=><option key={value} value={value}>{value[0]!.toUpperCase()+value.slice(1)}</option>)}</select>
          {list.isPending && <p className="field-help" role="status">Loading invitations…</p>}
          {list.isError && <ErrorNote error={list.error} ctx={context} onRetry={stale?undefined:()=>{if(list.isFetchNextPageError) void list.fetchNextPage();else void list.refetch();}} />}
          {stale && <p className="hint">The invitation list changed. Your draft and original request are kept. <button className="btn sm" type="button" onClick={()=>void queryClient.resetQueries({queryKey,exact:true})}>Reload invitations</button></p>}
          {list.isSuccess && !invitations.length && <p className="field-help">No invitations with this status.</p>}
          <ul className="invite-list">{invitations.map((inv)=>{const actions=invitationActions(actorRole,inv,archived); return <li key={inv.id} className="invite-row"><span className="invite-row-main"><strong>{inv.email}</strong><small>{ROLE_LABEL[inv.role as InviteRole]??inv.role} · {inv.status} · {expiresIn(inv.expiresAt)}</small><small>{invitationDeliveryText(inv.delivery)}</small></span>
            {actions.resend && <button className="btn sm" type="button" disabled={locked||!writable} onClick={()=>operation.mutate({action:'resend',id:inv.id,email:inv.email})} aria-label={`${actions.retryDelivery?'Retry delivery to':'Replace invitation link for'} ${inv.email}`}>{actions.retryDelivery?'Retry delivery':'Replace link'}</button>}
            {actions.revoke && <button className="btn sm" type="button" disabled={locked||!writable} onClick={()=>setConfirmRevoke(inv)} aria-label={`Revoke invitation to ${inv.email}`}>Revoke</button>}
            {actions.createNew && <button className="btn sm" type="button" disabled={locked||!writable} onClick={()=>{session.update({email:inv.email,role:inv.role as InviteRole});setEmailError('');document.getElementById('inviteEmail')?.focus();}}>Prepare new invitation</button>}
          </li>;})}</ul>
          {!unavailable && !!invitations.length && <p className="field-help">{invitations.length} loaded{list.hasNextPage ? '; more invitations available.' : '; end of this list.'}</p>}
          {!unavailable && list.hasNextPage && !stale && <button className="btn" type="button" disabled={list.isFetching} onClick={()=>void list.fetchNextPage()}>{list.isFetchingNextPage?'Loading…':'Load more invitations'}</button>}
          {confirmRevoke && <div role="group" aria-label="Confirm invitation revocation"><p>Revoke the invitation for {confirmRevoke.email}? Its current link will stop working.</p><button className="btn danger" type="button" disabled={locked||!writable} onClick={()=>operation.mutate({action:'revoke',id:confirmRevoke.id,email:confirmRevoke.email})}>Confirm revoke</button><button className="btn" type="button" disabled={operation.isPending} onClick={()=>setConfirmRevoke(null)}>Keep invitation</button></div>}
        </section>
      </>}
    </div><footer className="dialog-foot"><span className="spacer" /><button className="btn" type="button" onClick={onClose}>Done</button></footer>
  </DialogLayer>;
}
