'use client';
import {Suspense,useMemo,useState} from 'react';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import type {ActivityItem} from '@flowboard/contracts';
import {api} from '@/lib/api';
import {useSession} from '@/lib/session';
import {useCursorFeed} from '@/lib/cursor-feed';
import {auditServerFilters,EMPTY_AUDIT_FILTERS,type AuditFilters} from '@/lib/audit-filters';
import {describeActivity} from '@/lib/activity';
import {ActivityDetails} from '@/components/board/activity-details';
import {formatPersonName} from '@/lib/person-name';
import {relativeTime} from '@/lib/dates';
import {usePollKeys} from '@/components/polling';
import {FeedControls} from '@/components/ui/feed-controls';
import {ErrorNote} from '@/components/ui/error-note';
import {Icon} from '@/components/ui/icon';

function ActivityScreen(){
  const {state}=useSession();const params=useSearchParams();const actorId=state.status==='ready'?state.session.actor.id:'';
  const projects=state.status==='ready'?state.session.accessibleProjects:[];
  const workspaces=state.status==='ready'?state.session.ownedWorkspaces:[];
  const [mode,setMode]=useState<'project'|'workspace'>(params.get('scope')==='workspace'?'workspace':'project');
  const [projectId,setProjectId]=useState<string|null>(null),[workspaceId,setWorkspaceId]=useState<string|null>(null);
  const explicitProject=projectId??params.get('project');const current=state.status==='ready'?state.session.lastLocation?.projectId:null;
  const project=explicitProject?projects.find((p)=>p.id===explicitProject):projects.find((p)=>p.id===current)??projects[0];
  const explicitWorkspace=workspaceId??params.get('workspace');
  const workspace=explicitWorkspace?workspaces.find((w)=>w.id===explicitWorkspace):workspaces.find((w)=>w.id===project?.workspaceId)??workspaces[0];
  const projectAllowed=project?.role==='owner'||project?.role==='manager';
  const enabled=!!actorId&&(mode==='workspace'?!!workspace:!!project&&projectAllowed);
  const [draft,setDraft]=useState<AuditFilters>(EMPTY_AUDIT_FILTERS),[applied,setApplied]=useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [q,setQ]=useState(''),[filterError,setFilterError]=useState('');
  const filters=useMemo(()=>auditServerFilters(applied),[applied]);
  const key=useMemo(()=>[mode==='workspace'?'workspace-activity':'project-activity',mode==='workspace'?workspace?.id:project?.id,actorId,filters]as const,[mode,workspace?.id,project?.id,actorId,filters]);
  const feed=useCursorFeed<ActivityItem>(key,(cursor,signal)=>{if(mode==='workspace')return api.listWorkspaceActivity(workspace!.id,{...filters,cursor,signal});const {projectId:_scope,...scoped}=filters;return api.listProjectActivity(project!.id,50,cursor,signal,scoped);},enabled);
  usePollKeys([key],enabled);
  const items=feed.items.map((item)=>({item,view:describeActivity(item,'a card')}));
  const needle=q.trim().toLowerCase();const visible=items.filter(({item,view})=>!needle||`${formatPersonName(item.actor)} ${view.text} ${view.category}`.toLowerCase().includes(needle));
  const actors=[...new Map(items.map(({item})=>[item.actorId,formatPersonName(item.actor,'Former member')])).entries()];
  const actions=[...new Set(items.map(({item})=>item.action))];
  const reset=()=>{setDraft(EMPTY_AUDIT_FILTERS);setApplied(EMPTY_AUDIT_FILTERS);setQ('');setFilterError('');};
  const update=(key:keyof AuditFilters,value:string)=>setDraft((old)=>({...old,[key]:value}));
  return <>
    <header className="activity-heading"><div><p className="activity-kicker">CURRENT ACCESS</p><h1>Activity</h1><p className="activity-sub">{mode==='workspace'?'Owned workspace activity across projects.':'Project activity for Owners and Managers.'}</p></div><Link className="btn" href="/projects">Browse projects</Link></header>
    <section className="activity-queue" aria-labelledby="feedTitle"><div className="activity-queue-head"><div><h2 id="feedTitle">Recorded changes</h2><p>Project, card, actor, action and UTC date filters run on the server before paging.</p></div><span className="feed-count">{feed.items.length} loaded</span></div>
      <div className="activity-toolbar"><label className="activity-filter">Scope<select aria-label="Activity scope" value={mode} onChange={(e)=>{setMode(e.target.value as 'project'|'workspace');reset();}}><option value="project">Project activity</option>{!!workspaces.length&&<option value="workspace">Owned workspace activity</option>}</select></label>
        {mode==='workspace'?<label className="activity-filter">Your workspace<select aria-label="Activity workspace" value={workspace?.id??''} onChange={(e)=>{setWorkspaceId(e.target.value);reset();}}>{!workspace&&<option value="">Unavailable workspace</option>}{workspaces.map((w)=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>:<label className="activity-filter">Project<select aria-label="Activity project" value={project?.id??''} onChange={(e)=>{setProjectId(e.target.value);reset();}}>{!project&&<option value="">Unavailable project</option>}{projects.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      </div>
      {!enabled&&<div className="activity-empty" role="status"><Icon name="lock" /><strong>{mode==='workspace'?'Only a workspace Owner can read that workspace audit.':'Project-wide audit is for the project Owner and Managers.'}</strong><span>Members and Viewers can open Activity inside a granted card.</span></div>}
      {enabled&&<>
        <form className="activity-toolbar" onSubmit={(event)=>{event.preventDefault();try{auditServerFilters(draft);setApplied({...draft});setFilterError('');}catch{setFilterError('The through date must be on or after the from date.');}}}>
          {mode==='workspace'&&<label className="activity-filter">Project filter<select aria-label="Audit project filter" value={draft.projectId} onChange={(e)=>update('projectId',e.target.value)}><option value="">All projects in this workspace</option>{projects.filter((p)=>p.workspaceId===workspace?.id&&p.role==='owner').map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
          <label className="activity-filter">Card ID<input className="control" value={draft.cardId} onChange={(e)=>update('cardId',e.target.value)} /></label>
          <label className="activity-filter">Actor ID<input className="control" list="auditActors" value={draft.actorId} onChange={(e)=>update('actorId',e.target.value)} /><datalist id="auditActors">{actors.map(([id,name])=><option key={id} value={id}>{name}</option>)}</datalist></label>
          <label className="activity-filter">Action<input className="control" list="auditActions" value={draft.action} onChange={(e)=>update('action',e.target.value)} /><datalist id="auditActions">{actions.map((action)=><option key={action} value={action} />)}</datalist></label>
          <label className="activity-filter">From date (UTC)<input className="control" type="date" value={draft.fromDate} onChange={(e)=>update('fromDate',e.target.value)} /></label>
          <label className="activity-filter">Through date (UTC)<input className="control" type="date" value={draft.toDate} onChange={(e)=>update('toDate',e.target.value)} /></label>
          <button className="btn primary" type="submit">Apply audit filters</button><button className="btn" type="button" onClick={reset}>Clear audit filters</button>
        </form>
        {filterError&&<ErrorNote text={filterError} focusOnMount />}
        <label className="activity-search" htmlFor="activitySearch"><Icon name="search" /><span className="sr-only">Search loaded activity</span><input id="activitySearch" type="search" placeholder="Search loaded activity text" value={q} onChange={(e)=>setQ(e.target.value)} /></label>
        <div className="activity-results"><span>{visible.length} matching loaded events{feed.hasNextPage?'; more pages available.':'.'}</span><span>Newest first</span></div>
        {feed.isPending&&<p role="status">Loading activity…</p>}{feed.isSuccess&&!visible.length&&<div className="activity-empty"><strong>No matching events loaded</strong><span>{feed.hasNextPage?'Load more to search further.':'Try another server filter or text search.'}</span></div>}
        {visible.map(({item,view})=><article key={item.id} className="activity-event"><span className="event-icon" aria-hidden="true"><Icon name={view.icon} /></span><div className="event-body"><p className="event-title"><strong>{formatPersonName(item.actor,'Former member')}</strong> {view.text}</p><ActivityDetails item={item} />{item.boardId&&item.cardId&&<Link className="event-card" href={`/board?id=${encodeURIComponent(item.boardId)}&card=${encodeURIComponent(item.cardId)}`}>{item.cardKey??'Card'} {item.cardTitle??''}</Link>}<div className="event-context"><span>{projects.find((p)=>p.id===item.projectId)?.name??'Project'}</span><span>{view.category}</span></div></div><time className="event-time" dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time></article>)}
        <FeedControls name="activity" queryKey={key} feed={feed} loaded={feed.items.length} />
      </>}
    </section>
  </>;
}
export default function ActivityPage(){return <Suspense fallback={<p role="status">Loading activity…</p>}><ActivityScreen /></Suspense>;}
