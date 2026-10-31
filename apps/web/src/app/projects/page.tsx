'use client';

import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Board, SessionProjectSummary } from '@flowboard/contracts';
import { projectMark, projectTone, usePortfolio, type BoardStats } from '@/lib/portfolio';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';
import { NewProjectDialog } from '@/components/project/new-project-dialog';
import { ROLE_META, normalizeRole } from '@/lib/roles';
import { projectUsage, splitProjects, usageText } from '@/lib/project-groups';

const NO_STATS: BoardStats = { total: 0, done: 0, open: 0, percent: 0 };

function ProjectMark({ project }: { project: SessionProjectSummary }) {
  return <span className={`ph-mark tone-${projectTone(project.id)}`} aria-hidden="true">{projectMark(project.name)}</span>;
}

function projectStats(boards: Board[], stats: Map<string, BoardStats | null>): BoardStats {
  const sum = boards.reduce((acc, b) => {
    const s = stats.get(b.id) ?? NO_STATS;
    return { total: acc.total + s.total, done: acc.done + s.done, open: acc.open + s.open, percent: 0 };
  }, NO_STATS);
  return { ...sum, percent: sum.total ? Math.round((sum.done / sum.total) * 100) : 0 };
}

function RoleChip({ project }: { project: SessionProjectSummary }) {
  const role = normalizeRole(project.role);
  return <span className="role-chip" title={ROLE_META[role].description}><span className="sr-only">Your role: </span>{ROLE_META[role].label}</span>;
}

function ProjectGroup({ id, title, count, view, children }: { id: string; title: string; count: number; view: 'map' | 'list'; children: ReactNode }) {
  return (
    <section className="project-group" aria-labelledby={`${id}Heading`}>
      <h2 className="project-group-title" id={`${id}Heading`}>{title} <span>{count}</span></h2>
      <div className={`project-collection ${view === 'list' ? 'project-collection-list' : 'project-collection-map'}`}>{children}</div>
    </section>
  );
}

function ProjectsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { state } = useSession();
  const { projects, boardsByProject, statsByBoard, loading } = usePortfolio();
  const tab: 'active' | 'archived' = params.get('tab') === 'archived' ? 'archived' : 'active';
  const view: 'map' | 'list' = params.get('view') === 'list' ? 'list' : 'map';
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(params.get('new') === '1');

  const usage = state.status === 'ready' ? projectUsage(state.session) : null;
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.replace(`${pathname}${next.size ? `?${next.toString()}` : ''}`, { scroll: false });
  };

  // ?new=1 (from the project switcher) opens the dialog once and is then removed, so a refresh does not reopen it.
  useEffect(() => { if (params.get('new') === '1') setParam('new', null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeCount = projects.filter((p) => !p.isArchived).length;
  const archivedCount = projects.length - activeCount;
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return projects.filter((p) => p.isArchived === (tab === 'archived')).filter((p) => {
      if (!q) return true;
      const boardNames = (boardsByProject.get(p.id) ?? []).map((b) => b.name).join(' ');
      return `${p.name} ${p.description ?? ''} ${boardNames}`.toLocaleLowerCase().includes(q);
    });
  }, [projects, tab, query, boardsByProject]);

  const activeProjects = projects.filter((p) => !p.isArchived);
  const summaryBoards = activeProjects.reduce((n, p) => n + (boardsByProject.get(p.id) ?? []).filter((b) => !b.isArchived).length, 0);
  const summaryCards = activeProjects.reduce((n, p) => n + projectStats(boardsByProject.get(p.id) ?? [], statsByBoard).total, 0);

  const signedIn = state.status === 'ready';
  const renderProject = (project: SessionProjectSummary) => {
    const boards = (boardsByProject.get(project.id) ?? []).filter((b) => !b.isArchived);
    const stats = projectStats(boards, statsByBoard);
    const href = `/project?id=${encodeURIComponent(project.id)}`;
    const archived = project.isArchived;
    const tone = projectTone(project.id);
    if (view === 'list') {
      return (
        <article key={project.id} className={`pm-row tone-${tone}${archived ? ' is-archived' : ''}`}>
          <ProjectMark project={project} />
          <div className="pm-row-copy"><h3><Link href={href}>{project.name}</Link></h3><p>{project.description || 'No description added.'}</p></div>
          <div className="pm-row-boards" aria-label={`Boards in ${project.name}`}>
            {boards.slice(0, 4).map((b) => <Link key={b.id} className={`pm-chip tone-${projectTone(b.id)}`} href={`/board?id=${encodeURIComponent(b.id)}`}><i aria-hidden="true" />{b.name}</Link>)}
            {boards.length === 0 && <span className="pm-chip is-empty">No boards</span>}
            {boards.length > 4 && <span className="pm-chip is-empty">+{boards.length - 4}</span>}
          </div>
          <div className="pm-row-stats"><span><strong>{stats.total}</strong> cards</span><span><strong>{stats.open}</strong> open</span></div>
          <span className={`ph-status ${archived ? 'is-archived' : 'is-active'}`}><i aria-hidden="true" />{archived ? 'Archived' : 'Active'}</span>
          <RoleChip project={project} />
          <Link className="pm-row-open" href={href} aria-label={`Open ${project.name}`}><Icon name="arrow-right" /></Link>
        </article>
      );
    }
    const shown = boards.slice(0, 4);
    const rest = boards.length - shown.length;
    return (
      <article key={project.id} className={`pm-project tone-${tone}${archived ? ' is-archived' : ''}`}>
        <div className="pm-root">
          <div className="pm-root-head">
            <ProjectMark project={project} />
            <div className="pm-root-copy"><h3><Link href={href}>{project.name}</Link></h3><p>{project.description || 'No description added.'}</p></div>
          </div>
          <div className="pm-root-stats" aria-label="Project totals">
            <div><strong>{stats.total}</strong><span>cards</span></div>
            <div><strong>{stats.open}</strong><span>open</span></div>
          </div>
          <div className="pm-meter" role="img" aria-label={`${stats.done} of ${stats.total} cards completed`}><span style={{ width: `${stats.percent}%` }} /></div>
          <p className="pm-meter-label">{stats.done} of {stats.total} cards completed · {stats.percent}%</p>
          <div className="pm-root-foot">
            <span className={`ph-status ${archived ? 'is-archived' : 'is-active'}`}><i aria-hidden="true" />{archived ? 'Archived' : 'Active'}</span>
            <RoleChip project={project} />
            <span className="pm-separator" aria-hidden="true" />
            <span className="pm-root-boards">{boards.length} {boards.length === 1 ? 'board' : 'boards'}</span>
            <span className="spacer" />
          </div>
        </div>
        <div className="pm-branches">
          <div className="pm-branches-head"><span className="pm-branches-title">Boards</span><span className="pm-branches-hint">{archived ? 'Read-only while archived' : 'Each board keeps its own workflow and access'}</span></div>
          {boards.length ? (
            <ul className="pm-branch-list" aria-label={`Boards in ${project.name}`}>
              {shown.map((board) => {
                const s = statsByBoard.get(board.id) ?? NO_STATS;
                const bhref = `/board?id=${encodeURIComponent(board.id)}`;
                return (
                  <li key={board.id} className={`pm-branch tone-${projectTone(board.id)}`}>
                    <span className="pm-node" aria-hidden="true" />
                    <div className="pm-branch-copy">
                      <Link className="pm-branch-name" href={bhref}>{board.name}</Link>
                      <span className="pm-branch-description">No description added.</span>
                    </div>
                    <span className="pm-branch-count">{s.total} {s.total === 1 ? 'card' : 'cards'}<i aria-hidden="true">·</i>{s.open} open</span>
                    <span className="pm-branch-bar" role="img" aria-label={`${s.done} of ${s.total} cards completed`}><i style={{ width: `${s.percent}%` }} /></span>
                    {project.role === 'owner' || project.role === 'manager'
                      ? <span className="pm-branch-access"><Icon name="users" /><span>Full access</span></span>
                      : <span className="pm-branch-access is-grant"><Icon name="lock" /><span>Granted</span></span>}
                    <Link className="pm-branch-open" href={bhref} aria-label={`Open ${board.name} board`}><Icon name="arrow-right" /></Link>
                  </li>
                );
              })}
              {rest > 0 && <li className="pm-branch-more"><span aria-hidden="true">+</span>{rest} more {rest === 1 ? 'board' : 'boards'}</li>}
            </ul>
          ) : (
            <div className="pm-branches-empty"><span className="pm-branches-empty-icon" aria-hidden="true"><Icon name="board" /></span><div><strong>No boards available</strong><p>Open the project to add the first board, or ask an owner for board access.</p></div></div>
          )}
          <div className="pm-branches-foot"><Link className="pm-link is-strong" href={href}>Open project<span aria-hidden="true">→</span></Link></div>
        </div>
      </article>
    );
  };

  const { yours, shared } = splitProjects(visible);
  const nothingAtAll = visible.length === 0 && (tab === 'archived' || query !== '' || projects.length === 0);
  const emptyTitle = query ? 'No matching projects' : tab === 'archived' ? 'No archived projects' : 'Start with your first project';
  const emptyMessage = query ? 'Try another project or board name, or clear your search.' : tab === 'archived' ? 'Archived projects you can access will appear here.' : 'Projects group related boards. Create your own, and projects other people add you to will appear under Shared with you.';

  return (
    <>
      <div className="page-head portfolio-head">
        <div className="page-head-copy">
          <p className="portfolio-eyebrow">Portfolio</p>
          <h1>Projects</h1>
          <p className="page-sub">{signedIn ? `${projects.length} accessible ${projects.length === 1 ? 'project' : 'projects'} · ${state.session.actor.displayName}` : 'Projects group related boards. Your list follows your project access.'}</p>
        </div>
        <div className="page-actions">
          {signedIn && usage && <span className={`usage-hint${usage.atCap ? ' is-full' : ''}`} id="projectUsage">{usageText(usage)}</span>}
          {signedIn && <button className="btn primary" type="button" aria-describedby={usage ? 'projectUsage' : undefined} onClick={() => setCreating(true)}><Icon name="plus" />New project</button>}
        </div>
      </div>

      <section className="portfolio-summary" aria-label="Portfolio summary">
        <div className="pf-summary-card"><span className="pf-summary-icon tone-thistle" aria-hidden="true"><Icon name="folder" /></span><div className="pf-summary-copy"><strong>{activeCount}</strong><span>active projects</span></div></div>
        <div className="pf-summary-card"><span className="pf-summary-icon tone-icy" aria-hidden="true"><Icon name="board" /></span><div className="pf-summary-copy"><strong>{summaryBoards}</strong><span>boards</span></div></div>
        <div className="pf-summary-card"><span className="pf-summary-icon tone-petal" aria-hidden="true"><Icon name="list" /></span><div className="pf-summary-copy"><strong>{summaryCards}</strong><span>cards</span></div></div>
        <p className="pf-summary-note">Counts cover only accessible boards in active projects.</p>
      </section>

      <section className="portfolio-controls" aria-label="Project browsing controls">
        <div className="portfolio-search">
          <label className="sr-only" htmlFor="projectSearch">Search accessible projects and boards</label>
          <span aria-hidden="true" className="portfolio-search-icon"><Icon name="search" /></span>
          <input id="projectSearch" type="search" autoComplete="off" placeholder="Search projects or boards" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button className="portfolio-clear" type="button" hidden={!query} onClick={() => setQuery('')}>Clear</button>
        </div>
        <div className="portfolio-control-end">
          <div className="portfolio-tabs" role="tablist" aria-label="Project status">
            <button className="portfolio-tab" type="button" role="tab" id="activeProjectsTab" aria-controls="projectList" aria-selected={tab === 'active'} tabIndex={tab === 'active' ? 0 : -1} onClick={() => setParam('tab', null)}>Active <span>{activeCount}</span></button>
            <button className="portfolio-tab" type="button" role="tab" id="archivedProjectsTab" aria-controls="projectList" aria-selected={tab === 'archived'} tabIndex={tab === 'archived' ? 0 : -1} onClick={() => setParam('tab', 'archived')}>Archived <span>{archivedCount}</span></button>
          </div>
          <div className="portfolio-view-toggle" role="group" aria-label="Project layout">
            <button type="button" aria-pressed={view === 'map'} onClick={() => setParam('view', null)}>Map</button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => setParam('view', 'list')}>List</button>
          </div>
        </div>
      </section>

      <div className="portfolio-results-row">
        <h2>{tab === 'archived' ? 'Archived projects' : 'Active projects'}</h2>
        <p aria-live="polite">{loading ? 'Loading projects…' : `${visible.length} ${visible.length === 1 ? 'project' : 'projects'}${query ? ' found' : ''}`}</p>
      </div>

      <section id="projectList" role="tabpanel" aria-labelledby={`${tab}ProjectsTab`} tabIndex={0}>
        {nothingAtAll && !loading ? (
          <div className="ph-empty">
            <span className="ph-empty-mark" aria-hidden="true"><Icon name={tab === 'archived' ? 'archive' : 'folder'} /></span>
            <h3>{emptyTitle}</h3>
            <p>{emptyMessage}</p>
            {query && <button className="btn" type="button" onClick={() => setQuery('')}>Clear search</button>}
            {!query && tab === 'active' && signedIn && <button className="btn primary" type="button" onClick={() => setCreating(true)}><Icon name="plus" />Create your first project</button>}
          </div>
        ) : (
          <>
            <ProjectGroup id="yours" title="Yours" count={yours.length} view={view}>
              {yours.length ? yours.map(renderProject) : !loading && (
                <div className="ph-empty is-compact">
                  <h3>{query ? 'No matches in your projects' : tab === 'archived' ? 'No archived projects of yours' : 'You do not own a project yet'}</h3>
                  <p>{query ? 'Try another name.' : tab === 'archived' ? 'Projects you archive wait here until you reopen them.' : 'Create one of your own to organise your own boards. Projects you are invited to stay under Shared with you.'}</p>
                  {!query && tab === 'active' && signedIn && <button className="btn primary" type="button" onClick={() => setCreating(true)}><Icon name="plus" />New project</button>}
                </div>
              )}
            </ProjectGroup>
            <ProjectGroup id="shared" title="Shared with you" count={shared.length} view={view}>
              {shared.length ? shared.map(renderProject) : !loading && (
                <div className="ph-empty is-compact">
                  <h3>{query ? 'No matches in shared projects' : 'Nothing shared with you yet'}</h3>
                  <p>{query ? 'Try another name.' : 'When someone adds you to their project, it appears here with your role.'}</p>
                </div>
              )}
            </ProjectGroup>
          </>
        )}
      </section>

      <footer className="portfolio-footer">
        <span className="portfolio-footer-line" aria-hidden="true" />
        <p>Boards stay inside their project. Project access does not reveal sibling projects or automatically grant access to every board.</p>
      </footer>

      <NewProjectDialog open={creating} onClose={() => setCreating(false)} usage={usage} />
    </>
  );
}

export default function ProjectsPage() {
  return <Suspense fallback={<div role="status" className="state-note">Loading projects…</div>}><ProjectsScreen /></Suspense>;
}
