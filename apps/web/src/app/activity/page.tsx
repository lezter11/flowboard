'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { describeActivity } from '@/lib/activity';
import { relativeTime } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';

function dayKey(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }).format(d);
}

export default function ActivityPage() {
  const { state } = useSession();
  const projects = state.status === 'ready' ? state.session.accessibleProjects : [];
  const [projectId, setProjectId] = useState('');
  const activeProject = projects.find((p) => p.id === projectId) ?? projects[0];
  const [q, setQ] = useState('');
  const [actor, setActor] = useState('all');
  const [category, setCategory] = useState('all');
  const [date, setDate] = useState('all');
  const [limit, setLimit] = useState(10);

  const feed = useQuery({
    queryKey: ['project-activity', activeProject?.id],
    queryFn: async () => (await api.listProjectActivity(activeProject!.id)).data,
    enabled: !!activeProject,
  });
  const items = useMemo(() => (feed.data ?? []).map((item) => ({ item, view: describeActivity(item, 'a card') })), [feed.data]);
  const actors = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach(({ item }) => map.set(item.actorId, item.actor?.displayName ?? 'Former member'));
    return [...map.entries()];
  }, [items]);
  const categories = [...new Set(items.map(({ view }) => view.category))];
  const filtered = items.filter(({ item, view }) => {
    if (actor !== 'all' && item.actorId !== actor) return false;
    if (category !== 'all' && view.category !== category) return false;
    if (date !== 'all' && new Date(item.createdAt).getTime() < Date.now() - Number(date) * 86_400_000) return false;
    const needle = q.trim().toLowerCase();
    return !needle || `${item.actor?.displayName ?? ''} ${view.text} ${view.category}`.toLowerCase().includes(needle);
  });
  const shown = filtered.slice(0, limit);
  const active = actor !== 'all' || category !== 'all' || date !== 'all' || !!q.trim();
  const groups: Array<{ key: string; events: typeof shown }> = [];
  shown.forEach((entry) => {
    const key = dayKey(entry.item.createdAt);
    let group = groups.find((g) => g.key === key);
    if (!group) { group = { key, events: [] }; groups.push(group); }
    group.events.push(entry);
  });
  const reset = () => { setActor('all'); setCategory('all'); setDate('all'); setQ(''); setLimit(10); };

  return (
    <>
      <header className="activity-heading">
        <div><p className="activity-kicker">WORKSPACE</p><h1>Activity</h1><p className="activity-sub">A clear view of recent changes.</p></div>
        <Link className="btn activity-project-link" href="/projects"><Icon name="folder" />Browse projects</Link>
      </header>
      <section className="activity-overview" aria-label="Activity overview">
        <span className="overview-mark"><Icon name="activity" /></span>
        <div className="overview-copy"><strong>{items.length}</strong><span>events</span></div>
        <div className="overview-separator" aria-hidden="true" />
        <div className="overview-metric"><Icon name="folder" /><span><strong>{activeProject ? 1 : 0}</strong> project</span></div>
        <div className="overview-metric people"><Icon name="users" /><span><strong>{actors.length}</strong> people</span></div>
      </section>
      <section className="activity-queue" aria-labelledby="feedTitle">
        <div className="activity-queue-head">
          <div><h2 id="feedTitle">Recent activity</h2><p>Recorded changes across accessible work.</p></div>
          <span className="feed-count">{filtered.length} {filtered.length === 1 ? 'event' : 'events'}</span>
        </div>
        <div className="activity-toolbar">
          <label className="activity-search" htmlFor="activitySearch"><Icon name="search" /><span className="sr-only">Search activity</span><input type="search" id="activitySearch" placeholder="Search activity" autoComplete="off" value={q} onChange={(event) => { setQ(event.target.value); setLimit(10); }} /></label>
          <label className="activity-filter"><span className="sr-only">Project</span>
            <select aria-label="Filter by project" value={activeProject?.id ?? ''} onChange={(event) => { setProjectId(event.target.value); reset(); }}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select><Icon name="chevron-down" />
          </label>
          <label className="activity-filter"><span className="sr-only">Person</span>
            <select aria-label="Filter by person" value={actor} onChange={(event) => { setActor(event.target.value); setLimit(10); }}>
              <option value="all">Everyone</option>
              {actors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select><Icon name="chevron-down" />
          </label>
          <label className="activity-filter"><span className="sr-only">Action</span>
            <select aria-label="Filter by action" value={category} onChange={(event) => { setCategory(event.target.value); setLimit(10); }}>
              <option value="all">All actions</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select><Icon name="chevron-down" />
          </label>
          <label className="activity-filter"><span className="sr-only">Date</span>
            <select aria-label="Filter by date" value={date} onChange={(event) => { setDate(event.target.value); setLimit(10); }}>
              <option value="all">All dates</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
            </select><Icon name="chevron-down" />
          </label>
          <button className="activity-clear" type="button" hidden={!active} onClick={reset}>Clear filters</button>
        </div>
        <div className="activity-results"><span aria-live="polite">{active ? `${filtered.length} matching ${filtered.length === 1 ? 'event' : 'events'}` : 'All activity'}</span><span>Newest first</span></div>
        <div id="feedPanel">
          {feed.isPending && activeProject && <div className="activity-empty"><strong>Loading activity…</strong></div>}
          {feed.isError && <div className="activity-empty" role="alert"><strong>{describeError(feed.error)}</strong></div>}
          {!activeProject && <div className="activity-empty"><Icon name="activity" /><strong>No projects yet</strong><span>Activity appears once you can open a project.</span></div>}
          {feed.isSuccess && groups.length === 0 && (
            <div className="activity-empty"><Icon name="activity" /><strong>{active ? 'No matching activity' : 'No activity yet'}</strong><span>{active ? 'Try a different filter or search.' : 'Changes to cards, boards, columns and people will be recorded here.'}</span>{active && <button type="button" onClick={reset}>Clear filters</button>}</div>
          )}
          {groups.map((group) => (
            <section key={group.key} className="activity-day">
              <h3>{group.key}</h3>
              {group.events.map(({ item, view }) => (
                <article key={item.id} className="activity-event" data-category={view.category.toLowerCase()}>
                  <span className="event-icon" aria-hidden="true"><Icon name={view.icon} /></span>
                  <div className="event-body">
                    <p className="event-title"><strong>{item.actor?.displayName ?? 'Someone'}</strong> {view.text}</p>
                    {item.boardId && item.cardId && (
                      <Link className="event-card" href={`/board?id=${encodeURIComponent(item.boardId)}&card=${encodeURIComponent(item.cardId)}`}>{item.cardKey ?? 'Card'} <span>{item.cardTitle ?? ''}</span><Icon name="arrow-right" /></Link>
                    )}
                    <div className="event-context"><span>{activeProject?.name}</span><span className="event-category">{view.category}</span></div>
                  </div>
                  <time className="event-time" dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time>
                </article>
              ))}
            </section>
          ))}
        </div>
        <div className="activity-more">
          <span>{filtered.length ? `Showing ${shown.length} of ${filtered.length}` : ''}</span>
          <button className="btn" type="button" hidden={shown.length >= filtered.length} onClick={() => setLimit((n) => n + 10)}>Load more</button>
        </div>
      </section>
    </>
  );
}
