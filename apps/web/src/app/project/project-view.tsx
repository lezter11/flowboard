'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { projectMark, projectTone, statsFromSnapshot, useProjectBoards, type BoardStats } from '@/lib/portfolio';
import { can, normalizeRole } from '@/lib/roles';
import { useRememberLocation } from '@/lib/last-location';
import { useSession } from '@/lib/session';
import { projectAccess } from '@/lib/project-access';
import { usePollKeys } from '@/components/polling';
import { Icon } from '@/components/ui/icon';
import { ProjectOverviewSection } from '@/components/project/overview';
import { BriefCard } from '@/components/project/brief-card';
import type { Board } from '@flowboard/contracts';
import { BoardLifecycleDialog } from '@/components/board/board-lifecycle-dialog';
import { ErrorNote } from '@/components/ui/error-note';
import { NewBoardDialog } from '@/components/ui/new-board-dialog';

const NO_STATS: BoardStats = { total: 0, done: 0, open: 0, percent: 0 };

export function ProjectView({ projectId }: { projectId: string }) {
  const { state } = useSession();
  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await api.getProject(projectId)).data,
    retry: (count, error) => !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 1,
  });
  usePollKeys([['project', projectId]]);
  useRememberLocation(project.data?.id, null);
  const sessionProject = state.status === 'ready' ? state.session.accessibleProjects.find((p) => p.id === projectId) : undefined;
  const role = normalizeRole(sessionProject?.role);
  const [showArchived, setShowArchived] = useState(false);
  const [lifecycleBoard, setLifecycleBoard] = useState<Board | null>(null);
  const queryClient = useQueryClient();
  const includeArchived = showArchived && can(role, 'manageBoard');
  const boardsQuery = useProjectBoards(projectId, includeArchived);
  usePollKeys([includeArchived ? ['boards', projectId, 'include-archived'] : ['boards', projectId]]);
  const allBoards = boardsQuery.isError ? [] : boardsQuery.data ?? [];
  const boards = allBoards.filter((board) => includeArchived ? board.isArchived : !board.isArchived);
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
  const statsOf = (id: string) => stats.data?.get(id) ?? null;

  const [creating, setCreating] = useState(false);

  if (state.status === 'ready' && projectAccess(state.session.accessibleProjects, projectId).kind === 'removed') {
    return (
      <section role="alert" className="board-unavailable" style={{ display: 'block' }}>
        <h1>You no longer have access</h1>
        <p>You were removed from this project, or it is not available to your account.</p>
        <Link className="btn" href="/projects">Back to projects</Link>
      </section>
    );
  }
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
            <span className="project-tab-count">{statsOf(b.id)?.total ?? '—'}</span>
          </Link>
        ))}
      </nav>

      <section className="project-panel" aria-labelledby="overviewTitle">
        <h2 className="sr-only" id="overviewTitle" tabIndex={-1}>Project overview</h2>
        <div className="project-layout">
          <div className="project-main">
            <ProjectOverviewSection projectId={projectId} canManage={can(role, 'manageBoard')} isMember={role === 'member'} boardsExist={allBoards.some((board) => !board.isArchived)} part="summary" />
            <BriefCard project={p} canEdit={can(role, 'manageBoard') && !p.isArchived} />
            <section className="project-boards-section" aria-labelledby="boardsTitle">
              <div className="project-boards-heading">
                <div>
                  <h2 id="boardsTitle">{includeArchived ? 'Archived boards' : 'Boards'} <span>{boardsQuery.isSuccess ? boards.length : '—'}</span></h2>
                  <p>{boardsQuery.isError ? 'Boards could not be loaded.' : boardsQuery.isPending ? 'Loading boards…' : boards.length ? `${boards.length} ${boards.length === 1 ? 'board' : 'boards'} available · Each board keeps its own columns, cards and access.` : includeArchived ? 'No archived boards are available to you.' : 'This project has no active boards you can open.'}</p>
                </div>
                <div className="page-actions">
                  {can(role, 'manageBoard') && <div role="group" aria-label="Board status"><button className="btn" type="button" aria-pressed={!includeArchived} onClick={() => setShowArchived(false)}>Active boards</button><button className="btn" type="button" aria-pressed={includeArchived} onClick={() => setShowArchived(true)}>Archived boards</button></div>}
                  {canCreate && <button className="btn primary" type="button" onClick={() => setCreating(true)}>New board</button>}
                </div>
              </div>
              <div className="project-boards-panel" aria-live="polite">
                {boardsQuery.isError ? <ErrorNote error={boardsQuery.error} onRetry={() => void boardsQuery.refetch()} /> : boardsQuery.isPending ? <p role="status" className="hint">Loading boards…</p> : boards.length === 0 ? (
                  <div className="ph-board-empty">
                    <span className="ph-board-empty-icon" aria-hidden="true"><Icon name="board" /></span>
                    <div>
                      <h3>{includeArchived ? 'No archived boards available' : canCreate ? 'No active boards in this project' : 'No boards available'}</h3>
                      <p>{includeArchived ? 'Archived boards you are permitted to manage appear here for reopening.' : canCreate ? 'A project can exist before its first board. Create the first team board to start separating work and access.' : 'You have no board grants for this project, or the project has no boards. Boards without a grant stay hidden from this list.'}</p>
                      {canCreate && !includeArchived && <button className="btn primary" type="button" onClick={() => setCreating(true)}>Create first board</button>}
                    </div>
                  </div>
                ) : (
                  <ul className="ph-board-list" aria-label={`Boards in ${p.name}`}>
                    {boards.map((b) => {
                      const s = statsOf(b.id);
                      const href = `/board?id=${encodeURIComponent(b.id)}`;
                      return (
                        <li key={b.id} className={`ph-board-item tone-${projectTone(b.id)}${p.isArchived || b.isArchived ? ' is-readonly' : ''}`}>
                          <span className="ph-board-node" aria-hidden="true"><Icon name="board" /></span>
                          <div className="ph-board-copy">
                            <div className="ph-board-title">
                              <h3><Link href={href}>{b.name}</Link></h3>
                              <span className="ph-board-pill">{s?.total ?? '—'} {s?.total === 1 ? 'card' : 'cards'}</span>
                              <span className="ph-board-pill">{s?.open ?? '—'} open</span>
                            </div>
                            <p>{b.description || 'No description added.'}</p>
                            <div className="ph-board-progress">{s ? <><span className="ph-board-progress-bar" role="img" aria-label={`${s.done} of ${s.total} cards completed`}><i style={{ width: `${s.percent}%` }} /></span><span>{s.total ? `${s.percent}% complete` : 'No cards yet'}</span></> : <span>{stats.isPending ? 'Loading counts…' : 'Counts unavailable'}</span>}</div>
                          </div>
                          <div className="ph-board-side">
                            {b.isArchived && can(role, 'manageBoard') && <button className="btn sm" type="button" disabled={p.isArchived} onClick={() => setLifecycleBoard(b)}>Reopen board</button>}
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
            <ProjectOverviewSection projectId={projectId} canManage={can(role, 'manageBoard')} isMember={role === 'member'} boardsExist={allBoards.some((board) => !board.isArchived)} part="details" />
          </div>

          <p className="access-hint"><Icon name="lock" /><span>Project access is not board access: a non-owner also needs a grant for each board, and hidden boards never show in names, tabs, counts or work lists.</span></p>
        </div>
      </section>

      {lifecycleBoard && can(role, 'manageBoard') && <BoardLifecycleDialog key={lifecycleBoard.id} board={allBoards.find((board) => board.id === lifecycleBoard.id) ?? lifecycleBoard} open projectArchived={p.isArchived} onClose={() => setLifecycleBoard(null)} onChanged={() => { void queryClient.invalidateQueries({ queryKey: ['boards', projectId] }); void queryClient.invalidateQueries({ queryKey: ['board', lifecycleBoard.id] }); }} />}
      <NewBoardDialog readOnly={p.isArchived} projectId={projectId} role={role} open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}
