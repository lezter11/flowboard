'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Notification } from '@flowboard/contracts';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useCursorFeed } from '@/lib/cursor-feed';
import { usePollKeys } from '@/components/polling';
import { FeedControls } from '@/components/ui/feed-controls';
import { toastFailure } from '@/lib/toast-failure';
import { describeError } from '@/lib/errors';
import { relativeTime } from '@/lib/dates';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toasts';
import { notificationHref } from '@/lib/notification-link';

type Lane = 'all' | 'needs' | 'updates';
const TYPE: Record<Notification['type'], { icon: string; label: string }> = {
  mention: { icon: 'at', label: 'Mention' },
  assigned: { icon: 'user-check', label: 'Assignment' },
  system: { icon: 'info', label: 'Update' },
};
const LANES: Array<{ id: Exclude<Lane, 'all'>; label: string; hint: string }> = [
  { id: 'needs', label: 'Needs you', hint: 'Unread mentions and assignments' },
  { id: 'updates', label: 'Updates', hint: 'Card events you have already read' },
];

/** Needs you = unread mentions and assignments; everything else is an update. */
const laneOf = (n: Notification): Exclude<Lane, 'all'> => (n.type !== 'system' && !n.read ? 'needs' : 'updates');

export default function InboxPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [lane, setLane] = useState<Lane>('all');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const {state}=useSession();const actorId=state.status==='ready'?state.session.actor.id:'';
  const queryKey=useMemo(()=>['notifications',actorId] as const,[actorId]);
  const feed = useCursorFeed<Notification>(queryKey,(cursor,signal)=>api.listNotifications({cursor,signal}),!!actorId);
  usePollKeys([queryKey],!!actorId);
  const items = feed.items;
  const needle = q.trim().toLowerCase();
  const matches = (n: Notification) => !needle || `${n.title} ${n.body}`.toLowerCase().includes(needle);
  const visible = items.filter((n) => matches(n) && (lane === 'all' || laneOf(n) === lane));
  const unread = items.filter((n) => !n.read).length;
  const selected = items.find((n) => n.id === selectedId) ?? visible[0] ?? null;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({ mutationFn: (id: string) => api.markNotificationRead(id), onSuccess: refresh, onError: (e) => toastFailure(toast, e) });
  const markAll = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => { toast('All notifications marked read', { icon: 'check-circle' }); refresh(); },
    onError: (e) => toastFailure(toast, e),
  });

  const row = (n: Notification) => {
    const type = TYPE[n.type] ?? TYPE.system;
    return (
      <button key={n.id} className={`thread-row${n.read ? '' : ' is-unread'}`} type="button" data-category={laneOf(n)} aria-current={selected?.id === n.id ? 'true' : 'false'} onClick={() => { setSelectedId(n.id); if (!n.read) markRead.mutate(n.id); }}>
        <span className={`thread-glyph ${n.type}`} aria-hidden="true"><Icon name={type.icon} /></span>
        <span className="thread-main">
          <span className="thread-title"><span className="thread-name">{n.title}</span></span>
          {n.body && <span className="thread-line">{n.body}</span>}
        </span>
        <span className="thread-side">
          <span className="thread-time">{relativeTime(n.createdAt)}</span>
          <span className="thread-state">{n.read ? <span className="read-check" aria-hidden="true"><Icon name="check" /></span> : <span className="unread-dot" aria-label="unread" />}</span>
        </span>
      </button>
    );
  };

  const empty = (
    <div className="stream-empty">
      <span className="empty-glyph" aria-hidden="true"><Icon name={needle ? 'search' : 'check-circle'} /></span>
      <h3>{needle ? `No notifications match “${q.trim()}”` : lane === 'needs' ? 'No unread mentions or assignments loaded' : 'No notifications loaded'}</h3>
      <p>{needle ? 'Search covers loaded titles and message text. Load more to search further.' : 'New mentions and assignments appear here.'}</p>
      {needle && <div className="empty-actions"><button className="btn soft" type="button" onClick={() => setQ('')}>Clear search</button></div>}
    </div>
  );

  const href = selected ? notificationHref(selected.link) : null;
  return (
    <>
      <div className="page-head inbox-head">
        <div className="page-head-copy">
          <h1>Inbox</h1>
          <p className="page-sub"><span>{feed.isPending ? 'Loading notifications…' : unread ? `${unread} unread in ${items.length} loaded` : `${items.length} loaded · none unread in this page set`}</span></p>
        </div>
        <div className="page-actions">
          <button className="btn" type="button" disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate()}><Icon name="check-circle" />Mark all read</button>
        </div>
      </div>

      <div className="triage-bar">
        <div className="lane-tabs" role="group" aria-label="Filter notifications">
          <button className="lane-tab" type="button" aria-pressed={lane === 'all'} onClick={() => setLane('all')}><Icon name="inbox" className="lane-icon" />All <span className="lane-count">{items.length}</span></button>
          <button className="lane-tab" type="button" aria-pressed={lane === 'needs'} onClick={() => setLane('needs')}><Icon name="bell" className="lane-icon" />Needs you <span className="lane-count">{items.filter((n) => laneOf(n) === 'needs').length}</span></button>
          <button className="lane-tab" type="button" aria-pressed={lane === 'updates'} onClick={() => setLane('updates')}><Icon name="activity" className="lane-icon" />Updates <span className="lane-count">{items.filter((n) => laneOf(n) === 'updates').length}</span></button>
        </div>
        <label className="inbox-search" htmlFor="inboxSearch">
          <Icon name="search" />
          <input id="inboxSearch" type="search" autoComplete="off" placeholder="Search loaded notifications" aria-label="Search loaded notifications" value={q} onChange={(event) => setQ(event.target.value)} />
        </label>
      </div>

      <div className="inbox-desk">
        <section className="inbox-stream" aria-labelledby="streamTitle">
          <h2 className="sr-only" id="streamTitle">Notifications</h2>
          <div className="stream-scroll" tabIndex={0} role="region" aria-label="Notification threads">
            <div className="stream-inner">
              {feed.isError ? <div className="stream-empty" role="alert"><h3>{describeError(feed.error)}</h3></div>
                : feed.isPending ? <p role="status">Loading notifications…</p> : visible.length === 0 ? empty
                : lane === 'all' ? LANES.map((l) => {
                    const inLane = visible.filter((n) => laneOf(n) === l.id);
                    return inLane.length ? (
                      <section key={l.id} className="lane" data-category={l.id} aria-labelledby={`lane-${l.id}`}>
                        <header className="lane-head" id={`lane-${l.id}`}><span className={`lane-dot ${l.id}`} aria-hidden="true" /><span>{l.label}</span><span className="lane-count">{inLane.length}</span><span className="lane-hint">{l.hint}</span></header>
                        {inLane.map(row)}
                      </section>
                    ) : null;
                  })
                : visible.map(row)}
            </div>
          </div>
          <div className="stream-foot"><span className="tabular">{visible.length} of {items.length} loaded</span><FeedControls name="notifications" queryKey={queryKey} feed={feed} loaded={items.length} /></div>
        </section>

        <aside className="inbox-detail" aria-labelledby="detailTitle" tabIndex={-1}>
          {selected ? (
            <>
              <div className="detail-head">
                <span className={`detail-kind ${selected.type}`}><Icon name={(TYPE[selected.type] ?? TYPE.system).icon} />{(TYPE[selected.type] ?? TYPE.system).label}</span>
                <span className={`detail-state${selected.read ? ' is-read' : ''}`}>{selected.read ? 'Read' : 'Unread'}</span>
                <span className="detail-time">{relativeTime(selected.createdAt)}</span>
              </div>
              <h2 className="detail-title" id="detailTitle">{selected.title}</h2>
              <div className="detail-cta">
                {href && <Link className="btn primary" href={href}><Icon name="board" />Open card</Link>}
              </div>
              {selected.body && <blockquote className="detail-quote">{selected.body}</blockquote>}
            </>
          ) : (
            <div className="detail-empty">
              <span className="empty-glyph" aria-hidden="true"><Icon name="inbox" /></span>
              <h3>No notification selected</h3>
              <p>New mentions and assignments appear here.</p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
