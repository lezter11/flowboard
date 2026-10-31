'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TrashRow } from '@flowboard/contracts';
import { api, ApiError } from '@/lib/api';
import { ErrorNote } from '@/components/ui/error-note';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { defaultRestoreColumn, restoreColumns, trashEmptyState, type ColumnOption } from '@/lib/restore-destination';
import { toastFailure } from '@/lib/toast-failure';
import { describeError } from '@/lib/errors';
import { can, normalizeRole } from '@/lib/roles';
import { useProjectBoards } from '@/lib/portfolio';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toasts';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const dateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function windowState(remaining: number): 'expired' | 'soon' | 'available' {
  return remaining <= 0 ? 'expired' : remaining <= 3_600_000 ? 'soon' : 'available';
}

function timeLeft(remaining: number): string {
  if (remaining <= 0) return 'Recovery window ended';
  const minutes = Math.max(1, Math.ceil(remaining / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m remaining` : `${minutes}m remaining`;
}

export default function TrashPage() {
  const { state } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const projects = useMemo(() => (state.status === 'ready' ? state.session.accessibleProjects : []).filter((p) => can(normalizeRole(p.role), 'manageBoard')), [state]);
  const [projectId, setProjectId] = useState('');
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const [q, setQ] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(id); }, []);

  const trash = useQuery({
    queryKey: ['trash', project?.id],
    queryFn: async () => { const res = await api.listProjectTrash(project!.id); return { rows: res.data, skew: new Date(res.serverNow).getTime() - Date.now() }; },
    enabled: !!project,
  });
  const boards = useProjectBoards(project?.id ?? null);
  const boardName = (id: string) => boards.data?.find((b) => b.id === id)?.name ?? 'Board';
  const skew = trash.data?.skew ?? 0;
  const rows = (trash.data?.rows ?? []).slice().sort((a, b) => new Date(a.restoreUntil).getTime() - new Date(b.restoreUntil).getTime());
  const remainingOf = (row: TrashRow) => new Date(row.restoreUntil).getTime() - (now + skew);
  const needle = q.trim().toLowerCase();
  const filtered = rows.filter((row) => !needle || `${row.title} ${boardName(row.boardId)} ${project?.name ?? ''}`.toLowerCase().includes(needle));
  const restorable = rows.filter((r) => remainingOf(r) > 0).length;
  const expiring = rows.filter((r) => windowState(remainingOf(r)) === 'soon').length;

  // A card whose column was deleted needs a destination: the picker opens, preselecting the first column.
  const [pick, setPick] = useState<{ row: TrashRow; columns: ColumnOption[]; columnId: string } | null>(null);
  const [pickFailure, setPickFailure] = useState<unknown>(null);
  const restore = useMutation({
    mutationFn: (arg: { row: TrashRow; toColumnId?: string }) => api.restoreCard(arg.row.id, { expectedVersion: arg.row.version, expectedBoardVersion: arg.row.structureVersion, ...(arg.toColumnId ? { toColumnId: arg.toColumnId } : {}) }),
    onSuccess: (_d, { row }) => { setPick(null); setPickFailure(null); toast(`“${row.title}” restored`, { icon: 'restore' }); void queryClient.invalidateQueries({ queryKey: ['trash'] }); void queryClient.invalidateQueries({ queryKey: ['board'] }); },
    onError: async (error, { row, toColumnId }) => {
      void queryClient.invalidateQueries({ queryKey: ['trash'] });
      if (error instanceof ApiError && (error.code === 'RESTORE_DESTINATION_REQUIRED' || (toColumnId && error.code === 'INVALID_DESTINATION'))) {
        let columns = restoreColumns(error.details, undefined);
        if (!columns.length) {
          try { columns = restoreColumns(undefined, (await api.getBoardSnapshot(row.boardId, { cardLimitPerColumn: 1 })).data.columns); } catch { /* the picker explains below */ }
        }
        setPickFailure(toColumnId ? error : null);
        setPick({ row, columns, columnId: defaultRestoreColumn(columns) });
        return;
      }
      toastFailure(toast, error, { item: row.title, role: normalizeRole(project?.role), boardName: boardName(row.boardId) });
    },
  });

  const empty = trashEmptyState({ ready: state.status === 'ready', projects: state.status === 'ready' ? state.session.accessibleProjects.length : 0, manageable: projects.length });
  if (empty === 'no-projects' || empty === 'not-allowed') {
    return (
      <div className="recovery-denied">
        <div className="ph-empty">
          <span className="ph-empty-mark" aria-hidden="true"><Icon name={empty === 'no-projects' ? 'folder' : 'lock'} /></span>
          <h3>{empty === 'no-projects' ? 'You have no projects yet' : 'Trash is for Owners and Managers'}</h3>
          <p>{empty === 'no-projects' ? 'Deleted cards from your projects will show up here.' : 'Ask an Owner or Manager if a card was deleted by mistake.'}</p>
          <Link className="btn" href="/projects">Browse projects</Link>
        </div>
      </div>
    );
  }

  return (
    <div id="trashContent">
      <header className="recovery-heading"><div><h1>Trash</h1></div><Link className="btn recovery-project-link" href="/projects"><Icon name="folder" />Browse projects</Link></header>
      <section className="recovery-overview" aria-label="Recovery overview">
        <span className="overview-mark"><Icon name="restore" /></span>
        <div className="overview-copy"><strong>{rows.length}</strong><span>deleted cards</span></div>
        <div className="overview-separator" aria-hidden="true" />
        <div className="overview-metric available"><Icon name="check-circle" /><span><strong>{restorable}</strong> within window</span></div>
        <div className={`overview-metric soon${expiring ? ' is-active' : ''}`}><Icon name="clock" /><span><strong>{expiring}</strong> expiring soon</span></div>
      </section>
      <section className="recovery-queue" aria-labelledby="trashTitle">
        <div className="recovery-queue-head"><div><h2 id="trashTitle">Deleted cards</h2><p>Recovery window: 24 hours</p></div><span className="recovery-count">{filtered.length} {filtered.length === 1 ? 'card' : 'cards'}</span></div>
        <div className="recovery-toolbar">
          <label className="recovery-search" htmlFor="trashSearch"><Icon name="search" /><span className="sr-only">Search deleted cards</span><input type="search" id="trashSearch" placeholder="Search deleted cards" autoComplete="off" value={q} onChange={(event) => setQ(event.target.value)} /></label>
          <label className="recovery-filter"><span className="sr-only">Project</span>
            <select id="trashProject" aria-label="Filter by project" value={project?.id ?? ''} onChange={(event) => { setProjectId(event.target.value); setQ(''); }}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select><Icon name="chevron-down" />
          </label>
          <button className="recovery-clear" type="button" hidden={!needle} onClick={() => setQ('')}>Clear filters</button>
        </div>
        <div className="recovery-results"><span aria-live="polite">{needle ? `${filtered.length} matching ${filtered.length === 1 ? 'card' : 'cards'}` : 'All deleted cards'}</span><span>Nearest deadline first</span></div>
        <div id="trashList">
          {trash.isPending && project && <div className="recovery-empty"><strong>Loading…</strong></div>}
          {trash.isError && <ErrorNote error={trash.error} ctx={{ role: normalizeRole(project?.role) }} onRetry={() => void trash.refetch()} />}
          {trash.isSuccess && filtered.length === 0 && (
            <div className="recovery-empty"><Icon name="trash" /><strong>{needle ? 'No matching cards' : 'Trash is empty'}</strong><span>{needle ? 'Try a different search.' : 'No deleted cards in this project.'}</span>{needle && <button type="button" onClick={() => setQ('')}>Clear filters</button>}</div>
          )}
          {filtered.map((row) => {
            const remaining = remainingOf(row);
            const key = windowState(remaining);
            const label = key === 'expired' ? 'Window ended' : key === 'soon' ? 'Expiring soon' : 'Within window';
            const pct = Math.max(0, Math.min(100, (remaining / WINDOW_MS) * 100));
            return (
              <article key={row.id} className="recovery-row" data-status={key}>
                <span className="item-mark" aria-hidden="true"><Icon name="trash" /></span>
                <div className="item-main">
                  <div className="item-title"><strong>{row.title}</strong>{row.key && <span className="item-key">{row.key}</span>}</div>
                  <div className="item-context"><span>{project?.name}</span><span aria-hidden="true">/</span><span>{boardName(row.boardId)}</span><span aria-hidden="true">·</span><span>Deleted by {row.actor?.displayName ?? 'Unknown'}</span></div>
                  <div className="item-deadline"><Icon name="calendar" /><span>Deleted {dateTime(row.deletedAt)}</span><span aria-hidden="true">·</span><span>Deadline {dateTime(row.restoreUntil)}</span></div>
                </div>
                <div className="item-window"><span className="window-status"><Icon name="clock" />{label}</span><strong>{timeLeft(remaining)}</strong><span className="window-track" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span></div>
                <button className="restore-preview" type="button" disabled={!row.canRestore || restore.isPending} title={row.blockedReason ? `Cannot restore: ${row.blockedReason.replace(/_/g, ' ')}` : undefined} onClick={() => restore.mutate({ row })}><Icon name="restore" /> Restore</button>
              </article>
            );
          })}
        </div>
      </section>
      <p className="recovery-foot"><Icon name="info" />Restored cards return to their original board. Times use the server clock.</p>
      <DialogLayer open={!!pick} onClose={() => { if (!restore.isPending) setPick(null); }} labelledBy="restoreTitle" describedBy="restoreCopy">
        {pick && (
          <>
            <div className="dialog-head"><div className="dialog-head-copy"><h2 id="restoreTitle">Pick a column to restore into</h2><p id="restoreCopy">“{pick.row.title}” was in a column that no longer exists. Choose where it should go.</p></div></div>
            <div className="dialog-body">
              {pick.columns.length > 0 ? (
                <div className="dialog-field">
                  <label htmlFor="restoreColumn">Column</label>
                  <select className="control" id="restoreColumn" data-autofocus value={pick.columnId} onChange={(event) => setPick({ ...pick, columnId: event.target.value })}>
                    {pick.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              ) : <ErrorNote text="This board has no columns to restore into. Add a column on the board, then try again." />}
              {pickFailure != null && <ErrorNote error={pickFailure} ctx={{ item: pick.row.title }} focusOnMount />}
            </div>
            <footer className="dialog-foot">
              <span className="spacer" />
              <button className="btn" type="button" onClick={() => setPick(null)} disabled={restore.isPending}>Cancel</button>
              <button className="btn primary" type="button" disabled={!pick.columnId || restore.isPending} onClick={() => restore.mutate({ row: pick.row, toColumnId: pick.columnId })}>{restore.isPending ? 'Restoring…' : 'Restore card'}</button>
            </footer>
          </>
        )}
      </DialogLayer>
    </div>
  );
}
