'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/session';
import { Rail } from './rail';
import { Topbar } from './topbar';
import { ShellProvider, useShell } from './shell-context';
import { ToastProvider } from '@/components/ui/toasts';
import { PollBanner } from '@/components/polling';
import { ErrorNote } from '@/components/ui/error-note';
import { describeFailureOf } from '@/lib/error-catalogue';
import { hasUnsaved, subscribeUnsaved } from '@/lib/unsaved';
import { NameStep } from '@/components/auth/name-step';
import { HoverTip } from '@/components/ui/hover-tip';

const BARE_ROUTES = ['/signin', '/invitation', '/invitations/accept', '/all-work'];

function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { state, refetch } = useSession();
  const shell = useShell();
  const isBoard = pathname === '/board';

  const unsaved = useSyncExternalStore(subscribeUnsaved, hasUnsaved, () => false);
  let content = children;
  if (state.status === 'signedOut' && unsaved) {
    // Keep the page so the unsaved text survives: sign in again in another tab, then come back here.
    content = (
      <>
        <ErrorNote note={describeFailureOf({ status: 401, code: 'UNAUTHORIZED' })} onAction={() => window.open(`/signin?state=session_ended&next=${encodeURIComponent(window.location.pathname + window.location.search)}`, '_blank', 'noopener')}>
          <div className="error-note-actions"><button className="btn sm" type="button" onClick={refetch}>I’ve signed in</button></div>
        </ErrorNote>
        {children}
      </>
    );
  } else if (state.status === 'loading') {
    content = <div role="status" className="state-note">Loading your session…</div>;
  } else if (state.status === 'signedOut') {
    content = (
      <section className="state-note" aria-labelledby="signedOutTitle">
        <h1 id="signedOutTitle">You are signed out</h1>
        <p>Your session ended or you have not signed in yet. Sign in to see your projects and boards.</p>
        <Link className="btn primary" href="/signin">Sign in</Link>
      </section>
    );
  } else if (state.status === 'error') {
    content = (
      <section role="alert" className="state-note">
        <h1>Flowboard isn’t reachable</h1>
        <p>{state.message}</p>
        <button type="button" className="btn" onClick={refetch}>Try again</button>
      </section>
    );
  }

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="app">
        <Rail />
        <div className="rail-scrim" id="railScrim" hidden={!(shell.overlay && shell.navOpen)} onClick={() => shell.closeNav()} />
        <div className="workspace" inert={shell.overlay && shell.navOpen}>
          <Topbar />
          <PollBanner />
          <main className={`page${pathname === '/projects' || pathname === '/project' ? ' portfolio-page' : ''}${pathname === '/project' ? ' project-workspace' : ''}${pathname === '/activity' ? ' activity-page' : ''}${pathname === '/trash' ? ' recovery-page' : ''}${pathname === '/people' ? ' people-page' : ''}${pathname === '/inbox' ? ' inbox-page' : ''}${pathname === '/my-tasks' ? ' my-work' : ''}${pathname === '/settings' ? ' settings-page' : ''}`} id="main" tabIndex={-1}>{content}</main>
        </div>
      </div>
      <span className="sr-only" id="workspaceModeStatus" aria-live="polite">{shell.modeStatus}</span>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { state } = useSession();
  // A signed-in person without a saved name sees the name step before any other screen (the invitation page does it itself).
  if (state.status === 'ready' && state.session.needsName && pathname !== '/invitations/accept' && pathname !== '/invitation') return <NameStep session={state.session} />;
  if (BARE_ROUTES.includes(pathname)) return <>{children}</>;
  return (
    <ShellProvider>
      <ToastProvider>
        <Frame>{children}</Frame>
        <HoverTip />
      </ToastProvider>
    </ShellProvider>
  );
}
