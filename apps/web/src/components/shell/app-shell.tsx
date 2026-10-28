'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/session';
import { Rail } from './rail';
import { Topbar } from './topbar';
import { ShellProvider, useShell } from './shell-context';
import { ToastProvider } from '@/components/ui/toasts';
import { HoverTip } from '@/components/ui/hover-tip';

const BARE_ROUTES = ['/signin', '/invitation', '/invitations/accept'];

function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { state, refetch } = useSession();
  const shell = useShell();
  const isBoard = pathname === '/board';

  let content = children;
  if (state.status === 'loading') {
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
        <h1>Flowboard is unreachable</h1>
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
          <main className={`page${pathname === '/projects' || pathname === '/project' ? ' portfolio-page' : ''}${pathname === '/project' ? ' project-workspace' : ''}${pathname === '/activity' ? ' activity-page' : ''}${pathname === '/trash' ? ' recovery-page' : ''}${pathname === '/people' ? ' people-page' : ''}${pathname === '/inbox' ? ' inbox-page' : ''}`} id="main" tabIndex={-1}>{content}</main>
        </div>
      </div>
      <span className="sr-only" id="workspaceModeStatus" aria-live="polite">{shell.modeStatus}</span>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
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
