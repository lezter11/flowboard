'use client';

import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';
import { Wordmark } from '@/components/ui/wordmark';
import { createTapCounter, invitationSignInHref, motionAllowed, pickGreeting, signedInAsLine } from '@/lib/invitation-fx';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
function useMotionAllowed(): boolean {
  const reduced = useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(REDUCED_QUERY);
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => true,
  );
  return motionAllowed(reduced);
}

const CONFETTI = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2;
  return { dx: Math.round(Math.cos(angle) * (50 + (i % 3) * 14)), dy: Math.round(Math.sin(angle) * (44 + (i % 2) * 18)), r: (i % 2 ? 1 : -1) * (120 + i * 20) };
});

/** Small hero picture: an envelope that opens, a check that draws, or two account bubbles that float. Decorative. Five quick taps (pointer only, no extra tab stop) fire the easter egg, and only when motion is allowed. */
function HeroArt({ kind, motion }: { kind: 'envelope' | 'check' | 'accounts'; motion: boolean }) {
  const counter = useRef(createTapCounter()).current;
  const [burst, setBurst] = useState(0);
  const onTap = () => { if (motion && counter.tap()) setBurst((n) => n + 1); };
  return (
    <div className={`invite-art${kind === 'envelope' ? ' is-envelope' : ''}${burst && kind === 'accounts' ? ' is-swap' : ''}`} key={`${kind}-${kind === 'accounts' ? burst : 0}`} onClick={onTap} aria-hidden="true" data-art={kind}>
      {kind === 'envelope' && (
        <svg viewBox="0 0 76 76"><rect className="art-env-back" x="8" y="26" width="60" height="40" rx="6" /><rect className="art-letter" x="16" y="34" width="44" height="26" rx="3" /><path className="art-line" d="M24 44h28M24 51h18" /><path className="art-env-front" d="M8 32l30 20 30-20v28a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6z" /><path className="art-env-flap" d="M8 26l30 22 30-22a6 6 0 0 0-6-6H14a6 6 0 0 0-6 6z" /></svg>
      )}
      {kind === 'check' && (
        <svg viewBox="0 0 76 76"><circle className="art-ring" cx="38" cy="38" r="28" /><path className="art-check" d="M25 39l9 9 18-19" /></svg>
      )}
      {kind === 'accounts' && (
        <svg viewBox="0 0 76 76"><circle className="art-bubble-a" cx="28" cy="38" r="17" /><circle className="art-bubble-dot" cx="28" cy="33" r="5" /><path className="art-bubble-dot" d="M19 49a9 9 0 0 1 18 0z" /><circle className="art-bubble-b" cx="50" cy="38" r="17" /><circle className="art-bubble-dot b" cx="50" cy="33" r="5" /><path className="art-bubble-dot b" d="M41 49a9 9 0 0 1 18 0z" /></svg>
      )}
      {motion && burst > 0 && kind !== 'accounts' && (
        <span className="invite-confetti" key={burst}>{CONFETTI.map((c, i) => <i key={i} style={{ '--dx': `${c.dx}px`, '--dy': `${c.dy}px`, '--r': `${c.r}deg`, '--i': i } as React.CSSProperties} />)}</span>
      )}
    </div>
  );
}

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

  // Not session.signOut(): that hard-navigates to /signin and the one-time link, held only in memory, would be lost.
  const switchAccount = async () => {
    try { await api.logout(); } catch { /* the session query below shows the real state */ }
    await queryClient.resetQueries({ queryKey: ['session'] });
    setOutcome({ kind: 'idle' });
  };
  const signedIn = state.status === 'ready';
  // Signed-out visitors go through Google sign-in and come back here: the API validates this same-app return path and hands it back after the callback.
  const signInHref = invitationSignInHref(tokenRef.current);
  const motion = useMotionAllowed();
  const signedInAs = state.status === 'ready' ? signedInAsLine(state.session.actor.email) : null;
  const [greeting, setGreeting] = useState(pickGreeting(0));
  useEffect(() => { setGreeting(pickGreeting(Math.random())); }, []);
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
      // A wrong-account answer keeps the link usable: the person can switch accounts and accept without opening the email again.
      if (next.kind !== 'error' && next.kind !== 'mismatch') tokenRef.current = null;
      setOutcome(next);
    }
  };

  const view = (() => {
    if (outcome.kind === 'accepted') return { status: 'accepted', title: "You're in. Welcome aboard.", copy: `You joined the project as a ${outcome.role}. The invitation link can no longer be used.` };
    if (outcome.kind === 'expired') return { status: 'expired', title: 'This invitation expired.', copy: 'Invitation links have a fixed server deadline. Ask an Owner or Manager to send a new invitation if you still need access.' };
    if (outcome.kind === 'mismatch') return { status: 'mismatch', title: 'This invitation is for a different account.', copy: 'You are signed in with a different email than the one that was invited. Switch accounts and we will bring you straight back to this invitation.' };
    if (outcome.kind === 'readonly') return { status: 'invalid', title: 'This project is archived.', copy: 'Archived projects are read-only, so no new members can join.' };
    if (outcome.kind === 'invalid' || hasToken === false) return { status: 'invalid', title: 'This invitation link is not valid.', copy: 'The link may be incomplete, already used, or replaced by a newer invitation. Ask an Owner or Manager for a new one.' };
    return { status: 'valid', title: 'You have been invited to a project.', copy: 'Accept to join with the account you are signed in with. It takes one click.' };
  })();

  return (
    <div className="invite-shell">
      <header className="invite-top">
        <Link className="brand brand-on-light" href="/projects" aria-label="Flowboard"><Wordmark mark outline /></Link>
        <span className="spacer" />
        <Link className="btn ghost sm" href="/signin"><Icon name="arrow-left" />Back to sign in</Link>
      </header>
      <main className="invite-main" id="main">
        <div>
          <div id="inviteCard" aria-live="polite">
            <article className="invite-card" data-state={view.status}>
              <div className="invite-banner">
                <div className="invite-hero">
                  <HeroArt kind={outcome.kind === 'accepted' ? 'check' : view.status === 'mismatch' ? 'accounts' : 'envelope'} motion={motion} />
                  <div>
                    <p className="eyebrow">Project invitation <span className="badge">{signedIn ? 'Signed in' : 'Signed out'}</span></p>
                    {view.status === 'valid' && <p className="invite-greeting">{greeting}</p>}
                  </div>
                </div>
                <h1>{view.title}</h1>
                <p>{view.copy}</p>
              </div>
              <div className="invite-body">
                {outcome.kind === 'accepted' && <div className="auth-note success invite-state-note"><Icon name="info" /><span><strong>Invitation accepted</strong> Access is project-scoped, and project access is not board access: you will see no boards until the Owner gives you access to them. If the Owner changes your role later, this page will not update your grant.</span></div>}
                {outcome.kind === 'expired' && <div className="auth-note warn invite-state-note"><Icon name="clock" /><span><strong>Expired on the server clock</strong> The browser cannot extend or refresh the deadline.</span></div>}
                {outcome.kind === 'mismatch' && signedInAs && <div className="invite-who"><Icon name="users" /><span>{signedInAs}</span></div>}
                {outcome.kind === 'mismatch' && <div className="auth-note warn invite-state-note"><Icon name="clock" /><span><strong>Why this happened</strong> An invitation can only be accepted by the email it was sent to. Nothing was changed on either account.</span></div>}
                {outcome.kind === 'mismatch' && (
                  <div className="invite-actions">
                    {signedIn && <button className="btn primary" type="button" onClick={() => void switchAccount()}><Icon name="arrow-left" /> Sign out and switch account</button>}
                    <Link className="btn" href="/projects">Not now</Link>
                  </div>
                )}
                {(outcome.kind === 'invalid' || hasToken === false) && <div className="auth-note danger invite-state-note"><Icon name="x-circle" /><span><strong>No invitation preview</strong> For privacy, an invalid token does not reveal whether a project exists or who was invited.</span></div>}
                {outcome.kind === 'error' && <div className="auth-note danger invite-state-note" role="alert"><Icon name="x-circle" /><span><strong>Could not accept</strong> {outcome.message}</span></div>}

                {view.status === 'valid' && (
                  <>
                    <div className="invite-role"><Icon name="shield" /><span><strong>What happens next</strong><span>Your account joins the project with the role the invitation names. Board access is granted separately by an Owner.</span></span></div>
                    <div className="invite-actions">
                      {signedIn
                        ? <button className="btn primary" type="button" data-accept disabled={outcome.kind === 'accepting' || !hasToken} onClick={() => void accept()}><Icon name="check-circle" /> {outcome.kind === 'accepting' ? 'Accepting…' : 'Accept invitation'}</button>
                        : <a className="btn primary" href={signInHref}><Icon name="key" /> Sign in to accept</a>}
                      <Link className="btn" href="/projects">Not now</Link>
                    </div>
                    {!signedIn && <div className="invite-account"><Icon name="key" /><span>Not signed in. Sign in with the invited email and you will return to this invitation to accept it.</span></div>}
                  </>
                )}
                {outcome.kind === 'accepted' && (
                  <div className="invite-actions">
                    <Link className="btn primary" href={`/project?id=${encodeURIComponent(outcome.projectId)}`}><Icon name="folder" /> Open project</Link>
                  </div>
                )}
                {view.status !== 'valid' && view.status !== 'mismatch' && outcome.kind !== 'accepted' && (
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
