'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';
import { Wordmark } from '@/components/ui/wordmark';

type Outcome =
  | { kind: 'idle' }
  | { kind: 'accepting' }
  | { kind: 'accepted'; projectId: string; role: string }
  | { kind: 'expired' | 'invalid' | 'mismatch' | 'readonly' | 'error'; message?: string };

function outcomeFor(error: unknown): Outcome {
  if (error instanceof ApiError) {
    if (error.code === 'INVITATION_EXPIRED') return { kind: 'expired' };
    if (error.code === 'INVALID_INVITATION') return { kind: 'invalid' };
    if (error.code === 'READ_ONLY_CONTEXT') return { kind: 'readonly' };
    if (error.status === 403) return { kind: 'mismatch' };
    return { kind: 'error', message: error.message };
  }
  return { kind: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' };
}

/**
 * Invitation screen (prototype screens/invitation.html). The API has no preview call, so before acceptance this page
 * shows no project name, inviter or role. The token is read once from the address bar, removed from it and kept only
 * in memory; it is never stored.
 */
function AcceptScreen() {
  const params = useSearchParams();
  const { state } = useSession();
  const queryClient = useQueryClient();
  const tokenRef = useRef<string | null>(null);
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const key = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    const token = params.get('token');
    if (token) {
      tokenRef.current = token;
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    }
    setHasToken(!!tokenRef.current);
  }, [params]);

  const signedIn = state.status === 'ready';
  const accept = async () => {
    const token = tokenRef.current;
    if (!token) return;
    setOutcome({ kind: 'accepting' });
    try {
      const res = await api.acceptInvitation(token, key.current);
      tokenRef.current = null;
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      setOutcome({ kind: 'accepted', projectId: res.data.projectId, role: res.data.role });
    } catch (error) {
      const next = outcomeFor(error);
      if (next.kind !== 'error') tokenRef.current = null;
      setOutcome(next);
    }
  };

  const view = (() => {
    if (outcome.kind === 'accepted') return { status: 'accepted', title: "You're in.", copy: `You joined the project as a ${outcome.role}. The invitation link can no longer be used.` };
    if (outcome.kind === 'expired') return { status: 'expired', title: 'This invitation expired.', copy: 'Invitation links have a fixed server deadline. Ask an Owner or Manager to send a new invitation if you still need access.' };
    if (outcome.kind === 'mismatch') return { status: 'mismatch', title: 'This invitation is for a different account.', copy: 'The signed-in email must match the invited email. Sign in with the invited account and open the link again.' };
    if (outcome.kind === 'readonly') return { status: 'invalid', title: 'This project is archived.', copy: 'Archived projects are read-only, so no new members can join.' };
    if (outcome.kind === 'invalid' || hasToken === false) return { status: 'invalid', title: 'This invitation link is not valid.', copy: 'The link may be incomplete, already used, or replaced by a newer invitation. Ask an Owner or Manager for a new one.' };
    return { status: 'valid', title: 'Join a Flowboard project.', copy: 'Accepting adds one project-scoped grant for the account you are signed in with.' };
  })();

  return (
    <div className="invite-shell">
      <header className="invite-top">
        <Link className="brand" href="/projects" aria-label="Flowboard"><Wordmark /></Link>
        <span className="spacer" />
        <Link className="btn ghost sm" href="/signin"><Icon name="arrow-left" />Back to sign in</Link>
      </header>
      <main className="invite-main" id="main">
        <div>
          <div id="inviteCard" aria-live="polite">
            <article className="invite-card" data-state={view.status}>
              <div className="invite-banner">
                <p className="eyebrow">Project invitation <span className="badge">{signedIn ? 'Signed in' : 'Signed out'}</span></p>
                <h1>{view.title}</h1>
                <p>{view.copy}</p>
              </div>
              <div className="invite-body">
                {outcome.kind === 'accepted' && <div className="auth-note success invite-state-note"><Icon name="info" /><span><strong>Invitation accepted</strong> Access is project-scoped. If the Owner changes your role later, this page will not update your grant.</span></div>}
                {outcome.kind === 'expired' && <div className="auth-note warn invite-state-note"><Icon name="clock" /><span><strong>Expired on the server clock</strong> The browser cannot extend or refresh the deadline.</span></div>}
                {outcome.kind === 'mismatch' && <div className="auth-note warn invite-state-note"><Icon name="clock" /><span><strong>Email mismatch</strong> Signing in with the right account will re-check the invitation.</span></div>}
                {(outcome.kind === 'invalid' || hasToken === false) && <div className="auth-note danger invite-state-note"><Icon name="x-circle" /><span><strong>No invitation preview</strong> For privacy, an invalid token does not reveal whether a project exists or who was invited.</span></div>}
                {outcome.kind === 'error' && <div className="auth-note danger invite-state-note" role="alert"><Icon name="x-circle" /><span><strong>Could not accept</strong> {outcome.message}</span></div>}

                {view.status === 'valid' && (
                  <>
                    <div className="invite-role"><Icon name="shield" /><span><strong>What happens next</strong><span>Your account joins the project with the role the invitation names. Board access is granted separately by an Owner.</span></span></div>
                    <div className="invite-actions">
                      {signedIn
                        ? <button className="btn primary" type="button" data-accept disabled={outcome.kind === 'accepting' || !hasToken} onClick={() => void accept()}><Icon name="check-circle" /> {outcome.kind === 'accepting' ? 'Accepting…' : 'Accept invitation'}</button>
                        : <Link className="btn primary" href="/signin"><Icon name="key" /> Sign in to accept</Link>}
                      <Link className="btn" href="/projects">Not now</Link>
                    </div>
                    {!signedIn && <div className="invite-account"><Icon name="key" /><span>Not signed in. Sign in with the invited email, then open this invitation link again.</span></div>}
                  </>
                )}
                {outcome.kind === 'accepted' && (
                  <div className="invite-actions">
                    <Link className="btn primary" href={`/project?id=${encodeURIComponent(outcome.projectId)}`}><Icon name="folder" /> Open project</Link>
                  </div>
                )}
                {view.status !== 'valid' && outcome.kind !== 'accepted' && (
                  <div className="invite-actions">
                    <Link className="btn primary" href="/signin"><Icon name="arrow-left" /> Back to sign in</Link>
                  </div>
                )}
                <div className="invite-privacy"><Icon name="lock" /><span>Before you accept, this page shows nothing about the project. Member lists, card content and the project description stay private until the grant exists.</span></div>
              </div>
            </article>
          </div>
        </div>
      </main>
    </div>
  );
}

export function InvitationAcceptPage() {
  return <Suspense fallback={<div role="status" className="state-note">Loading invitation…</div>}><AcceptScreen /></Suspense>;
}
