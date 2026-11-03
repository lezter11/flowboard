'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CardSummary, ColumnSummary, PlacementInput } from '@flowboard/contracts';
import { api, ApiError } from '@/lib/api';
import { useCursorFeed } from '@/lib/cursor-feed';
import { usePollKeys } from '@/components/polling';
import { describeError } from '@/lib/errors';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { ErrorNote } from '@/components/ui/error-note';
import { Icon } from '@/components/ui/icon';
import { toneFor } from '@/lib/board-model';

interface Props {
  card: CardSummary | null;
  boardId: string;
  columns: ColumnSummary[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (card: CardSummary, toColumnId: string, placement: PlacementInput) => Promise<void>;
}

/** Every position is resolved by the server; reference cards are unfiltered, paginated and confined to the source board. */
export function MoveDialog(props: Props) {
  if (!props.card) return null;
  return <MoveDialogBody key={props.card.id} {...props} card={props.card} />;
}

function MoveDialogBody({ card, boardId, columns, busy, onClose, onConfirm }: Omit<Props, 'card'> & { card: CardSummary }) {
  const [dest, setDest] = useState(card.columnId);
  const [at, setAt] = useState<PlacementInput['at']>('last');
  const [anchor, setAnchor] = useState('');
  const [error, setError] = useState<unknown>(null);
  const queryClient = useQueryClient();
  const needsAnchor = at === 'before' || at === 'after';
  const key = useMemo(() => ['placement-cards', boardId, dest, card.id, card.version] as const, [boardId, dest, card.id, card.version]);
  const references = useCursorFeed<CardSummary>(key, (cursor, signal) => api.listBoardCards(boardId, { columnId: dest, limit: 50, cursor }, signal), needsAnchor);
  usePollKeys([key], needsAnchor);
  const current = columns.find((column) => column.id === card.columnId);
  const stale = !!references.error && 'code' in references.error && references.error.code === 'STALE_CURSOR';
  const unavailable = references.error instanceof ApiError && [401, 403, 404].includes(references.error.status);
  const cards = unavailable ? [] : references.items.filter((candidate) => candidate.id !== card.id);
  const selected = cards.some((candidate) => candidate.id === anchor);
  const submit = async () => {
    if (busy || unavailable || (needsAnchor && !selected)) return;
    setError(null);
    try { await onConfirm(card, dest, { movingCardId: card.id, at, ...(needsAnchor ? { anchorCardId: anchor } : {}) }); }
    catch (failure) { setError(failure); }
  };
  return <DialogLayer open onClose={() => { if (!busy) onClose(); }} labelledBy="moveTitle" describedBy="moveDesc">
    <header className="dialog-head"><div className="dialog-head-copy"><h2 id="moveTitle">Move card</h2><p id="moveDesc">Choose a column and a position in this card’s own board. Confirm to save.</p></div><button className="dialog-close" type="button" disabled={busy} onClick={onClose} aria-label="Close move dialog"><Icon name="x" /></button></header>
    <div className="dialog-body">
      <div className="move-card-preview"><strong>{card.title}</strong>{current && <span className="badge">{current.name}</span>}</div>
      <div className="radio-list" role="radiogroup" aria-label="Destination column">
        {columns.map((column) => <label key={column.id} className={`radio-row${column.id === dest ? ' is-selected' : ''}`}>
          <input type="radio" name="moveDest" value={column.id} checked={column.id === dest} disabled={busy} onChange={() => { setDest(column.id); setAnchor(''); setError(null); }} data-autofocus={column.id === card.columnId || undefined} />
          <span className="column-dot" style={{ background: `var(--dot-${toneFor(column)})` }} aria-hidden="true" /><span>{column.name}</span><span className="count">{Math.max(0, column.activeCardCount - (column.id === card.columnId ? 1 : 0))} other cards</span><span className="check"><Icon name="check" /></span>
        </label>)}
      </div>
      <div className="dialog-field"><label htmlFor="movePosition">Position</label><select className="control" id="movePosition" value={at} disabled={busy} onChange={(event) => { setAt(event.target.value as PlacementInput['at']); setError(null); }}>
        <option value="first">First in column</option><option value="last">Last in column</option><option value="before">Before a card</option><option value="after">After a card</option>
      </select></div>
      {needsAnchor && <div className="dialog-field">
        <label htmlFor="moveReference">Reference card</label><select className="control" id="moveReference" value={anchor} disabled={busy || !!unavailable} onChange={(event) => { setAnchor(event.target.value); setError(null); }}><option value="">Choose a reference card</option>{cards.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.key ? `${candidate.key} · ` : ''}{candidate.title}</option>)}</select>
        <p className="hint" role="status">{references.isPending ? 'Loading reference cards…' : `${cards.length} reference cards loaded${references.hasNextPage ? ' · More available' : ''}. This list ignores board filters.`}</p>
        {references.isError && <ErrorNote text={stale ? 'The destination changed. Reload references; your move choices are kept.' : describeError(references.error)} />}
        {stale ? <button className="btn sm" type="button" disabled={busy} onClick={() => { setAnchor(''); void queryClient.resetQueries({ queryKey: key, exact: true }); }}>Reload reference cards</button>
          : references.hasNextPage && <button className="btn sm" type="button" disabled={busy || references.isFetching} onClick={() => void references.fetchNextPage()}>{references.isFetchingNextPage ? 'Loading references…' : 'Load more reference cards'}</button>}
        {references.isError && !stale && !unavailable && <button className="btn sm" type="button" disabled={busy || references.isFetching} onClick={() => void (references.isFetchNextPageError ? references.fetchNextPage() : references.refetch())}>Retry reference cards</button>}
      </div>}
      {error != null && <ErrorNote text={`${describeError(error)} Your choices are kept. If the card changed, close and reopen Move to review its current position before trying again.`} focusOnMount />}
    </div>
    <div className="dialog-note"><Icon name="info" />Click/tap and keyboard alternative to dragging. The server checks the full column’s actual neighbors.</div>
    <footer className="dialog-foot"><span className="spacer" /><button className="btn" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="btn primary" type="button" disabled={busy || !!unavailable || (needsAnchor && (!selected || stale || references.isPending))} onClick={() => void submit()}>{busy ? 'Moving…' : 'Move card'}</button></footer>
  </DialogLayer>;
}
