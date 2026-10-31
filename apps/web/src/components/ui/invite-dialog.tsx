'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Invitation } from '@flowboard/contracts';
import { api } from '@/lib/api';
import { usePollKeys } from '@/components/polling';
import { describeError } from '@/lib/errors';
import { QuotaPanel } from '@/components/ui/quota-panel';
import { quotaAdvice, type QuotaAdvice } from '@/lib/quota-messages';
import { ApiError } from '@/lib/api';
import { checkInvitationEmail, emailFieldAria } from '@/lib/invite-email';
import type { Role } from '@/lib/roles';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toasts';

type InviteRole = 'manager' | 'member' | 'viewer';
const ROLE_LABEL: Record<InviteRole, string> = { manager: 'Manager', member: 'Member', viewer: 'Viewer' };
const ROLE_HELP: Record<InviteRole, string> = {
  manager: 'Configures boards, invites people, trashes and restores cards, imports.',
  member: 'Creates, edits and moves cards, comments and uploads images.',
  viewer: 'Reads the boards they are given access to. Cannot change anything.',
};
const expiresIn = (iso: string) => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const hours = Math.round(ms / 3_600_000);
  return hours < 24 ? `in ${Math.max(hours, 1)}h` : `in ${Math.round(hours / 24)} days`;
};
/** One place for every refusal in this dialog: a limit gets the panel, a missing name gets a link to Settings, the rest one sentence. */
const ctxFor = (role: Role, projectId: string) => ({ role, projectId });
const checked = (raw: string) => { const r = checkInvitationEmail(raw); return r.ok ? r.value : raw.trim().toLowerCase(); };
const linkFor = (token: string) => `${window.location.origin}/invitation?token=${encodeURIComponent(token)}`;

/**
 * Invite people to a project (Owner and Manager). The server sends the email; its response also carries the one-time token,
 * so the inviter can copy the link when mail is slow. The link is shown only for the invitation just created or resent and is
 * never stored. Project access is not board access: the dialog says so and links to the Owner's Board access step.
 */
