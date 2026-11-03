'use client';
import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { CardSummary, MyTasksQuery } from '@flowboard/contracts';
import { api } from '@/lib/api';
import { useCursorFeed } from '@/lib/cursor-feed';
import { selectedTaskProject } from '@/lib/task-scope';
import { formatShort } from '@/lib/dates';
import { useSession } from '@/lib/session';
import { usePollKeys } from '@/components/polling';
import { FeedControls } from '@/components/ui/feed-controls';
import { Icon } from '@/components/ui/icon';

type Task = CardSummary & {projectName?:string;boardName?:string;columnTitle?:string};
function MyTasksScreen() {
  const {state}=useSession(); const params=useSearchParams();
  const [selection,setSelection]=useState<string|null>(null);
  const projects=state.status==='ready'?state.session.accessibleProjects:[];
  const actorId=state.status==='ready'?state.session.actor.id:'';
  const current=state.status==='ready'?state.session.lastLocation?.projectId??null:null;
  const project=selectedTaskProject(projects,selection??params.get('project'),current);
  const [q,setQ]=useState(''); const [priority,setPriority]=useState<MyTasksQuery['priority']>();
  const initialDue=params.get('due');
  const [due,setDue]=useState<MyTasksQuery['due']>(initialDue && ['overdue','today','upcoming','none'].includes(initialDue)?initialDue as MyTasksQuery['due']:undefined);
  const key=useMemo(()=>['my-tasks',project?.id,actorId,{due,priority}] as const,[project?.id,actorId,due,priority]);
  const feed=useCursorFeed<Task,Awaited<ReturnType<typeof api.listMyTasks>>>(key,(cursor,signal)=>api.listMyTasks(project!.id,{cursor,signal,due,priority}),!!project&&!!actorId);
  usePollKeys([key],!!project&&!!actorId);
  const needle=q.trim().toLowerCase();
  const visible=feed.items.filter((card)=>!needle||`${card.title} ${card.key??''} ${card.boardName??''} ${card.columnTitle??''}`.toLowerCase().includes(needle));
  const filtered=!!(needle||priority||due);
  const clear=()=>{setQ('');setPriority(undefined);setDue(undefined);};
  return <>
    <header className="work-heading"><div><p className="work-kicker">YOUR WORK</p><h1>My tasks</h1><p className="work-sub">{project?`Open tasks assigned to you in ${project.name}.`:'Choose an accessible active project.'}</p></div><Link className="btn work-board-link" href="/projects"><Icon name="board" />Browse projects</Link></header>
    <section className="queue" aria-labelledby="queueTitle">
      <div className="queue-header"><div><h2 id="queueTitle">Your queue</h2><p>One project at a time. {feed.data?.pages[0] ? <>Workspace today: {feed.data.pages[0].asOfDate} ({feed.data.pages[0].timezone}).</> : 'Due-date filters use the workspace calendar.'}</p></div><span className="queue-total">{feed.items.length} loaded</span></div>
      <div className="queue-toolbar">
        <label className="queue-search" htmlFor="taskSearch"><Icon name="search" /><span className="sr-only">Search loaded tasks</span><input type="search" id="taskSearch" placeholder="Search loaded tasks" autoComplete="off" value={q} onChange={(e)=>setQ(e.target.value)} /></label>
        <label className="filter-field"><span className="sr-only">Project</span><select aria-label="Select project" value={project?.id??''} onChange={(e)=>{setSelection(e.target.value);setQ('');}}>{!project&&<option value="">Choose project</option>}{projects.filter((p)=>!p.isArchived).map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select><Icon name="chevron-down" /></label>
        <label className="filter-field"><span className="sr-only">Priority</span><select aria-label="Filter by priority" value={priority??''} onChange={(e)=>setPriority((e.target.value||undefined) as MyTasksQuery['priority'])}><option value="">All priorities</option><option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="none">No priority</option></select><Icon name="chevron-down" /></label>
        <label className="filter-field"><span className="sr-only">Due date</span><select aria-label="Filter by due date" value={due??''} onChange={(e)=>setDue((e.target.value||undefined) as MyTasksQuery['due'])}><option value="">Any due date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="upcoming">After today</option><option value="none">No due date</option></select><Icon name="chevron-down" /></label>
        <button className="clear-filters" type="button" hidden={!filtered} onClick={clear}>Clear filters</button>
      </div>
      <div className="queue-results"><span aria-live="polite">{visible.length} matching loaded tasks{feed.hasNextPage?'; load more to search further.':'.'}</span><span>Server order · due date, priority</span></div>
      <div className="queue-list">
        {!project && <div className="queue-empty" role="status"><strong>{projects.length?'This project is unavailable or archived.':'No active projects yet'}</strong><span>Select an accessible project above.</span></div>}
        {project&&feed.isPending&&<div className="queue-empty" role="status">Loading tasks…</div>}
        {project&&feed.isSuccess&&!visible.length&&<div className="queue-empty"><Icon name="check-circle" /><strong>{filtered?'No matching tasks loaded':'No open tasks loaded'}</strong><span>{feed.hasNextPage?'More tasks are available below.':filtered?'Try another filter.':'Assigned tasks will appear here.'}</span></div>}
        {visible.map((card)=>{const href=`/board?id=${encodeURIComponent(card.boardId)}&card=${encodeURIComponent(card.id)}`;return <article key={card.id} className="work-row"><span className="row-marker" aria-hidden="true"><Icon name="board" /></span><div className="work-row-main"><div className="work-row-title"><Link href={href}>{card.title}</Link>{card.key&&<span className="work-key">{card.key}</span>}</div><div className="work-row-context"><span>{card.projectName??project?.name}</span><span aria-hidden="true">/</span><span>{card.boardName}</span><span aria-hidden="true">·</span><span>{card.columnTitle}</span></div></div><div className="work-row-meta"><span className={`priority-label priority-${card.priority}`}>{card.priority==='none'?'No priority':card.priority}</span><span className="due-label"><Icon name="calendar" />{card.dueDate?`Due ${formatShort(card.dueDate)}`:'No due date'}</span></div><Link className="work-open" href={href} aria-label={`Open ${card.title}`}><Icon name="arrow-right" /></Link></article>;})}
      </div>
      {project&&<FeedControls name="tasks" queryKey={key} feed={feed} loaded={feed.items.length} />}
    </section>
  </>;
}
export default function MyTasksPage(){return <Suspense fallback={<p role="status">Loading tasks…</p>}><MyTasksScreen /></Suspense>;}
