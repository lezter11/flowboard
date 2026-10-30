'use client';

import { Suspense, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { can, normalizeRole, ROLE_META } from '@/lib/roles';
import { useProjectBoards } from '@/lib/portfolio';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';
import { Avatar } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/toasts';
import { useShell } from '@/components/shell/shell-context';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { ColumnsDialog } from '@/components/board/columns-dialog';

type Tab = 'project' | 'board' | 'account' | 'appearance';
const TABS: Array<[Tab, string]> = [['project', 'Project'], ['board', 'Board and columns'], ['account', 'Account'], ['appearance', 'Appearance']];

function SettingsScreen() {
  const params = useSearchParams();
  const { state, refetch, signOut } = useSession();
  const shell = useShell();
  const toast = useToast();
  const queryClient = useQueryClient();
  const initial = params.get('tab');
  const [tab, setTab] = useState<Tab>(TABS.some(([id]) => id === initial) ? (initial as Tab) : 'project');
  const projects = useMemo(() => (state.status === 'ready' ? state.session.accessibleProjects : []), [state]);
  const project = projects.find((p) => p.id === params.get('project')) ?? projects[0];
  const role = normalizeRole(project?.role);
  const editable = can(role, 'manageBoard') && !project?.isArchived;
  const actor = state.status === 'ready' ? state.session.actor : null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setName(project?.name ?? ''); setDescription(project?.description ?? ''); }, [project?.id, project?.name, project?.description]);
  const isOwner = role === 'owner';
  const [defaultBoard, setDefaultBoard] = useState('');
  useEffect(() => { setDefaultBoard(project?.defaultBoardId ?? ''); }, [project?.id, project?.defaultBoardId]);
  const defaultChanged = isOwner && !!project && defaultBoard !== (project.defaultBoardId ?? '');
  const dirty = !!project && (name !== project.name || description !== (project.description ?? '') || defaultChanged);

  const boards = useProjectBoards(project?.id ?? null);
  const board = boards.data?.find((b) => b.id === params.get('board')) ?? boards.data?.[0];
  const [boardName, setBoardName] = useState('');
  const [boardDescription, setBoardDescription] = useState('');
  useEffect(() => { setBoardName(board?.name ?? ''); setBoardDescription(board?.description ?? ''); }, [board?.id, board?.name, board?.description]);
  const boardDirty = !!board && (boardName.trim() !== board.name || boardDescription.trim() !== (board.description ?? ''));
  const boardEditable = isOwner && !project?.isArchived;

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState('');
  const [columnsOpen, setColumnsOpen] = useState(false);
  // The columns dialog reads the board from the query cache, so make sure it is there.
  useQuery({ queryKey: ['board', board?.id], queryFn: async () => (await api.getBoardSnapshot(board!.id, { cardLimitPerColumn: 1 })).data, enabled: !!board && tab === 'board' });
  const changeLifecycle = async () => {
    if (!project) return;
    setLifecycleBusy(true); setLifecycleError('');
    try {
      if (project.isArchived) await api.reopenProject(project.id, project.version); else await api.archiveProject(project.id, project.version);
      toast(project.isArchived ? 'Project reopened' : 'Project archived. Its boards are now read-only.', { icon: 'check' });
      setArchiveOpen(false);
      await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ['project', project.id] }), queryClient.invalidateQueries({ queryKey: ['boards', project.id] })]);
    } catch (err) { setLifecycleError(describeError(err)); refetch(); } finally { setLifecycleBusy(false); }
  };

  const saveProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!project || !dirty) return;
    if (!name.trim()) { setError('Enter a project name.'); return; }
    setBusy(true); setError('');
    try {
      await api.updateProject(project.id, {
        name: name.trim(), description: description.trim() || null, expectedVersion: project.version,
        // Owner only: Managers leave the landing board to the Owner (the API refuses it with 403).
        ...(defaultChanged ? { defaultBoardId: defaultBoard || null } : {}),
      });
      toast('Project saved', { icon: 'check' });
      refetch();
    } catch (err) { setError(describeError(err)); refetch(); } finally { setBusy(false); }
  };
  const saveBoard = async (event: FormEvent) => {
    event.preventDefault();
    if (!board || !boardDirty || !boardEditable) return;
    if (!boardName.trim()) { setError('Enter a board name.'); return; }
    setBusy(true); setError('');
    try {
      await api.updateBoard(board.id, {
        ...(boardName.trim() !== board.name ? { name: boardName.trim() } : {}),
        ...(boardDescription.trim() !== (board.description ?? '') ? { description: boardDescription.trim() || null } : {}),
        expectedVersion: board.snapshotVersion,
      });
      toast('Board saved', { icon: 'check' });
      await queryClient.invalidateQueries({ queryKey: ['boards', project?.id] });
    } catch (err) { setError(describeError(err)); await queryClient.invalidateQueries({ queryKey: ['boards', project?.id] }); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head">
        <div className="page-head-copy">
          <h1>Settings</h1>
          <p className="page-sub"><span>Project, board, account and appearance</span></p>
        </div>
        <div className="page-actions">
          {project && <Link className="btn" href={`/project?id=${encodeURIComponent(project.id)}`}><Icon name="folder" />Project overview</Link>}
          {board && <Link className="btn ghost" href={`/board?id=${encodeURIComponent(board.id)}`}><Icon name="board" />Open board</Link>}
        </div>
      </div>

      <div className="review-bar">
        <Icon name="lock" />
        <span><strong>{editable ? 'Owners and managers can edit.' : 'Read-only for your role.'}</strong> Theme is saved in this browser.</span>
        <span className="spacer" />
        {project && <span className="badge">{ROLE_META[role].label}</span>}
      </div>

      <div className="tabs settings-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map(([id, label]) => (
          <button key={id} className="tab" type="button" role="tab" id={`tab-${id}`} aria-controls={`panel-${id}`} aria-selected={tab === id} onClick={() => { setTab(id); setError(''); }}>{label}</button>
        ))}
      </div>

      <div className="split-layout">
        <div className="settings-panel stack">
          {tab === 'project' && (
            <section className="panel" id="panel-project" role="tabpanel" aria-labelledby="tab-project">
              <div className="panel-head">
                <div className="panel-head-copy"><h2 className="panel-title">Project settings</h2><p className="panel-sub">{project ? `Name and description for ${project.name}.` : 'No project available.'}</p></div>
                <div className="panel-actions"><span className="badge">{project?.isArchived ? 'Archived' : 'Active'}</span></div>
              </div>
              <div className="panel-body">
                <form className="settings-form" onSubmit={saveProject}>
                  <div className="form-grid">
                    <div className="field span-2"><label className="field-label" htmlFor="projectName">Project name</label><input className="control" id="projectName" type="text" maxLength={100} value={name} disabled={!editable} onChange={(event) => setName(event.target.value)} /><p className="field-help">Shown in project lists and navigation.</p></div>
                    <div className="field span-2"><label className="field-label" htmlFor="projectDescription">Description</label><textarea className="control textarea" id="projectDescription" maxLength={2000} value={description} disabled={!editable} onChange={(event) => setDescription(event.target.value)} /><p className="field-help">Plain text, up to 2000 characters.</p></div>
                    <div className="field span-2">
                      <label className="field-label" htmlFor="defaultBoard">Default board</label>
                      <select className="control" id="defaultBoard" value={defaultBoard} disabled={!isOwner || !!project?.isArchived || boards.isPending} onChange={(event) => setDefaultBoard(event.target.value)}>
                        <option value="">None (open the board I used last)</option>
                        {(boards.data ?? []).filter((b) => !b.isArchived).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                      <p className="field-help">{isOwner ? 'Where the Board button and sign-in take people first. Only boards a person can open are used for them.' : 'Only the project Owner can choose the default board.'}</p>
                    </div>
                  </div>
                  {error && <div className="note warn" role="alert"><Icon name="alert" /><span>{error}</span></div>}
                  <div className="note"><Icon name="shield" /><span>{editable ? 'Owners and managers can rename the project.' : 'Only owners and managers can change project settings.'}</span></div>
                  <div className="form-actions">
                    <span className="dirty-note"><span className="dot" />{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span>
                    <span className="spacer" />
                    <button className="btn primary" type="submit" disabled={!editable || !dirty || busy}>{busy ? 'Saving…' : 'Save project'}</button>
                  </div>
                </form>
                <div className="divider" />
                <div className="stack-sm">
                  <h3 className="settings-section-title">Project status</h3>
                  <p className="settings-section-sub">Archived projects are read-only. Only the Owner can reopen them.</p>
                  {project?.isArchived && <div className="note" role="status"><Icon name="archive" /><span><strong>This project is archived.</strong> Cards, boards and people cannot be changed until the Owner reopens it. Due dates keep counting.</span></div>}
                  <div className="row">
                    <button className="btn" type="button" disabled={!isOwner || !project || lifecycleBusy} onClick={() => { setLifecycleError(''); setArchiveOpen(true); }} title={isOwner ? undefined : 'Only the project Owner can archive or reopen a project'}><Icon name="archive" />{project?.isArchived ? 'Reopen project' : 'Archive project'}</button>
                    {!isOwner && <span className="field-help">Only the project Owner can archive or reopen a project.</span>}
                  </div>
                </div>
              </div>
            </section>
          )}

          {tab === 'board' && (
            <section className="panel" id="panel-board" role="tabpanel" aria-labelledby="tab-board">
              <div className="panel-head">
                <div className="panel-head-copy"><h2 className="panel-title">Board and columns</h2><p className="panel-sub">{board ? `Board name for ${board.name}.` : 'No board available.'}</p></div>
                <div className="panel-actions"><span className="badge">{board?.isArchived ? 'Archived' : 'Active'}</span></div>
              </div>
              <div className="panel-body">
                <form className="settings-form" onSubmit={saveBoard}>
                  <div className="form-grid">
                    <div className="field span-2"><label className="field-label" htmlFor="boardName">Board name</label><input className="control" id="boardName" type="text" maxLength={100} value={boardName} disabled={!boardEditable || !board} onChange={(event) => setBoardName(event.target.value)} /><p className="field-help">{boardEditable ? 'Only the project Owner can rename a board.' : 'Only the project Owner can change a board name or description.'}</p></div>
                    <div className="field span-2"><label className="field-label" htmlFor="boardDescription">Description</label><textarea className="control textarea" id="boardDescription" maxLength={2000} value={boardDescription} disabled={!boardEditable || !board} onChange={(event) => setBoardDescription(event.target.value)} /><p className="field-help">Shown under the board title. Plain text, up to 2000 characters.</p></div>
                  </div>
                  <div className="stack-sm">
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <div><h3 className="settings-section-title">Columns</h3><p className="settings-section-sub">Arrange and name the stages of this board.</p></div>
                      <button className="btn sm" type="button" disabled={!board || !editable} onClick={() => setColumnsOpen(true)} title={editable ? undefined : 'Only owners and managers can edit columns'}><Icon name="columns" />Edit columns</button>
                    </div>
                    <p className="field-help">{editable ? 'Add, rename, recolour, reorder and delete columns in the column editor.' : 'Only owners and managers can edit columns.'}</p>
                  </div>
                  {error && <div className="note warn" role="alert"><Icon name="alert" /><span>{error}</span></div>}
                  <div className="form-actions">
                    <span className="spacer" />
                    <button className="btn primary" type="submit" disabled={!boardEditable || !board || !boardDirty || busy}>{busy ? 'Saving…' : 'Save board'}</button>
                  </div>
                </form>
              </div>
            </section>
          )}

          {tab === 'account' && (
            <section className="panel" id="panel-account" role="tabpanel" aria-labelledby="tab-account">
              <div className="panel-head">
                <div className="panel-head-copy"><h2 className="panel-title">Account</h2><p className="panel-sub">Profile, current project role and project access.</p></div>
                <div className="panel-actions"><span className="badge">{ROLE_META[role].label}</span></div>
              </div>
              <div className="panel-body stack">
                {actor && (
                  <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                    <Avatar id={actor.id} name={actor.displayName} className="xl" />
                    <div className="stack-xs" style={{ flex: 1, minWidth: 0 }}>
                      <h3 className="settings-section-title">{actor.displayName}</h3>
                      <p className="settings-section-sub">{actor.email}</p>
                    </div>
                  </div>
                )}
                <div className="form-grid">
                  <div className="field"><label className="field-label" htmlFor="accountDisplayName">Display name</label><input className="control" id="accountDisplayName" type="text" value={actor?.displayName ?? ''} disabled readOnly /><p className="field-help">Profile editing is not available yet.</p></div>
                  <div className="field"><label className="field-label" htmlFor="accountEmailField">Email</label><input className="control" id="accountEmailField" type="email" value={actor?.email ?? ''} disabled readOnly /><p className="field-help">Your email comes from your Google account.</p></div>
                </div>
                <div className="divider" />
                <div className="stack-sm">
                  <h3 className="settings-section-title">Project access</h3>
                  <p className="settings-section-sub">Project-only access. Holding a workspace account does not reveal a sibling project.</p>
                  <ul className="pm-branch-list" aria-label="Projects you can open">
                    {projects.map((p) => <li key={p.id} className="pm-branch" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}><span className="pm-branch-name">{p.name}</span><span className="badge">{ROLE_META[normalizeRole(p.role)].label}</span></li>)}
                  </ul>
                </div>
                <div className="form-actions"><span className="spacer" /><button className="btn" type="button" onClick={() => void signOut()}>Sign out</button></div>
              </div>
            </section>
          )}

          {tab === 'appearance' && (
            <section className="panel" id="panel-appearance" role="tabpanel" aria-labelledby="tab-appearance">
              <div className="panel-head">
                <div className="panel-head-copy"><h2 className="panel-title">Appearance</h2><p className="panel-sub">Choose the appearance that feels right for you.</p></div>
                <div className="panel-actions"><span className="badge">{shell.theme === 'dark' ? 'Dark' : 'Light'}</span></div>
              </div>
              <div className="panel-body stack">
                <div className="theme-grid" role="group" aria-label="Theme">
                  {(['light', 'dark'] as const).map((choice) => (
                    <button key={choice} className="theme-card" type="button" aria-pressed={shell.theme === choice} onClick={() => { if (shell.theme !== choice) shell.toggleTheme(); }}>
                      <span className={`theme-preview ${choice}`} aria-hidden="true"><span className="theme-preview-bar" /><span className="theme-preview-body"><span className="theme-preview-col" /><span className="theme-preview-col" /><span className="theme-preview-col" /></span></span>
                      <strong>{choice === 'light' ? 'Light' : 'Dark'}</strong>
                      <span>{choice === 'light' ? 'A bright, calm workspace.' : 'Softer surfaces for low-light work.'}</span>
                    </button>
                  ))}
                </div>
                <div className="note"><Icon name="palette" /><span>Your choice is saved in this browser.</span></div>
              </div>
            </section>
          )}
        </div>
      </div>
      {board && editable && <ColumnsDialog boardId={board.id} open={columnsOpen} onClose={() => setColumnsOpen(false)} />}
      <DialogLayer open={archiveOpen} onClose={() => { if (!lifecycleBusy) setArchiveOpen(false); }} labelledBy="archiveTitle" describedBy="archiveCopy" role="alertdialog">
        <div className="dialog-head"><div className="dialog-head-copy"><h2 id="archiveTitle">{project?.isArchived ? 'Reopen this project?' : 'Archive this project?'}</h2></div></div>
        <div className="dialog-body">
          <p id="archiveCopy" className="confirm-copy">{project?.isArchived ? `Reopening ${project?.name} lets people create, edit, move and comment on cards again.` : `${project?.name} becomes read-only. Everyone can still read its boards, cards, comments and images, but nobody can add or change anything, invite people or change settings until you reopen it. Due dates keep counting. Nothing is deleted.`}</p>
          {lifecycleError && <p className="form-error" role="alert">{lifecycleError}</p>}
        </div>
        <footer className="dialog-foot"><span className="spacer" /><button className="btn" type="button" data-autofocus onClick={() => setArchiveOpen(false)} disabled={lifecycleBusy}>Cancel</button><button className={`btn ${project?.isArchived ? 'primary' : 'danger'}`} type="button" onClick={() => void changeLifecycle()} disabled={lifecycleBusy}>{lifecycleBusy ? 'Working…' : project?.isArchived ? 'Reopen project' : 'Archive project'}</button></footer>
      </DialogLayer>
    </>
  );
}

export default function SettingsPage() {
  return <Suspense fallback={<div role="status" className="state-note">Loading settings…</div>}><SettingsScreen /></Suspense>;
}
