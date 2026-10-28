'use client';

import { useMemo, useState } from 'react';
import { useProjectBoards } from '@/lib/portfolio';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { can, normalizeRole, ROLE_META } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';
import { Avatar } from '@/components/ui/avatar';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { useToast } from '@/components/ui/toasts';

export default function PeoplePage() {
  const { state } = useSession();
  const projects = useMemo(() => (state.status === 'ready' ? state.session.accessibleProjects : []).filter((p) => can(normalizeRole(p.role), 'manageBoard')), [state]);
  const [projectId, setProjectId] = useState('');
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const actorId = state.status === 'ready' ? state.session.actor.id : '';
  const toast = useToast();
  const queryClient = useQueryClient();
  const [manageOpen, setManageOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [accessBoardId, setAccessBoardId] = useState('');
  const [accessError, setAccessError] = useState('');
  const boards = useProjectBoards(project?.id ?? null);
  const boardList = (boards.data ?? []).filter((b) => !b.isArchived);
  const accessBoard = boardList.find((b) => b.id === accessBoardId) ?? boardList[0];
  const access = useQuery({ queryKey: ['board-access', accessBoard?.id], queryFn: async () => (await api.getBoardAccess(accessBoard!.id)).data, enabled: accessOpen && !!accessBoard });
  const setGrant = useMutation({
    mutationFn: (v: { userId: string; allow: boolean }) => api.setBoardGrant(accessBoard!.id, v.userId, v.allow, access.data!.accessRevision),
    onSuccess: () => { setAccessError(''); void queryClient.invalidateQueries({ queryKey: ['board-access', accessBoard?.id] }); },
    onError: (e) => { setAccessError(describeError(e)); void queryClient.invalidateQueries({ queryKey: ['board-access', accessBoard?.id] }); },
  });
  const isOwnerOfProject = project?.role === 'owner';
  const [manageError, setManageError] = useState('');
  const refreshMembers = () => void queryClient.invalidateQueries({ queryKey: ['members', project?.id] });
  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: 'manager' | 'member' | 'viewer'; version: number }) => api.updateProjectMember(project!.id, v.userId, { role: v.role, status: 'active', expectedVersion: v.version }),
    onSuccess: () => { setManageError(''); toast('Role updated', { icon: 'check' }); refreshMembers(); },
    onError: (e) => { setManageError(describeError(e)); refreshMembers(); },
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api.removeProjectMember(project!.id, userId),
    onSuccess: () => { setManageError(''); toast('Member removed', { icon: 'check' }); refreshMembers(); },
    onError: (e) => { setManageError(describeError(e)); refreshMembers(); },
  });

  const directory = useQuery({
    queryKey: ['members', project?.id],
    queryFn: async () => (await api.listProjectMembers(project!.id)).data,
    enabled: !!project,
  });
  const list = (directory.data ?? []).filter((m) => m.status === 'active');
  const nameOf = (m: (typeof list)[number]) => m.displayName ?? m.name;
  const needle = q.trim().toLowerCase();
  const filtered = list.filter((m) => (!role || m.role === role) && (!needle || nameOf(m).toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle)));
  const count = (r: string) => list.filter((m) => m.role === r).length;
  const active = !!(q || role);

  if (state.status === 'ready' && projects.length === 0) {
    return (
      <div id="peopleUnavailable" className="people-unavailable">
        <span className="empty-symbol"><Icon name="lock" /></span>
        <h2>People unavailable</h2>
        <p>Choose a project where you can manage people.</p>
        <Link className="btn" href="/projects">Browse projects</Link>
      </div>
    );
  }

  return (
    <>
      <header className="people-heading">
        <div><h1>People</h1><p className="people-sub">{project?.name ?? 'Loading project members…'}</p></div>
        <div className="people-actions">
          {project && <Link className="btn" href={`/project?id=${encodeURIComponent(project.id)}`}><Icon name="folder" />Project overview</Link>}
          {isOwnerOfProject && boardList.length > 0 && <button className="btn" type="button" onClick={() => { setAccessError(''); setAccessOpen(true); }}><Icon name="lock" />Board access</button>}
          <button className="btn primary" type="button" onClick={() => { setManageError(''); setManageOpen(true); }}><Icon name="users" />Manage members</button>
        </div>
      </header>
      <div id="peopleContent">
        <section className="people-overview" aria-label="Project team overview">
          <span className="overview-symbol"><Icon name="users" /></span>
          <div className="overview-copy"><strong>{list.length}</strong><span>project members</span></div>
          <div className="overview-separator" aria-hidden="true" />
          <div className="overview-metric managers"><span className="metric-dot" aria-hidden="true" /><span><strong>{count('manager')}</strong> {count('manager') === 1 ? 'manager' : 'managers'}</span></div>
          <div className="overview-metric members"><span className="metric-dot" aria-hidden="true" /><span><strong>{count('member')}</strong> {count('member') === 1 ? 'member' : 'members'}</span></div>
          <div className="overview-metric viewers"><span className="metric-dot" aria-hidden="true" /><span><strong>{count('viewer')}</strong> {count('viewer') === 1 ? 'viewer' : 'viewers'}</span></div>
        </section>
        <section className="people-directory" aria-labelledby="teamTitle">
          <div className="directory-head"><div><h2 id="teamTitle">Project team</h2><p>Board access is managed separately.</p></div><span className="directory-count">{filtered.length} {filtered.length === 1 ? 'person' : 'people'}</span></div>
          <div className="directory-toolbar">
            <label className="people-search" htmlFor="peopleSearch"><Icon name="search" /><span className="sr-only">Search people</span><input id="peopleSearch" type="search" placeholder="Search people" autoComplete="off" value={q} onChange={(event) => setQ(event.target.value)} /></label>
            <label className="people-filter"><span className="sr-only">Project</span>
              <select id="peopleProject" aria-label="Select project" value={project?.id ?? ''} onChange={(event) => { setProjectId(event.target.value); setQ(''); setRole(''); }}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select><Icon name="chevron-down" />
            </label>
            <label className="people-filter"><span className="sr-only">Role</span>
              <select id="peopleRole" aria-label="Filter by role" value={role} onChange={(event) => setRole(event.target.value)}>
                <option value="">All roles</option><option value="owner">Owner</option><option value="manager">Manager</option><option value="member">Member</option><option value="viewer">Viewer</option>
              </select><Icon name="chevron-down" />
            </label>
            <button className="clear-people" type="button" hidden={!active} onClick={() => { setQ(''); setRole(''); }}>Clear filters</button>
          </div>
          <div className="directory-results"><span aria-live="polite">{active ? `${filtered.length} matching ${filtered.length === 1 ? 'person' : 'people'}` : 'All project members'}</span><span>Role</span></div>
          <div id="teamList">
            {directory.isPending && project && <div className="people-empty"><strong>Loading…</strong></div>}
            {directory.isError && <div className="people-empty" role="alert"><strong>{describeError(directory.error)}</strong></div>}
            {directory.isSuccess && filtered.length === 0 && (
              <div className="people-empty"><Icon name="users" /><strong>{active ? 'No matching people' : 'No members yet'}</strong><span>{active ? 'Try a different search or role.' : 'Members will appear here.'}</span>{active && <button type="button" onClick={() => { setQ(''); setRole(''); }}>Clear filters</button>}</div>
            )}
            {filtered.map((m) => (
              <article key={m.id} className="team-row">
                <span className="person-avatar"><Avatar id={m.userId ?? m.id} name={nameOf(m)} className="lg" /></span>
                <div className="member-name"><strong>{nameOf(m)}</strong>{(m.userId ?? m.id) === actorId && <span className="you-label">You</span>}</div>
                <span className={`member-role role-${m.role}`}><span aria-hidden="true" className="role-dot" />{ROLE_META[m.role].label}</span>
                <span className="member-icon" aria-hidden="true"><Icon name="user-check" /></span>
              </article>
            ))}
          </div>
        </section>
        <p className="people-foot"><Icon name="info" />Roles come from project membership. Inviting people by email is coming soon.</p>
      </div>
      <DialogLayer open={accessOpen} onClose={() => setAccessOpen(false)} labelledBy="boardAccessTitle" describedBy="boardAccessHelp" className="wide">
        <div className="dialog-head"><div><h2 id="boardAccessTitle">Board access</h2><p>{project?.name}</p></div><button className="dialog-close" type="button" data-autofocus onClick={() => setAccessOpen(false)} aria-label="Close"><Icon name="x" /></button></div>
        <div className="dialog-body people-manage-body">
          <p id="boardAccessHelp" className="people-manage-help">Choose which project members can open this board. Project roles and board access are separate. Owners always have access.</p>
          <label className="people-board-label">Board
            <select className="control" value={accessBoard?.id ?? ''} onChange={(event) => setAccessBoardId(event.target.value)}>{boardList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </label>
          <fieldset className="people-manage-fieldset"><legend>People</legend>
            <div className="people-manage-list">
              {access.isPending && <p>Loading…</p>}
              {access.isError && <p role="alert">{describeError(access.error)}</p>}
              {access.isSuccess && list.filter((m) => m.role !== 'owner').map((m) => {
                const uid = m.userId ?? m.id;
                const granted = access.data.grants.some((g) => g.userId === uid);
                return (
                  <label key={m.id} className="people-manage-person">
                    <input type="checkbox" checked={granted} disabled={setGrant.isPending} onChange={(event) => setGrant.mutate({ userId: uid, allow: event.target.checked })} />
                    <span><strong>{nameOf(m)}</strong><small>{ROLE_META[m.role].label}</small></span>
                  </label>
                );
              })}
              {access.isSuccess && list.filter((m) => m.role !== 'owner').length === 0 && <p>No other members yet.</p>}
            </div>
          </fieldset>
          <p className="form-error" role="alert" hidden={!accessError}>{accessError}</p>
        </div>
        <footer className="dialog-foot"><span className="spacer" /><button className="btn primary" type="button" onClick={() => setAccessOpen(false)}>Done</button></footer>
      </DialogLayer>
      <DialogLayer open={manageOpen} onClose={() => setManageOpen(false)} labelledBy="peopleManageTitle" describedBy="peopleManageHelp" className="wide">
        <div className="dialog-head"><div><h2 id="peopleManageTitle">Manage people</h2><p>{project?.name}</p></div><button className="dialog-close" type="button" data-autofocus onClick={() => setManageOpen(false)} aria-label="Close"><Icon name="x" /></button></div>
        <div className="dialog-body people-manage-body">
          <p id="peopleManageHelp" className="people-manage-help">Change a member&apos;s project role or remove them. Project roles and board access are separate; removing someone also removes their board access. Inviting new people by email is coming soon.</p>
          <fieldset className="people-manage-fieldset"><legend>People</legend>
            <div className="people-manage-list">
              {list.map((m) => {
                const uid = m.userId ?? m.id;
                const isOwner = m.role === 'owner';
                return (
                  <div key={m.id} className="people-manage-person" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ flex: 1, minWidth: 0 }}><strong>{nameOf(m)}</strong>{isOwner && <small style={{ display: 'block' }}>Owner · always has access</small>}{uid === actorId && !isOwner && <small style={{ display: 'block' }}>You</small>}</span>
                    {isOwner ? <span className="badge">Owner</span> : (
                      <>
                        <label className="sr-only" htmlFor={`role-${m.id}`}>Role for {nameOf(m)}</label>
                        <select className="control" id={`role-${m.id}`} style={{ width: 'auto' }} value={m.role} disabled={changeRole.isPending || uid === actorId} onChange={(event) => changeRole.mutate({ userId: uid, role: event.target.value as 'manager' | 'member' | 'viewer', version: m.version })}>
                          <option value="manager">Manager</option><option value="member">Member</option><option value="viewer">Viewer</option>
                        </select>
                        <button className="btn sm" type="button" disabled={removeMember.isPending || uid === actorId} aria-label={`Remove ${nameOf(m)}`} onClick={() => removeMember.mutate(uid)}>Remove</button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
          <p className="form-error" role="alert" hidden={!manageError}>{manageError}</p>
        </div>
        <footer className="dialog-foot"><span className="spacer" /><button className="btn primary" type="button" onClick={() => setManageOpen(false)}>Done</button></footer>
      </DialogLayer>
    </>
  );
}
