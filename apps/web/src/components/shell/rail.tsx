'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { Wordmark } from '@/components/ui/wordmark';
import { Avatar } from '@/components/ui/avatar';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useActiveProject } from '@/lib/active-project';
import { can, ROLE_META } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { useShell } from './shell-context';

function NavLink({ href, icon, label, active, badge, quiet, onNavigate }: {
  href: string; icon: string; label: string; active?: boolean; badge?: ReactNode; quiet?: boolean; onNavigate: () => void;
}) {
  return (
    <Link className="nav-item" href={href} onClick={onNavigate} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} />
      <span>{label}</span>
      {badge ? <span className={`nav-badge${quiet ? ' quiet' : ''}`}>{badge}</span> : null}
    </Link>
  );
}

/** Not wired to the API yet: same look as a nav item, clearly labelled and inert. */
function SoonItem({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="nav-item is-soon" aria-disabled="true" title="Coming soon">
      <Icon name={icon} />
      <span>{label}</span>
      <span className="nav-badge quiet">Soon</span>
    </span>
  );
}

export function Rail() {
  const pathname = usePathname();
  const { state } = useSession();
  const shell = useShell();
  const { workspace, projects, projectId, role, boards, boardId } = useActiveProject();
  const actor = state.status === 'ready' ? state.session.actor : null;
  const unreadQuery = useQuery({ queryKey: ['notifications'], queryFn: async () => (await api.listNotifications()).data, enabled: state.status === 'ready', staleTime: 30_000 });
  const unread = (unreadQuery.data ?? []).filter((n) => !n.read).length;
  const firstBoard = boards[0]?.id ?? null;
  const boardHref = boardId ? `/board?id=${encodeURIComponent(boardId)}` : firstBoard ? `/board?id=${encodeURIComponent(firstBoard)}` : projectId ? `/project?id=${encodeURIComponent(projectId)}` : '/projects';
  const trap = (event: KeyboardEvent<HTMLElement>) => {
    if (!shell.overlay || !shell.navOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); shell.closeNav(); return; }
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button')).filter((el) => !el.hasAttribute('disabled') && !el.closest('[hidden]'));
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const close = () => { if (shell.overlay) shell.closeNav(false); };
  const workspaceName = workspace?.name ?? 'Workspace';
  const manage = can(role, 'manageBoard');
  return (
    <aside
      className={`rail${shell.overlay && shell.navOpen ? ' is-open' : ''}`}
      id="rail"
      aria-label="Workspace navigation"
      aria-hidden={!shell.navVisible}
      inert={!shell.navVisible}
      role={shell.overlay && shell.navOpen ? 'dialog' : undefined}
      aria-modal={shell.overlay && shell.navOpen ? true : undefined}
      onKeyDown={trap}
    >
      <div className="rail-heading">
        <div className="brand"><Wordmark /></div>
        <button className="icon-btn" type="button" aria-label="Close navigation" hidden={!shell.overlay} onClick={() => shell.closeNav()}>
          <Icon name="x" />
        </button>
      </div>

      <Link className="workspace-switch" href="/projects" onClick={close} aria-label={`Open ${workspaceName} projects`}>
        <span className="workspace-avatar" aria-hidden="true">{workspaceName.slice(0, 2).toUpperCase()}</span>
        <span className="workspace-copy">
          <strong>{workspaceName}</strong>
          <span>{projects.length} project{projects.length === 1 ? '' : 's'}</span>
        </span>
        <Icon name="chevron-down" />
      </Link>

      <nav className="rail-nav" aria-label="Primary">
        <div className="nav-group">
          <p className="nav-label">Workspace</p>
          <NavLink href={boardHref} icon="board" label="Board" active={pathname === '/board'} onNavigate={close} />
          <NavLink href="/projects" icon="folder" label="Projects" active={pathname === '/projects' || pathname === '/project'} onNavigate={close} />
          <NavLink href="/my-tasks" icon="list" label="My tasks" active={pathname === '/my-tasks'} onNavigate={close} />
          <NavLink href="/inbox" icon="inbox" label="Inbox" active={pathname === '/inbox'} badge={unread || undefined} onNavigate={close} />
          <NavLink href="/activity" icon="activity" label="Activity" active={pathname === '/activity'} onNavigate={close} />
        </div>
        {manage && (
          <div className="nav-group">
            <p className="nav-label">Manage</p>
            <NavLink href="/trash" icon="trash" label="Trash" active={pathname === '/trash'} onNavigate={close} />
            <NavLink href="/people" icon="users" label="People" active={pathname === '/people'} onNavigate={close} />
            <SoonItem icon="settings" label="Settings" />
          </div>
        )}
        <div className="rail-note">
          <Icon name="lock" className="icon-sm" />
          <span>Private by default. Cards, comments and images stay inside this project.</span>
        </div>
      </nav>

      {actor && (
        <div className="rail-user">
          <Avatar id={actor.id} name={actor.displayName} />
          <span className="rail-user-copy">
            <strong>{actor.displayName}</strong>
            <span>{ROLE_META[role].label}</span>
          </span>
          <Icon name="chevron-down" className="icon-sm" />
        </div>
      )}
    </aside>
  );
}