export function InviteDialog({ projectId, projectName, actorRole, open, onClose }: { projectId: string; projectName: string; actorRole: Role; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('member');
  const [error, setError] = useState('');
  const [advice, setAdvice] = useState<QuotaAdvice | null>(null);
  const [needsName, setNeedsName] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [fresh, setFresh] = useState<{ id: string; email: string; role: InviteRole; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const attempt = useRef<string | null>(null);
  const roles: InviteRole[] = actorRole === 'owner' ? ['manager', 'member', 'viewer'] : ['member', 'viewer'];

  useEffect(() => { if (open) { setEmail(''); setRole('member'); setError(''); setAdvice(null); setNeedsName(false); setEmailError(''); setFresh(null); setCopied(false); attempt.current = null; } }, [open, projectId]);

  usePollKeys([['invitations', projectId]], open);
  const list = useQuery({ queryKey: ['invitations', projectId], queryFn: async () => (await api.listInvitations(projectId)).data, enabled: open });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['invitations', projectId] });

  const fail = (err: unknown) => {
    const quota = err instanceof ApiError ? quotaAdvice(err, ctxFor(actorRole, projectId)) : null;
    setAdvice(quota);
    setNeedsName(err instanceof ApiError && err.code === 'NAME_REQUIRED');
    setError(quota ? '' : describeError(err, ctxFor(actorRole, projectId)));
  };

  const create = useMutation({
    mutationFn: () => { attempt.current ??= `idemp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`; return api.createInvitation(projectId, { email: checked(email), role }, attempt.current); },
    onSuccess: (res) => { attempt.current = null; setError(''); setAdvice(null); setNeedsName(false); setCopied(false); setFresh(res.data.token ? { id: res.data.id, email: res.data.email, role: res.data.role as InviteRole, token: res.data.token } : null); setEmail(''); toast('Invitation sent', { icon: 'check' }); void refresh(); },
    onError: (err) => { attempt.current = null; fail(err); void refresh(); },
  });
  const resend = useMutation({
    mutationFn: (inv: Invitation) => api.resendInvitation(projectId, inv.id),
    onSuccess: (res) => { setError(''); setAdvice(null); setNeedsName(false); setCopied(false); setFresh(res.data.token ? { id: res.data.id, email: res.data.email, role: res.data.role as InviteRole, token: res.data.token } : null); toast('Invitation sent again. The earlier link no longer works.', { icon: 'check' }); void refresh(); },
    onError: (err) => { fail(err); void refresh(); },
  });
  const revoke = useMutation({
    mutationFn: (inv: Invitation) => api.revokeInvitation(projectId, inv.id),
    onSuccess: (_r, inv) => { setError(''); setFresh((f) => (f?.id === inv.id ? null : f)); toast('Invitation revoked', { icon: 'check' }); void refresh(); },
    onError: (err) => { setError(describeError(err)); void refresh(); },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    const result = checkInvitationEmail(email);
    if (!result.ok) { setEmailError(result.message); setError(''); document.getElementById('inviteEmail')?.focus(); return; }
    setEmailError(''); setError('');
    create.mutate();
  };
  const copy = async (token: string) => {
    try { await navigator.clipboard.writeText(linkFor(token)); setCopied(true); } catch { setError('Could not copy. Select the link and copy it yourself.'); }
  };

  const invitations = list.data ?? [];
  const pending = invitations.filter((i) => i.status === 'pending');
  const past = invitations.filter((i) => i.status !== 'pending');
  const busy = resend.isPending || revoke.isPending;
  return (
    <DialogLayer open={open} onClose={onClose} labelledBy="inviteTitle" className="wide invite-dialog">
      <div className="dialog-head">
        <div className="dialog-head-copy"><h2 id="inviteTitle">Invite people</h2><p>to {projectName}</p></div>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Close invite dialog"><Icon name="x" /></button>
      </div>
      <div className="dialog-body invite-dialog-body">
        <form onSubmit={submit} noValidate className="invite-form">
          <div className="dialog-field">
            <label htmlFor="inviteEmail">Email address</label>
            <input className="control" id="inviteEmail" type="email" autoComplete="off" inputMode="email" data-autofocus placeholder="name@company.com" value={email} {...emailFieldAria(emailError, 'inviteEmailError')} onChange={(e) => { setError(''); if (emailError) setEmailError(''); setEmail(e.target.value); }} onBlur={() => { if (email.trim()) { const r = checkInvitationEmail(email); setEmailError(r.ok ? '' : r.message); } }} />
            {emailError && <p id="inviteEmailError" className="field-error" role="alert">{emailError}</p>}
          </div>
          <div className="dialog-field">
            <label htmlFor="inviteRole">Project role</label>
            <select className="control" id="inviteRole" value={role} onChange={(e) => setRole(e.target.value as InviteRole)} aria-describedby="inviteRoleHelp">
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <p id="inviteRoleHelp" className="field-help">{ROLE_HELP[role]}</p>
          </div>
          <button className="btn primary" type="submit" disabled={create.isPending}><Icon name="send" />{create.isPending ? 'Sending…' : 'Send invitation'}</button>
        </form>

        <p className="invite-access-note"><Icon name="lock" /><span><strong>Project access is not board access.</strong> {actorRole === 'owner' ? <>After they accept, give them boards under <Link href="/people">People › Board access</Link>. Until then they see no boards.</> : 'After they accept, the project Owner chooses which boards they can open. Until then they see no boards.'}</span></p>

        {advice && <QuotaPanel advice={advice} role="alert" onNavigate={onClose} />}
        {error && <p className="form-error" role="alert">{error}{needsName && <> <Link href="/settings?tab=account" onClick={onClose}>Open Settings</Link></>}</p>}

        {fresh && (
          <div className="invite-fresh" role="status">
            <p><strong>Invitation sent to {fresh.email}</strong> as {ROLE_LABEL[fresh.role]}. The email may take a moment; you can also share the link yourself.</p>
            <div className="invite-link-row">
              <input className="control" readOnly aria-label="Invitation link" value={linkFor(fresh.token)} onFocus={(e) => e.currentTarget.select()} />
              <button className="btn" type="button" onClick={() => void copy(fresh.token)}><Icon name="copy" />{copied ? 'Copied' : 'Copy link'}</button>
            </div>
            <small>Single use, valid for 7 days, works only for {fresh.email}. Shown only now.</small>
          </div>
        )}

        <section aria-labelledby="inviteListTitle" className="invite-list-wrap">
          <h3 id="inviteListTitle">Pending invitations {pending.length > 0 && <span className="badge">{pending.length}</span>}</h3>
          {list.isPending && <p className="field-help">Loading…</p>}
          {list.isError && <p className="form-error" role="alert">{describeError(list.error)}</p>}
          {list.isSuccess && pending.length === 0 && <p className="field-help">No pending invitations.</p>}
          <ul className="invite-list">
            {pending.map((inv) => (
              <li key={inv.id} className="invite-row">
                <span className="invite-row-main"><strong>{inv.email}</strong><small>{ROLE_LABEL[inv.role as InviteRole] ?? inv.role} · expires {expiresIn(inv.expiresAt)}</small></span>
                <button className="btn sm" type="button" disabled={busy} onClick={() => resend.mutate(inv)} aria-label={`Resend invitation to ${inv.email}`}>Resend</button>
                <button className="btn sm" type="button" disabled={busy} onClick={() => revoke.mutate(inv)} aria-label={`Revoke invitation to ${inv.email}`}>Revoke</button>
              </li>
            ))}
          </ul>
          {past.length > 0 && (
            <details className="invite-past">
              <summary>Earlier invitations ({past.length})</summary>
              <ul className="invite-list">
                {past.map((inv) => (
                  <li key={inv.id} className="invite-row">
                    <span className="invite-row-main"><strong>{inv.email}</strong><small>{ROLE_LABEL[inv.role as InviteRole] ?? inv.role} · {inv.status}</small></span>
                    {(inv.status === 'expired' || inv.status === 'revoked') && <button className="btn sm" type="button" disabled={busy} onClick={() => resend.mutate(inv)} aria-label={`Send ${inv.email} a new invitation`}>Send again</button>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
      <footer className="dialog-foot"><span className="spacer" /><button className="btn" type="button" onClick={onClose}>Done</button></footer>
    </DialogLayer>
  );
}
