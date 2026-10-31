'use client';

import { useMemo, type KeyboardEvent, type ReactNode } from 'react';
import { m } from 'motion/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { Wordmark } from '@/components/ui/wordmark';
import { Avatar } from '@/components/ui/avatar';
import { UserMenu } from './user-menu';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useBoardHref } from '@/lib/board-target';
import { useActiveProject } from '@/lib/active-project';
import { can, ROLE_META } from '@/lib/roles';
import { ProjectSwitcher } from './project-switcher';
import { useSession } from '@/lib/session';
import { usePollKeys } from '@/components/polling';
import { useShell } from './shell-context';
import { useRailGroups, useRailMini } from '@/lib/rail-state';

const TONES = ['thistle', 'icy', 'petal', 'sky', 'pink', 'green'] as const;
type Tone = (typeof TONES)[number];

/** One rail item: coloured icon tile, label, optional live count, and the shared sliding pill behind the current page. */
function NavLink({ href, icon, label, tone, active, badge, onNavigate }: {
  href: string; icon: string; label: string; tone: Tone; active?: boolean; badge?: number; onNavigate: () => void;
}) {
  const shown = badge ? (badge > 99 ? '99+' : String(badge)) : null;
  return (
    <Link className="nav-item" data-tone={tone} data-tip={label} href={href} onClick={onNavigate} aria-current={active ? 'page' : undefined} aria-label={shown ? `${label}, ${badge} ${label === 'Inbox' ? 'unread' : 'open'}` : undefined}>
      {active && <m.span className="nav-pill" layoutId="rail-pill" transition={{ type: 'spring', stiffness: 520, damping: 42, mass: 0.7 }} aria-hidden="true" />}
      <span className="nav-tile" aria-hidden="true"><Icon name={icon} /></span>
      <span className="nav-text">{label}</span>
      {shown ? <span className="nav-badge" aria-hidden="true">{shown}</span> : null}
    </Link>
  );
}

/** A collapsible group: header button with chevron and item count, items on a thin tree line. */
function NavGroup({ id, label, closed, onToggle, children, count }: { id: string; label: string; closed: boolean; onToggle: (id: string) => void; children: ReactNode; count: number }) {
  return (
    <div className={`nav-group${closed ? ' is-closed' : ''}`}>
      <button className="nav-group-head" type="button" aria-expanded={!closed} aria-controls={`navgroup-${id}`} onClick={() => onToggle(id)}>
        <span className="nav-label">{label}</span>
        <span className="nav-group-count" aria-hidden="true">{count}</span>
        <Icon name="chevron-down" className="nav-chevron" />
      </button>
      <div className="nav-tree-wrap" id={`navgroup-${id}`} inert={closed}>
        <div className="nav-tree">{children}</div>
      </div>
    </div>
  );
}

