'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { m } from 'motion/react';
import type { ProjectOverview } from '@flowboard/contracts';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { relativeTime } from '@/lib/dates';
import { useCountUp } from '@/lib/count-up';
import { describeActivity } from '@/lib/activity';
import { Avatar } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icon';

export const overviewQueryKey = (projectId: string) => ['project-overview', projectId] as const;

export function useProjectOverview(projectId: string) {
  return useQuery({
    queryKey: overviewQueryKey(projectId),
    queryFn: async () => (await api.getProjectOverview(projectId)).data,
    staleTime: 20_000,
  });
}

// 35 ms between items; opacity and transform only. MotionConfig reducedMotion="user" drops the movement for people who ask.
const item = (index: number) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.22, delay: Math.min(index, 12) * 0.035 } });

function Tile({ label, value, icon, tone, index }: { label: string; value: number; icon: string; tone?: string; index: number }) {
  const shown = useCountUp(value);
  return (
    <m.li className={`ov-tile${tone ? ` ${tone}` : ''}`} {...item(index)}>
      <span className="ov-tile-icon" aria-hidden="true"><Icon name={icon} /></span>
      <span className="ov-tile-value" aria-hidden="true">{shown}</span>
      <span className="ov-tile-label" aria-hidden="true">{label}</span>
      <span className="sr-only">{value} {label}</span>
    </m.li>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading overview">
      <ul className="ov-tiles">{Array.from({ length: 7 }, (_, i) => <li key={i} className="ov-tile skeleton" aria-hidden="true"><span className="skeleton-line" /></li>)}</ul>
      <div className="ov-columns"><div className="ov-panel skeleton" /><div className="ov-panel skeleton" /></div>
    </div>
  );
}

export function ProjectOverviewSection({ projectId, canManage, isMember, boardsExist }: { projectId: string; canManage: boolean; isMember: boolean; boardsExist: boolean }) {
  const overview = useProjectOverview(projectId);
  const [allPeople, setAllPeople] = useState(false);
  const data: ProjectOverview | undefined = overview.data;
  return (
    <section className="ov" aria-labelledby="ovTitle">
      <div className="ov-head">
        <h2 id="ovTitle">Overview</h2>
        {data && <span className="ov-asof">Open boards only · as of {new Date(`${data.asOfDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}
      </div>
      {overview.isPending && <Skeleton />}
      {overview.isError && (
        <div className="note warn" role="alert"><Icon name="alert" /><span>{describeError(overview.error)} <button className="btn sm" type="button" onClick={() => void overview.refetch()}>Try again</button></span></div>
      )}
      {data && data.readableBoardCount === 0 && (
        <div className="ph-board-empty ov-empty">
          <span className="ph-board-empty-icon" aria-hidden="true"><Icon name="lock" /></span>
          <div>
            <h3>{canManage ? 'No open boards' : 'You don’t have access to any board yet'}</h3>
            <p>{canManage ? (boardsExist ? 'Counts appear here once a board is open.' : 'Counts appear here once the project has a board.') : 'Ask the project Owner to give you access to a board. Counts only cover boards you can open.'}</p>
          </div>
        </div>
      )}
      {data && data.readableBoardCount > 0 && (
        <>
          <ul className="ov-tiles" aria-label="Card counts">
            <Tile index={0} icon="board" label="Active cards" value={data.cards.active} />
            <Tile index={1} icon="list" label="To do" value={data.cards.byCategory.todo} />
            <Tile index={2} icon="activity" label="In progress" value={data.cards.byCategory.active} />
            <Tile index={3} icon="check" label="Done" value={data.cards.byCategory.done} tone="good" />
            <Tile index={4} icon="alert" label="Overdue" value={data.cards.overdue} tone={data.cards.overdue ? 'bad' : undefined} />
            <Tile index={5} icon="calendar" label="Due in 7 days" value={data.cards.dueSoon} tone={data.cards.dueSoon ? 'warn' : undefined} />
            <Tile index={6} icon="users" label="Unassigned" value={data.cards.unassignedOpen} />
          </ul>
          <div className="ov-progress">
            <span className="ov-progress-bar" role="img" aria-label={`${data.cards.byCategory.done} of ${data.cards.active} active cards done`}><i style={{ width: `${data.cards.active ? Math.round((data.cards.byCategory.done / data.cards.active) * 100) : 0}%` }} /></span>
            <span className="ov-progress-text"><strong>{data.cards.byCategory.done} of {data.cards.active}</strong> done{data.cards.active ? ` · ${Math.round((data.cards.byCategory.done / data.cards.active) * 100)}%` : ''}</span>
          </div>
          {isMember && (
            <p className="ov-shortcut"><Link className="btn" href="/my-tasks?due=overdue"><Icon name="alert" />My overdue cards</Link></p>
          )}
          <div className="ov-columns">
            <section className="ov-panel" aria-labelledby="ovPeople">
              <h3 id="ovPeople">Open cards per person</h3>
              {data.assignees.length === 0 ? <p className="ov-none">No open cards are assigned.</p> : (
                <ul className="ov-people">
                  {(allPeople ? data.assignees : data.assignees.slice(0, 8)).map((person, index) => (
                    <m.li key={person.userId} {...item(index)}>
                      <Avatar id={person.userId} name={person.displayName} />
                      <span className="ov-person-name">{person.displayName}</span>
                      <span className="ov-bar" aria-hidden="true"><i style={{ width: `${Math.max(6, (person.openCount / data.assignees[0]!.openCount) * 100)}%` }} /></span>
                      <strong>{person.openCount}</strong>
                    </m.li>
                  ))}
                </ul>
              )}
              {data.assignees.length > 8 && <button className="btn sm" type="button" aria-expanded={allPeople} onClick={() => setAllPeople((v) => !v)}>{allPeople ? 'Show fewer' : `Show ${data.assignees.length - 8} more`}</button>}
            </section>
            <section className="ov-panel" aria-labelledby="ovActivity">
              <h3 id="ovActivity">Recent activity</h3>
              {data.recentActivity.length === 0 ? <p className="ov-none">Nothing has happened yet.</p> : (
                <ul className="ov-activity">
                  {data.recentActivity.map((row, index) => {
                    const view = describeActivity({ action: row.action, safeChanges: {} }, 'a card');
                    return (
                      <m.li key={row.id} {...item(index)}>
                        <span className="ov-act-icon" aria-hidden="true"><Icon name={view.icon} /></span>
                        <span><strong>{row.actor.displayName}</strong> {view.text}</span>
                        <time dateTime={row.createdAt}>{relativeTime(row.createdAt)}</time>
                      </m.li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
