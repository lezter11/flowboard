'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { Avatar } from '@/components/ui/avatar';
import { useActiveProject } from '@/lib/active-project';
import { ROLE_META } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { useShell } from './shell-context';
import { UserMenu } from './user-menu';

const ROLE_ICON = { owner: 'shield', manager: 'shield', member: 'user-check', viewer: 'eye' } as const;

export function Topbar() {
  const pathname = usePathname();
  const { state } = useSession();
  const shell = useShell();
  const { workspace, project, role, board } = useActiveProject();
  const actor = state.status === 'ready' ? state.session.actor : null;
  const team = (board?.people ?? []).filter((p) => p.activeInProject).slice(0, 3);
  const workspaceName = workspace?.name ?? 'Workspace';
  const isBoard = pathname === '/board';

  const crumbs: Array<{ label: string; href?: string }> = [{ label: workspaceName, href: '/projects' }];
  if (pathname === '/projects') crumbs.push({ label: 'Projects' });
  else if (project) crumbs.push({ label: project.name, href: pathname === '/project' ? undefined : `/project?id=${encodeURIComponent(project.id)}` });

  return (
    <header className="topbar" id="topbar">
      {!isBoard && (
        <button
          className="icon-btn menu-btn"
          ref={shell.menuRef}
          type="button"
          aria-label={shell.navVisible ? 'Hide navigation' : 'Show navigation'}
          aria-controls="rail"
          aria-expanded={shell.navVisible}
          onClick={shell.toggleNav}
        >
          <Icon name="menu" className="icon-lg" />
        </button>
      )}
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <span key={`${crumb.label}-${index}`} style={{ display: 'contents' }}>
              {crumb.href && !last ? <Link href={crumb.href}>{crumb.label}</Link> : <span className={last ? 'current' : undefined}>{crumb.label}</span>}
              {last ? null : <span className="sep">/</span>}
            </span>
          );
        })}
      </nav>
      <div className="topbar-spacer" />
      {team.length > 0 && (
        <div className="presence" aria-label="Project team">
          <span className="presence-label">Team</span>
          {team.map((person) => <Avatar key={person.id} id={person.id} name={person.displayName} />)}
        </div>
      )}
      <span className="role-badge" data-role={role} role="group" tabIndex={0} aria-label={`Your role in this project: ${ROLE_META[role].label}. ${ROLE_META[role].description}.`} data-tip={`Your role in this project: ${ROLE_META[role].description}`}>
        <Icon name={ROLE_ICON[role]} />
        <span>{ROLE_META[role].label}</span>
      </span>
      <button className="icon-btn" id="themeToggle" type="button" aria-label={shell.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} aria-pressed={shell.theme === 'dark'} onClick={shell.toggleTheme}>
        <Icon name="sun" className="theme-icon-light" />
        <Icon name="moon" className="theme-icon-dark" />
      </button>
      {actor && (
        <UserMenu placement="top" className="icon-btn topbar-user" label={`Account menu for ${actor.displayName}`}>
          <Avatar id={actor.id} name={actor.displayName} className="topbar-avatar" />
        </UserMenu>
      )}
    </header>
  );
}
