'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import * as m from 'motion/react-m';
import { useReducedMotion } from 'motion/react';
import type { CardSummary } from '@flowboard/contracts';
import { BoardCard } from '@/components/board/board-card';
import { Icon } from '@/components/ui/icon';
import { Wordmark } from '@/components/ui/wordmark';
import { PREVIEW_COLUMNS, PREVIEW_COUNTS, PREVIEW_PEOPLE, buildPreviewCards } from './preview-data';

type Order = Record<string, string[]>;
interface Over { columnId: string; index: number }

const SPRING = { type: 'spring', stiffness: 520, damping: 42, mass: 0.7 } as const;
const MOUSE_SLOP = 5;
const TOUCH_HOLD_MS = 320;
const TOUCH_SLOP = 10;
const DEMO_CYCLES = 2;
const noop = () => {};

const columnName = (id: string) => PREVIEW_COLUMNS.find((column) => column.id === id)?.name ?? id;
const locate = (order: Order, id: string): { columnId: string; index: number } | null => {
  for (const column of PREVIEW_COLUMNS) {
    const index = order[column.id]!.indexOf(id);
    if (index >= 0) return { columnId: column.id, index };
  }
  return null;
};
const relocate = (order: Order, id: string, to: Over): Order => {
  const next: Order = Object.fromEntries(PREVIEW_COLUMNS.map((column) => [column.id, order[column.id]!.filter((cardId) => cardId !== id)]));
  const list = next[to.columnId]!;
  list.splice(Math.max(0, Math.min(to.index, list.length)), 0, id);
  return next;
};
const sleep = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

/**
 * Sample board for the sign-in page. Cards are the real BoardCard (preview mode) inside the real .board/.column
 * markup, so they cannot drift from the app. All state is local; nothing is requested or stored.
 */
