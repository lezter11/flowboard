'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { can, normalizeRole, ROLE_META } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';
import { Avatar } from '@/components/ui/avatar';

export default function PeoplePage() {
  const { state } = useSession();
  const projects = useMemo(() => (state.status === 'ready' ? state.session.accessibleProjects : []).filter((p) => can(normalizeRole(p.role), 'manageBoard')), [state]);
  const [projectId, setProjectId] = useState('');
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const actorId = state.status === 'ready' ? state.session.actor.id : '';

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
          <button className="btn primary" type="button" disabled title="Inviting and managing members is coming soon"><Icon name="users" />Manage members <span className="nav-badge quiet" style={{ marginLeft: 6 }}>Soon</span></button>
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
        <p className="people-foot"><Icon name="info" />Roles come from project membership. Inviting people and changing roles are coming soon.</p>
      </div>
    </>
  );
}
