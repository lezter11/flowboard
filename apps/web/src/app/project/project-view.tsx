'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { projectMark, projectTone, statsFromSnapshot, useProjectBoards, type BoardStats } from '@/lib/portfolio';
import { can, normalizeRole } from '@/lib/roles';
import { useRememberLocation } from '@/lib/last-location';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';
import { NewBoardDialog } from '@/components/ui/new-board-dialog';

const NO_STATS: BoardStats = { total: 0, done: 0, open: 0, percent: 0 };

export function ProjectView({ projectId }: { projectId: string }) {
  const { state } = useSession();
  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await api.getProject(projectId)).data,
    retry: (count, error) => !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 1,
  });
  useRememberLocation(project.data?.id, null);
  const boardsQuery = useProjectBoards(projectId);
  const boards = (boardsQuery.data ?? []).filter((b) => !b.isArchived);
  const sessionProject = state.status === 'ready' ? state.session.accessibleProjects.find((p) => p.id === projectId) : undefined;
  const role = normalizeRole(sessionProject?.role);
  const canCreate = can(role, 'manageBoard') && !project.data?.isArchived;

  const stats = useQuery({
    queryKey: ['project-board-stats', projectId, boards.map((b) => b.id).join(',')],
    enabled: boards.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const entries = await Promise.all(boards.slice(0, 24).map(async (b) => [b.id, statsFromSnapshot((await api.getBoardSnapshot(b.id, { cardLimitPerColumn: 1 })).data)] as const));
      return new Map(entries);
    },
  });
  const statsOf = (id: string) => stats.data?.get(id) ?? NO_STATS;
  const totals = boards.reduce((acc, b) => {
    const s = statsOf(b.id);
    return { total: acc.total + s.total, done: acc.done + s.done, open: acc.open + s.open };
  }, { total: 0, done: 0, open: 0 });
  const percent = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;

  const [creating, setCreating] = useState(false);

  if (project.isPending) return <div role="status" className="state-note">Loading project…</div>;
  if (project.isError || !project.data) {
    const status = project.error instanceof ApiError ? project.error.status : 0;
    return (
      <section role="alert" className="board-unavailable" style={{ display: 'block' }}>
        <h1>{status === 401 ? 'You are signed out' : 'Project unavailable'}</h1>
        <p>{status === 401 ? 'Sign in to open this project.' : status === 403 || status === 404 ? 'This project is not available to your current account.' : describeError(project.error)}</p>
        <Link className="btn" href={status === 401 ? '/signin' : '/projects'}>{status === 401 ? 'Sign in' : 'Back to projects'}</Link>
      </section>
    );
  }
  const p = project.data;
  const tone = projectTone(p.id);

  return (
    <section id="projectContent" aria-labelledby="projectTitle">
      <div className="project-overview-heading">
        <div className="project-overview-identity">
          <div className={`project-root-node tone-${tone}`} role="img" aria-label="Project"><span aria-hidden="true">{projectMark(p.name)}</span></div>
          <div className="project-overview-copy">
            <p className="project-path"><Link href="/projects">Projects</Link><span aria-hidden="true">/</span><span>{p.name}</span></p>
            <h1 id="projectTitle">{p.name}</h1>
            <p className="project-overview-description">{p.description || 'No description added.'}</p>
          </div>
        </div>
      </div>

      {p.isArchived && (
        <div className="project-state-banner">
          <div className="project-archive-banner"><span className="archive-symbol" aria-hidden="true"><Icon name="archive" /></span><p><strong>This project is archived.</strong> Its boards are read-only.</p></div>
        </div>
      )}

      <nav className="project-switcher" aria-label="Project views">
        <span className="project-tab is-active" aria-current="page"><Icon name="folder" /><span className="project-tab-label">Overview</span></span>
        {boards.map((b) => (
          <Link key={b.id} className={`project-tab tone-${projectTone(b.id)}`} href={`/board?id=${encodeURIComponent(b.id)}`}>
            <i className="project-tab-dot" aria-hidden="true" />
            <span className="project-tab-label">{b.name}</span>
            <span className="project-tab-count">{statsOf(b.id).total}</span>
          </Link>
        ))}
      </nav>

      <section className="project-panel" aria-labelledby="overviewTitle">
        <h2 className="sr-only" id="overviewTitle" tabIndex={-1}>Project overview</h2>
        <div className="project-layout">
          <div className="project-main">
            <section className="project-boards-section" aria-labelledby="boardsTitle">
              <div className="project-boards-heading">
                <div>
                  <h2 id="boardsTitle">Boards <span>{boards.length}</span></h2>
                  <p>{boards.length ? `${boards.length} ${boards.length === 1 ? 'board' : 'boards'} available · Each board keeps its own columns, cards and access.` : 'This project has no boards you can open.'}</p>
                </div>
                <div className="page-actions">
                  {canCreate && <button className="btn primary" type="button" onClick={() => setCreating(true)}>New board</button>}
                </div>
              </div>
              <div className="project-boards-panel" aria-live="polite">
                {boards.length === 0 ? (
                  <div className="ph-board-empty">
                    <span className="ph-board-empty-icon" aria-hidden="true"><Icon name="board" /></span>
                    <div>
                      <h3>{canCreate ? 'No boards in this project' : 'No boards available'}</h3>
                      <p>{canCreate ? 'A project can exist before its first board. Create the first team board to start separating work and access.' : 'You have no board grants for this project, or the project has no boards. Boards without a grant stay hidden from this list.'}</p>
                      {canCreate && <button className="btn primary" type="button" onClick={() => setCreating(true)}>Create first board</button>}
                    </div>
                  </div>
                ) : (
                  <ul className="ph-board-list" aria-label={`Boards in ${p.name}`}>
                    {boards.map((b) => {
                      const s = statsOf(b.id);
                      const href = `/board?id=${encodeURIComponent(b.id)}`;
                      return (
                        <li key={b.id} className={`ph-board-item tone-${projectTone(b.id)}${p.isArchived ? ' is-readonly' : ''}`}>
                          <span className="ph-board-node" aria-hidden="true"><Icon name="board" /></span>
                          <div className="ph-board-copy">
                            <div className="ph-board-title">
                              <h3><Link href={href}>{b.name}</Link></h3>
                              <span className="ph-board-pill">{s.total} {s.total === 1 ? 'card' : 'cards'}</span>
                              <span className="ph-board-pill">{s.open} open</span>
                            </div>
                            <p>{b.description || 'No description added.'}</p>
                            <div className="ph-board-progress">
                              <span className="ph-board-progress-bar" role="img" aria-label={`${s.done} of ${s.total} cards completed`}><i style={{ width: `${s.percent}%` }} /></span>
                              <span>{s.total ? `${s.percent}% complete` : 'No cards yet'}</span>
                            </div>
                          </div>
                          <div className="ph-board-side">
                            <Link className="ph-board-open" href={href} aria-label={`Open ${b.name} board`}><Icon name="arrow-right" /></Link>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="project-boards-foot">
                <span>{p.isArchived ? 'Archived projects are read-only until the Owner reopens them.' : can(role, 'manageBoard') ? 'Owner access covers every board. Everyone else needs a grant per board.' : 'Only boards you can open appear here. Project membership alone does not reveal a board.'}</span>
              </div>
            </section>
          </div>

          <aside className="project-aside" aria-label="Project summary">
            <section className="aside-card" aria-labelledby="glanceTitle">
              <div className="aside-head"><div><h2 id="glanceTitle">At a glance</h2><p>{boards.length ? 'Across the boards you can open' : 'No boards in scope yet'}</p></div></div>
              <div className="glance-body">
                <div className="donut" role="img" aria-label={`${percent}% of cards completed`} style={{ ['--pct' as string]: String(percent) }}>
                  <div className="donut-copy"><strong>{percent}%</strong><span>complete</span></div>
                </div>
                <div className="glance-legend">
                  <span className="glance-row"><i className="tone-open" aria-hidden="true" />Open<strong>{totals.open}</strong></span>
                  <span className="glance-row"><i className="tone-done" aria-hidden="true" />Completed<strong>{totals.done}</strong></span>
                  <span className="glance-row"><i aria-hidden="true" />Total cards<strong>{totals.total}</strong></span>
                </div>
              </div>
              <div className="glance-foot"><span>{boards.length} {boards.length === 1 ? 'board' : 'boards'}</span><span>{p.isArchived ? 'Archived · read-only' : 'Live counts'}</span></div>
            </section>
            <section className="aside-card" aria-label="Access rule">
              <p className="access-note">
                <Icon name="lock" />
                <span><strong>Project access is not board access.</strong> A non-owner needs the project grant and a grant for each board. Hidden boards never appear in names, tabs, counts or work lists.</span>
              </p>
            </section>
          </aside>
        </div>
      </section>

      <NewBoardDialog projectId={projectId} open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}