export function Rail() {
  const pathname = usePathname();
  const { state } = useSession();
  const shell = useShell();
  const { project, projects, projectId, role, boardId } = useActiveProject();
  const actor = state.status === 'ready' ? state.session.actor : null;
  const unreadQuery = useQuery({ queryKey: ['notifications'], queryFn: async () => (await api.listNotifications()).data, enabled: state.status === 'ready', staleTime: 30_000 });
  usePollKeys([['notifications']], state.status === 'ready');
  const unread = (unreadQuery.data ?? []).filter((n) => !n.read).length;
  const boardHref = useBoardHref(projectId, boardId);
  const router = useRouter();
  const [mini, toggleMini] = useRailMini();
  const [closedGroups, toggleGroup] = useRailGroups();
  const compact = mini && !shell.overlay;
  const live = state.status === 'ready';
  const openProjects = useMemo(() => (live ? state.session.accessibleProjects : []).filter((p) => !p.isArchived), [live, state]);
  const taskQueries = useQueries({ queries: openProjects.map((p) => ({ queryKey: ['my-tasks', p.id], queryFn: async () => (await api.listMyTasks(p.id)).data, enabled: live, staleTime: 60_000 })) });
  const taskCount = taskQueries.every((q) => q.isSuccess) ? taskQueries.reduce((sum, q) => sum + (q.data?.length ?? 0), 0) : 0;
  const openSearch = () => {
    close();
    if (pathname === '/board') { const input = document.getElementById('searchInput'); input?.focus(); return; }
    router.push(`${boardHref}${boardHref.includes('?') ? '&' : '?'}search=1`);
  };
  const arrows = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a.nav-item, .nav-group-head, .nav-search')).filter((el) => !el.closest('[inert]'));
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
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
  const manage = !!role && can(role, 'manageBoard');
  return (
    <aside
      className={`rail${shell.overlay && shell.navOpen ? ' is-open' : ''}`}
      id="rail"
      aria-label="Main navigation"
      aria-hidden={!shell.navVisible}
      inert={!shell.navVisible}
      role={shell.overlay && shell.navOpen ? 'dialog' : undefined}
      aria-modal={shell.overlay && shell.navOpen ? true : undefined}
      onKeyDown={trap}
    >
      <div className="rail-heading">
        <div className="brand"><Wordmark mark outline /></div>
        <button className="icon-btn" type="button" aria-label="Close navigation" hidden={!shell.overlay} onClick={() => shell.closeNav()}>
          <Icon name="x" />
        </button>
        <button className="rail-collapse" type="button" aria-label={mini ? 'Expand sidebar' : 'Collapse sidebar to icons'} aria-pressed={mini} data-tip={mini ? 'Expand sidebar' : 'Collapse sidebar'} hidden={shell.overlay} onClick={toggleMini}>
          <Icon name="chevron-right" />
        </button>
      </div>

      <ProjectSwitcher projects={projects} current={project} compact={compact} onNavigate={close} />

      {boardHref.startsWith('/board') && (
        <button className="nav-search" type="button" onClick={openSearch} aria-label="Search cards" aria-keyshortcuts="/" data-tip="Search cards ( / )">
          <Icon name="search" />
          <span className="nav-text">Search cards</span>
          <kbd aria-hidden="true">/</kbd>
        </button>
      )}

      <nav className="rail-nav" aria-label="Primary" onKeyDown={arrows}>
        <NavGroup id="workspace" label="Navigate" count={5} closed={!!closedGroups.workspace && !compact} onToggle={toggleGroup}>
          <NavLink href={boardHref} icon="board" label="Board" tone="thistle" active={pathname === '/board'} onNavigate={close} />
          <NavLink href="/projects" icon="folder" label="Projects" tone="icy" active={pathname === '/projects' || pathname === '/project'} onNavigate={close} />
          <NavLink href="/my-tasks" icon="list" label="My tasks" tone="petal" active={pathname === '/my-tasks'} badge={taskCount} onNavigate={close} />
          <NavLink href="/inbox" icon="inbox" label="Inbox" tone="sky" active={pathname === '/inbox'} badge={unread} onNavigate={close} />
          <NavLink href="/activity" icon="activity" label="Activity" tone="green" active={pathname === '/activity'} onNavigate={close} />
        </NavGroup>
        {manage && (
          <NavGroup id="manage" label="Manage" count={4} closed={!!closedGroups.manage && !compact} onToggle={toggleGroup}>
            <NavLink href="/trash" icon="trash" label="Trash" tone="pink" active={pathname === '/trash'} onNavigate={close} />
            <NavLink href="/people" icon="users" label="People" tone="icy" active={pathname === '/people'} onNavigate={close} />
            <NavLink href="/import" icon="upload" label="Import" tone="green" active={pathname === '/import'} onNavigate={close} />
            <NavLink href="/settings" icon="settings" label="Settings" tone="thistle" active={pathname === '/settings'} onNavigate={close} />
          </NavGroup>
        )}
        <div className="rail-note">
          <Icon name="lock" className="icon-sm" />
          <span>Private by default. Cards, comments and images stay inside this project.</span>
        </div>
      </nav>

      {actor && (
        <div className="rail-user-wrap" data-tip={actor.displayName}>
          <UserMenu placement="rail" className="rail-user" label={`Account menu for ${actor.displayName}`}>
            <Avatar id={actor.id} name={actor.displayName} />
            <span className="rail-user-copy">
              <strong>{actor.displayName}</strong>
              {project && role && <span>{ROLE_META[role].label}</span>}
            </span>
            <Icon name="chevron-up" className="icon-sm" />
          </UserMenu>
        </div>
      )}
    </aside>
  );
}