export function BoardPreview() {
  const reduced = useReducedMotion() ?? false;
  const [data, setData] = useState<ReturnType<typeof buildPreviewCards> | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [drag, setDrag] = useState<{ id: string; width: number } | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [demoOn, setDemoOn] = useState(false);
  const [entered, setEntered] = useState(false);

  const boardRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const orderRef = useRef<Order | null>(null);
  const overRef = useRef<Over | null>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const pickedFrom = useRef<{ id: string; at: Over } | null>(null);
  const refocusId = useRef<string | null>(null);
  const stopDemo = useRef(false);
  const demoDragging = useRef(false);
  const pending = useRef<{ id: string; pointerId: number; type: string; x: number; y: number; timer: number | null } | null>(null);

  orderRef.current = order;

  useEffect(() => {
    const built = buildPreviewCards();
    setData(built);
    setOrder(built.order);
    const timer = window.setTimeout(() => setEntered(true), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  const commit = useCallback((next: Order) => { orderRef.current = next; setOrder(next); }, []);
  const interact = useCallback(() => { stopDemo.current = true; setDemoOn(false); }, []);

  // ---- hit testing --------------------------------------------------------------------------------------------
  const hit = useCallback((x: number, y: number, ignoreId: string): Over | null => {
    const board = boardRef.current;
    if (!board) return null;
    const columns = Array.from(board.querySelectorAll<HTMLElement>('.column'));
    let best: HTMLElement | null = null;
    let bestGap = Infinity;
    for (const column of columns) {
      const rect = column.getBoundingClientRect();
      const gap = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
      if (gap < bestGap) { best = column; bestGap = gap; }
    }
    if (!best || bestGap > 80) return null;
    const columnId = best.dataset.columnId!;
    const others = Array.from(best.querySelectorAll<HTMLElement>('.preview-card')).filter((el) => el.dataset.cardId !== ignoreId);
    const index = others.filter((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 < y; }).length;
    return { columnId, index };
  }, []);

  const setOverBoth = useCallback((next: Over | null) => {
    const prev = overRef.current;
    if (prev?.columnId === next?.columnId && prev?.index === next?.index) return;
    overRef.current = next;
    setOver(next);
  }, []);

  const placeGhost = useCallback(() => {
    const ghost = ghostRef.current;
    const info = dragRef.current;
    if (!ghost || !info) return;
    ghost.style.transform = `translate3d(${pointerRef.current.x - info.dx}px, ${pointerRef.current.y - info.dy}px, 0) rotate(1.5deg)`;
  }, []);

  // ---- drag core (shared by pointer drag and the demo) -------------------------------------------------------
  const beginDrag = useCallback((id: string, x: number, y: number) => {
    const el = boardRef.current?.querySelector<HTMLElement>(`.preview-card[data-card-id="${id}"]`);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    dragRef.current = { id, dx: x - rect.left, dy: y - rect.top };
    pointerRef.current = { x, y };
    setDrag({ id, width: rect.width });
    setOverBoth(hit(x, y, id));
    return true;
  }, [hit, setOverBoth]);

  const moveDrag = useCallback((x: number, y: number, autoscroll = false) => {
    const info = dragRef.current;
    if (!info) return;
    pointerRef.current = { x, y };
    placeGhost();
    setOverBoth(hit(x, y, info.id));
    const board = boardRef.current;
    if (autoscroll && board) {
      const rect = board.getBoundingClientRect();
      if (x < rect.left + 36) board.scrollLeft -= 14;
      else if (x > rect.right - 36) board.scrollLeft += 14;
    }
  }, [hit, placeGhost, setOverBoth]);

  const endDrag = useCallback((dropIt: boolean) => {
    const info = dragRef.current;
    if (!info) return;
    const target = overRef.current;
    dragRef.current = null;
    setDrag(null);
    setOverBoth(null);
    const current = orderRef.current;
    if (dropIt && target && current) {
      const from = locate(current, info.id);
      commit(relocate(current, info.id, target));
      const after = locate(orderRef.current!, info.id)!;
      if (!from || from.columnId !== after.columnId || from.index !== after.index) {
        setAnnounce(`${data?.cards.get(info.id)?.title ?? 'Card'} moved to ${columnName(after.columnId)}, position ${after.index + 1} of ${orderRef.current![after.columnId]!.length}.`);
      }
    }
  }, [commit, data, setOverBoth]);

  useLayoutEffect(() => { if (drag) placeGhost(); }, [drag, placeGhost]);

  // ---- pointer input (mouse, pen, touch) ---------------------------------------------------------------------
  const clearPending = useCallback(() => {
    const p = pending.current;
    if (p?.timer) window.clearTimeout(p.timer);
    pending.current = null;
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0) return;
    interact();
    if (demoDragging.current) { demoDragging.current = false; endDrag(false); }
    if (dragRef.current) return;
    clearPending();
    const touchLike = event.pointerType !== 'mouse';
    const state = { id, pointerId: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY, timer: null as number | null };
    pending.current = state;
    const start = () => {
      clearPending();
      if (!beginDrag(id, pointerRef.current.x, pointerRef.current.y)) return;
      window.addEventListener('touchmove', stopScroll, { passive: false });
    };
    const stopScroll = (e: TouchEvent) => { if (dragRef.current) e.preventDefault(); };
    pointerRef.current = { x: event.clientX, y: event.clientY };
    if (touchLike) state.timer = window.setTimeout(start, TOUCH_HOLD_MS);

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== state.pointerId) return;
      pointerRef.current = { x: e.clientX, y: e.clientY };
      if (dragRef.current) { moveDrag(e.clientX, e.clientY, true); return; }
      if (pending.current !== state) return;
      const distance = Math.hypot(e.clientX - state.x, e.clientY - state.y);
      if (touchLike) { if (distance > TOUCH_SLOP) { clearPending(); cleanup(); } } else if (distance > MOUSE_SLOP) start();
    };
    const finish = (dropIt: boolean) => { clearPending(); cleanup(); endDrag(dropIt); };
    const onUp = (e: PointerEvent) => { if (e.pointerId === state.pointerId) finish(true); };
    const onCancel = (e: PointerEvent) => { if (e.pointerId === state.pointerId) finish(false); };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') finish(false); };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchmove', stopScroll);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
  };

  // ---- keyboard: Space/Enter pick up, arrows move, Space/Enter drop, Escape cancels ----------------------------
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, id: string) => {
    const current = orderRef.current;
    if (!current || event.target !== event.currentTarget) return;
    interact();
    const at = locate(current, id)!;
    const title = data?.cards.get(id)?.title ?? 'Card';
    const describe = (place: { columnId: string; index: number }, next: Order) =>
      `${title}: ${columnName(place.columnId)}, position ${place.index + 1} of ${next[place.columnId]!.length}.`;

    if (picked !== id) {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        pickedFrom.current = { id, at };
        setPicked(id);
        setAnnounce(`Picked up ${describe(at, current)} Use the arrow keys to move it, Space or Enter to drop, Escape to cancel.`);
      }
      return;
    }

    const move = (to: Over) => {
      event.preventDefault();
      const next = relocate(current, id, to);
      commit(next);
      refocusId.current = id;
      const place = locate(next, id)!;
      setAnnounce(`Moved to ${describe(place, next)}`);
    };
    const columnIndex = PREVIEW_COLUMNS.findIndex((column) => column.id === at.columnId);
    if (event.key === 'ArrowRight' && columnIndex < PREVIEW_COLUMNS.length - 1) move({ columnId: PREVIEW_COLUMNS[columnIndex + 1]!.id, index: at.index });
    else if (event.key === 'ArrowLeft' && columnIndex > 0) move({ columnId: PREVIEW_COLUMNS[columnIndex - 1]!.id, index: at.index });
    else if (event.key === 'ArrowUp' && at.index > 0) move({ columnId: at.columnId, index: at.index - 1 });
    else if (event.key === 'ArrowDown' && at.index < current[at.columnId]!.length - 1) move({ columnId: at.columnId, index: at.index + 1 });
    else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      setPicked(null);
      pickedFrom.current = null;
      setAnnounce(`Dropped ${describe(at, current)}`);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      const origin = pickedFrom.current;
      if (origin) { const next = relocate(current, id, origin.at); commit(next); refocusId.current = id; }
      setPicked(null);
      pickedFrom.current = null;
      setAnnounce(`Move cancelled. ${title} is back in ${columnName(origin?.at.columnId ?? at.columnId)}.`);
    }
  };

  // Moving between columns remounts the card; give focus back to it.
  useLayoutEffect(() => {
    const id = refocusId.current;
    if (!id) return;
    refocusId.current = null;
    boardRef.current?.querySelector<HTMLElement>(`.preview-card[data-card-id="${id}"]`)?.focus({ preventScroll: true });
  }, [order]);

  // ---- ghost-cursor demo ---------------------------------------------------------------------------------------
  useEffect(() => {
    if (!order || reduced) return;
    stopDemo.current = false;
    let cancelled = false;
    const aborted = () => cancelled || stopDemo.current;
    const cursor = cursorRef.current;
    setDemoOn(true);

    const glide = (from: { x: number; y: number }, to: { x: number; y: number }, ms: number, frame: (x: number, y: number) => void) =>
      new Promise<boolean>((resolve) => {
        const t0 = performance.now();
        const step = (now: number) => {
          if (aborted()) { resolve(false); return; }
          const k = Math.min(1, (now - t0) / ms);
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          frame(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
          if (k < 1) requestAnimationFrame(step); else resolve(true);
        };
        requestAnimationFrame(step);
      });
    const showCursor = (x: number, y: number, on: boolean, pressed = false) => {
      if (!cursor) return;
      cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      cursor.classList.toggle('is-on', on);
      cursor.classList.toggle('is-pressed', pressed);
    };
    const cardPoint = (id: string) => {
      const rect = boardRef.current?.querySelector<HTMLElement>(`.preview-card[data-card-id="${id}"]`)?.getBoundingClientRect();
      return rect ? { x: rect.left + Math.min(70, rect.width / 3), y: rect.top + Math.min(46, rect.height / 3) } : null;
    };
    const columnPoint = (columnId: string) => {
      const rect = boardRef.current?.querySelector<HTMLElement>(`.column[data-column-id="${columnId}"] .column-cards`)?.getBoundingClientRect();
      return rect ? { x: rect.left + Math.min(110, rect.width / 2), y: rect.top + 28 } : null;
    };

    const dragCard = async (id: string, toColumn: string, toIndex: number) => {
      const start = cardPoint(id);
      const target = columnPoint(toColumn);
      if (!start || !target) return false;
      const board = boardRef.current!.getBoundingClientRect();
      const from = { x: board.right - 60, y: board.bottom - 40 };
      showCursor(from.x, from.y, true);
      if (!(await glide(from, start, 900, (x, y) => showCursor(x, y, true)))) return false;
      showCursor(start.x, start.y, true, true);
      await sleep(180);
      if (aborted() || !beginDrag(id, start.x, start.y)) return false;
      demoDragging.current = true;
      const finished = await glide(start, { x: target.x, y: target.y + toIndex * 4 }, 1100, (x, y) => { showCursor(x, y, true, true); moveDrag(x, y); });
      if (!finished) { if (demoDragging.current) { demoDragging.current = false; endDrag(false); } return false; }
      await sleep(160);
      demoDragging.current = false;
      endDrag(true);
      showCursor(target.x, target.y, true, false);
      await sleep(700);
      showCursor(target.x, target.y, false);
      return !aborted();
    };

    (async () => {
      await sleep(2200);
      for (let cycle = 0; cycle < DEMO_CYCLES && !aborted(); cycle += 1) {
        if (!(await dragCard('sample-web-107', 'progress', 1))) break;
        await sleep(1100);
        if (!(await dragCard('sample-web-107', 'backlog', 1))) break;
        await sleep(1600);
      }
      if (!cancelled) {
        showCursor(0, 0, false);
        setDemoOn(false);
      }
    })();

    return () => {
      cancelled = true;
      if (demoDragging.current) { demoDragging.current = false; endDrag(false); }
      showCursor(0, 0, false);
    };
    // The demo starts once, when the sample cards exist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order === null, reduced]);

  useEffect(() => () => clearPending(), [clearPending]);

  const cards = data?.cards;
  const dragged = drag ? cards?.get(drag.id) : undefined;
  const label = (card: CardSummary, columnId: string, index: number, count: number) => {
    const who = PREVIEW_PEOPLE.get(card.assigneeIds[0]!)?.displayName ?? 'Unassigned';
    return `${card.title}. ${card.priority} priority. Owner ${who}. ${card.commentCount} comments. In ${columnName(columnId)}, position ${index + 1} of ${count}.`;
  };

  return (
    <aside className="signin-showcase" aria-label="Sample board preview, not your data" onPointerDownCapture={interact}>
      <div className="showcase-topline">
        <span className="showcase-brand"><Wordmark inline /></span>
        <span className="showcase-topline-end">
          {demoOn && <button className="preview-pause" type="button" onClick={interact}>Pause demo</button>}
          <span className="showcase-tag">Sample data</span>
        </span>
      </div>

      <figure className="showcase-board preview">
        <figcaption className="showcase-board-head">
          <div>
            <p className="showcase-project">Launch plan</p>
            <h2>Team board</h2>
          </div>
          <span className="preview-private"><Icon name="lock" />Private to 5 invited people</span>
        </figcaption>

        <div className="board preview-board" data-card-style="focus" ref={boardRef} id="previewBoard" aria-describedby="previewHint">
          {PREVIEW_COLUMNS.map((column) => {
            const ids = order?.[column.id] ?? [];
            const others = ids.filter((id) => id !== drag?.id);
            const isTarget = over?.columnId === column.id;
            const lineBefore = isTarget && over ? others[over.index] ?? null : null;
            const lineAtEnd = isTarget && over ? over.index >= others.length : false;
            const line = <div className="drop-line" aria-hidden="true" />;
            const count = order ? ids.length : PREVIEW_COUNTS[column.id] ?? 0;
            return (
              <section key={column.id} className={`column${isTarget ? ' is-drop-target' : ''}`} data-column-id={column.id} data-tone={column.tone} aria-labelledby={`previewCol-${column.id}`}>
                <header className="column-head">
                  <span className="column-dot" aria-hidden="true" />
                  <h3 className="column-title" id={`previewCol-${column.id}`}>{column.name}</h3>
                  <span className="column-count" aria-label={`${count} cards`}>{count}</span>
                </header>
                <div className="column-body">
                  <div className="column-cards" data-drop-zone={column.id}>
                    {ids.map((id, index) => {
                      const card = cards?.get(id);
                      if (!card) return null;
                      return (
                        <m.div
                          key={id}
                          layout="position"
                          layoutId={`preview-${id}`}
                          className={`preview-card${picked === id ? ' is-picked' : ''}${entered || reduced ? '' : ' is-entering'}`}
                          data-card-id={id}
                          tabIndex={0}
                          role="group"
                          aria-roledescription="draggable card"
                          aria-label={label(card, column.id, index, ids.length)}
                          style={{ ['--i' as string]: index + (column.id === 'backlog' ? 0 : column.id === 'progress' ? 2 : column.id === 'testing' ? 4 : 5) }}
                          transition={{ layout: SPRING }}
                          onPointerDown={(event) => onPointerDown(event, id)}
                          onKeyDown={(event) => onKeyDown(event, id)}
                          onBlur={(event) => { if (picked === id && event.relatedTarget && !boardRef.current?.contains(event.relatedTarget as Node)) { setPicked(null); pickedFrom.current = null; } }}
                        >
                          {lineBefore === id && line}
                          <BoardCard card={card} done={column.done} view="board" cardStyle="focus" people={PREVIEW_PEOPLE} canMove={false} draggable={false} dragging={drag?.id === id} onOpen={noop} onMove={noop} onDragStart={noop} onDragEnd={noop} preview />
                        </m.div>
                      );
                    })}
                    {lineAtEnd && line}
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        <p className="preview-hint" id="previewHint">Try it: drag a card to another column. With a keyboard, focus a card, press Space, move it with the arrow keys, then press Space to drop or Escape to cancel.</p>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announce}</div>
      </figure>

      <div className="preview-ghost" ref={ghostRef} aria-hidden="true" hidden={!dragged} style={drag ? { width: drag.width } : undefined}>
        {dragged && <div className="board preview-board"><BoardCard card={dragged} done={false} view="board" cardStyle="focus" people={PREVIEW_PEOPLE} canMove={false} draggable={false} dragging={false} onOpen={noop} onMove={noop} onDragStart={noop} onDragEnd={noop} preview /></div>}
      </div>
      <div className="preview-cursor" ref={cursorRef} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2.5 19.5 12l-6.7 1.4 3.7 6.7-2.9 1.6-3.7-6.7L4 18.2Z" fill="#fff" stroke="#1b1720" strokeWidth="1.6" strokeLinejoin="round" /></svg>
      </div>
    </aside>
  );
}
