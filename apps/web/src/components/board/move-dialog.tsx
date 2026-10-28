'use client';

import { useState } from 'react';
import type { CardSummary, ColumnSummary } from '@flowboard/contracts';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { Icon } from '@/components/ui/icon';
import { toneFor } from '@/lib/board-model';

interface Props {
  card: CardSummary | null;
  columns: ColumnSummary[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (card: CardSummary, toColumnId: string, position: 'top' | 'bottom') => void;
}

/** Keyboard-friendly alternative to dragging (prototype #moveLayer). */
export function MoveDialog({ card, columns, busy, onClose, onConfirm }: Props) {
  if (!card) return null;
  return <MoveDialogBody key={card.id} card={card} columns={columns} busy={busy} onClose={onClose} onConfirm={onConfirm} />;
}

function MoveDialogBody({ card, columns, busy, onClose, onConfirm }: Omit<Props, 'card'> & { card: CardSummary }) {
  const [dest, setDest] = useState(card.columnId);
  const [position, setPosition] = useState<'top' | 'bottom'>('bottom');
  const current = columns.find((c) => c.id === card.columnId);
  return (
    <DialogLayer open onClose={onClose} labelledBy="moveTitle" describedBy="moveDesc">
      <header className="dialog-head">
        <div className="dialog-head-copy">
          <h2 id="moveTitle">Move card</h2>
          <p id="moveDesc">Choose a destination column. This is saved immediately and can be undone.</p>
        </div>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Close move dialog"><Icon name="x" /></button>
      </header>
      <div className="dialog-body">
        <div className="move-card-preview">
          <strong>{card.title}</strong>
          {current && <span className="badge">{current.name}</span>}
        </div>
        <div className="radio-list" role="radiogroup" aria-label="Destination column">
          {columns.map((column) => {
            const count = column.cards.filter((c) => c.id !== card.id).length;
            const checked = column.id === dest;
            return (
              <label key={column.id} className={`radio-row${checked ? ' is-selected' : ''}`}>
                <input type="radio" name="moveDest" value={column.id} checked={checked} onChange={() => setDest(column.id)} data-autofocus={column.id === card.columnId ? true : undefined} />
                <span className="column-dot" style={{ background: `var(--dot-${toneFor(column)})` }} aria-hidden="true" />
                <span>{column.name}</span>
                <span className="count">{count} card{count === 1 ? '' : 's'}</span>
                <span className="check"><Icon name="check" /></span>
              </label>
            );
          })}
        </div>
        <div className="dialog-field">
          <label htmlFor="movePosition">Position</label>
          <select className="control" id="movePosition" value={position} onChange={(event) => setPosition(event.target.value as 'top' | 'bottom')}>
            <option value="top">Top of column</option>
            <option value="bottom">Bottom of column</option>
          </select>
        </div>
      </div>
      <div className="dialog-note">
        <Icon name="info" />
        Keyboard-friendly alternative to dragging. Moving never changes a card&apos;s comments or images.
      </div>
      <footer className="dialog-foot">
        <span className="spacer" />
        <button className="btn" type="button" onClick={onClose}>Cancel</button>
        <button className="btn primary" type="button" disabled={busy} onClick={() => onConfirm(card, dest, position)}>Move card</button>
      </footer>
    </DialogLayer>
  );
}
