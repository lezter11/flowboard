'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Board } from '@flowboard/contracts';
import { Icon } from '@/components/ui/icon';
import { MAX_BOARDS, clearSelection, selectAll, toggleBoard } from '@/lib/board-selection';

/**
 * Boards dropdown: a disclosure panel, not an ARIA menu, because each row has two actions (switch to just this board,
 * tick it into the combined view). Tab/Shift+Tab and Space work natively; Up/Down also move between the controls, Escape
 * closes and returns focus to the button. Only boards the list already returned (so ones the user has a grant for) appear.
 */
export function BoardSwitcher({ boards, selected, onSwitch, onChange }: { boards: Board[]; selected: string[]; onSwitch: (id: string) => void; /** Receives an updater so quick successive clicks build on each other, not on a stale URL. */ onChange: (update: (previous: string[]) => string[]) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const open_ = boards.filter((b) => !b.isArchived);
  const capped = selected.length >= MAX_BOARDS;

  const close = useCallback((returnFocus: boolean) => {
    // Focus first, then hide: a hidden control cannot keep focus, and waiting a frame can lose it.
    if (returnFocus) buttonRef.current?.focus({ preventScroll: true });
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onFocusOut = (event: FocusEvent) => { if (event.relatedTarget instanceof Node && !rootRef.current?.contains(event.relatedTarget)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    const root = rootRef.current;
    root?.addEventListener('focusout', onFocusOut);
    return () => { document.removeEventListener('mousedown', onDown); root?.removeEventListener('focusout', onFocusOut); };
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(true); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('.board-switcher-panel button:not(:disabled), .board-switcher-panel input:not(:disabled)') ?? []);
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className="board-switcher" ref={rootRef} onKeyDown={onKeyDown}>
      <button ref={buttonRef} className={`filter-btn board-switcher-btn${selected.length > 1 ? ' has-active' : ''}`} type="button" aria-expanded={open} aria-controls={panelId} aria-haspopup="true" aria-label={selected.length > 1 ? `Boards, ${selected.length} selected` : 'Boards'} title="Switch boards" onClick={() => setOpen((v) => !v)}>
        <Icon name="board" />
        <span className="board-switcher-label">Boards</span>
        {selected.length > 1 && <span className="badge">{selected.length}</span>}
        <Icon name="chevron-down" className="icon-sm" />
      </button>
      <div className="board-switcher-panel" id={panelId} hidden={!open} role="group" aria-label="Boards in this project">
        <p className="board-switcher-hint" id={`${panelId}-hint`}>Click a name to open just that board. Tick several to merge them into one board, matched by column name.</p>
        <ul className="board-switcher-list">
          {open_.map((board) => {
            const checked = selected.includes(board.id);
            const only = checked && selected.length === 1;
            const blocked = !checked && capped;
            return (
              <li key={board.id} className={`board-switcher-row${selected.length === 1 && checked ? ' is-current' : ''}`}>
                <input type="checkbox" id={`${panelId}-${board.id}`} checked={checked} disabled={only || blocked} aria-label={`Include ${board.name} in the merged view`} aria-describedby={blocked ? `${panelId}-cap` : only ? `${panelId}-one` : undefined} onChange={() => onChange((prev) => toggleBoard(prev, board.id))} />
                <button type="button" className="board-switcher-name" aria-current={selected.length === 1 && checked ? 'true' : undefined} onClick={() => { onSwitch(board.id); close(true); }}>{board.name}</button>
              </li>
            );
          })}
        </ul>
        {capped && <p className="board-switcher-hint" id={`${panelId}-cap`}>You can show up to {MAX_BOARDS} boards at once. Untick one to add another.</p>}
        {selected.length === 1 && <p className="board-switcher-hint" id={`${panelId}-one`} hidden>At least one board stays on screen.</p>}
        <div className="board-switcher-foot">
          <button type="button" className="btn sm" onClick={() => onChange((prev) => selectAll(boards, prev))}>Select all{open_.length > MAX_BOARDS ? ` (first ${MAX_BOARDS})` : ''}</button>
          <button type="button" className="btn sm ghost" disabled={selected.length <= 1} onClick={() => onChange((prev) => clearSelection(prev))}>Clear</button>
        </div>
      </div>
    </div>
  );
}
