'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueries } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { daysUntil, formatShort } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';

const BUCKETS = [
  { id: 'overdue', label: 'Overdue', icon: 'alert' },
  { id: 'today', label: 'Due today', icon: 'calendar' },
  { id: 'week', label: 'Next 7 days', icon: 'clock' },
  { id: 'later', label: 'Later', icon: 'calendar' },
  { id: 'none', label: 'No due date', icon: 'list' },
] as const;
type BucketId = (typeof BUCKETS)[number]['id'];
const RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

function bucketOf(dueDate: string | null): BucketId {
  if (!dueDate) return 'none';
  const days = daysUntil(dueDate);
  if (days === null) return 'none';
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  return days <= 7 ? 'week' : 'later';
}

export default function MyTasksPage() {
  const { state } = useSession();
  const projects = useMemo(() => (state.status === 'ready' ? state.session.accessibleProjects : []).filter((p) => !p.isArchived), [state]);
  const queries = useQueries({ queries: projects.map((p) => ({ queryKey: ['my-tasks', p.id], queryFn: async () => (await api.listMyTasks(p.id)).data, enabled: state.status === 'ready' })) });
  const loading = state.status === 'loading' || queries.some((q) => q.isPending);
  const failed = queries.find((q) => q.isError);
  const [q, setQ] = useState('');
  const [project, setProject] = useState('');
  const [priority, setPriority] = useState('');
  const [due, setDue] = useState('');

  const all = projects.flatMap((p, i) => (queries[i]?.data ?? []).map((card) => ({ ...card, projectId: p.id, projectName: card.projectName ?? p.name })));
  const matches = (card: (typeof all)[number]) => {
    if (project && project !== card.projectId) return false;
    if (priority && priority !== card.priority) return false;
    if (due && due !== bucketOf(card.dueDate)) return false;
    const needle = q.trim().toLowerCase();
    return !needle || `${card.title} ${card.key ?? ''} ${card.projectName} ${card.boardName ?? ''} ${card.columnTitle ?? ''}`.toLowerCase().includes(needle);
  };
  const sorted = (cards: typeof all) => [...cards].sort((a, b) => {
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return (RANK[a.priority] ?? 9) - (RANK[b.priority] ?? 9) || a.title.localeCompare(b.title);
  });
  const visible = all.filter(matches);
  const count = (id: BucketId) => all.filter((c) => bucketOf(c.dueDate) === id).length;
  const filtered = !!(q || project || priority || due);
  const projectCount = new Set(all.map((c) => c.projectId)).size;
  const clear = () => { setQ(''); setProject(''); setPriority(''); setDue(''); };
  const quick = (id: BucketId) => setDue((d) => (d === id ? '' : id));

  return (
    <>
      <header className="work-heading">
        <div><p className="work-kicker">YOUR WORK</p><h1>My tasks</h1><p className="work-sub">{loading ? 'Loading tasks…' : `${all.length} open ${all.length === 1 ? 'task' : 'tasks'} across ${projectCount} ${projectCount === 1 ? 'project' : 'projects'}`}</p></div>
        <Link className="btn work-board-link" href="/projects"><Icon name="board" />Browse projects</Link>
      </header>
      <section className={`work-overview${count('overdue') > 0 ? ' has-overdue' : ''}`} aria-label="Task overview">
        <div className="overview-intro"><span className="overview-icon"><Icon name="check-circle" /></span><div><strong>{all.length}</strong><span>open tasks</span></div></div>
        <div className="overview-divider" aria-hidden="true" />
        <button className="overview-item attention" type="button" aria-pressed={due === 'overdue'} onClick={() => quick('overdue')}><Icon name="alert" /><span><strong>{count('overdue')}</strong> overdue</span></button>
        <button className="overview-item today" type="button" aria-pressed={due === 'today'} onClick={() => quick('today')}><Icon name="calendar" /><span><strong>{count('today')}</strong> due today</span></button>
        <button className="overview-item week" type="button" aria-pressed={due === 'week'} onClick={() => quick('week')}><Icon name="clock" /><span><strong>{count('week')}</strong> next 7 days</span></button>
      </section>
      <section className="queue" aria-labelledby="queueTitle">
        <div className="queue-header"><div><h2 id="queueTitle">Your queue</h2><p>Tasks assigned to you, organized by due date.</p></div><span className="queue-total">{visible.length} {visible.length === 1 ? 'task' : 'tasks'}</span></div>
        <div className="queue-toolbar">
          <label className="queue-search" htmlFor="taskSearch"><Icon name="search" /><span className="sr-only">Search tasks</span><input type="search" id="taskSearch" placeholder="Search tasks" autoComplete="off" value={q} onChange={(event) => setQ(event.target.value)} /></label>
          <label className="filter-field"><span className="sr-only">Project</span>
            <select aria-label="Filter by project" value={project} onChange={(event) => setProject(event.target.value)}>
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select><Icon name="chevron-down" />
          </label>
          <label className="filter-field"><span className="sr-only">Priority</span>
            <select aria-label="Filter by priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="">All priorities</option><option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="none">No priority</option>
            </select><Icon name="chevron-down" />
          </label>
          <label className="filter-field"><span className="sr-only">Due date</span>
            <select aria-label="Filter by due date" value={due} onChange={(event) => setDue(event.target.value)}>
              <option value="">Any due date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Next 7 days</option><option value="later">Later</option><option value="none">No due date</option>
            </select><Icon name="chevron-down" />
          </label>
          <button className="clear-filters" type="button" hidden={!filtered} onClick={clear}>Clear filters</button>
        </div>
        <div className="queue-results"><span aria-live="polite">{filtered ? `${visible.length} matching ${visible.length === 1 ? 'task' : 'tasks'}` : 'All open tasks'}</span><span>Sorted by due date</span></div>
        <div className="queue-list">
          {failed ? <div className="queue-empty" role="alert"><Icon name="alert" /><strong>{describeError(failed.error)}</strong></div>
            : !loading && visible.length === 0 ? (
              <div className="queue-empty"><Icon name="check-circle" /><strong>{filtered ? 'No matching tasks' : 'Your queue is clear'}</strong><span>{filtered ? 'Try a different filter or search.' : 'Assigned tasks will appear here.'}</span>{filtered && <button type="button" onClick={clear}>Clear filters</button>}</div>
            ) : BUCKETS.map((g) => {
              const cards = sorted(visible.filter((c) => bucketOf(c.dueDate) === g.id));
              if (!cards.length) return null;
              return (
                <section key={g.id} className="work-group" data-group={g.id} aria-labelledby={`group-${g.id}`}>
                  <div className="work-group-heading"><Icon name={g.icon} /><h3 id={`group-${g.id}`}>{g.label}</h3><span>{cards.length}</span></div>
                  {cards.map((card) => {
                    const href = `/board?id=${encodeURIComponent(card.boardId)}&card=${encodeURIComponent(card.id)}`;
                    const label = card.priority === 'none' ? 'No priority' : card.priority[0]!.toUpperCase() + card.priority.slice(1);
                    const group = bucketOf(card.dueDate);
                    return (
                      <article key={card.id} className="work-row" data-due={group}>
                        <span className="row-marker" aria-hidden="true"><Icon name="board" /></span>
                        <div className="work-row-main">
                          <div className="work-row-title"><Link href={href}>{card.title}</Link>{card.key && <span className="work-key">{card.key}</span>}</div>
                          <div className="work-row-context"><span>{card.projectName}</span><span aria-hidden="true">/</span><span>{card.boardName}</span><span aria-hidden="true">·</span><span>{card.columnTitle}</span></div>
                        </div>
                        <div className="work-row-meta">
                          <span className={`priority-label priority-${card.priority}`}>{label}</span>
                          <span className={`due-label ${group}`}><Icon name="calendar" />{!card.dueDate ? 'No due date' : group === 'today' ? 'Due today' : `${group === 'overdue' ? 'Overdue' : 'Due'} · ${formatShort(card.dueDate)}`}</span>
                        </div>
                        <Link className="work-open" href={href} aria-label={`Open ${card.title}`}><Icon name="arrow-right" /></Link>
                      </article>
                    );
                  })}
                </section>
              );
            })}
        </div>
      </section>
    </>
  );
}
