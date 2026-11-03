'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BoardSnapshotData } from '@flowboard/contracts';
import { useSession } from '@/lib/session';
import { useMemoryValue, useMemoryDirty } from '@/lib/use-memory-draft';
import { api } from '@/lib/api';
import { describeError, isStale } from '@/lib/errors';
import { COLUMN_TONES, toneFor } from '@/lib/board-model';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toasts';

type Category = 'todo' | 'active' | 'done';
const CATEGORIES: Array<{ value: Category; label: string }> = [{ value: 'todo', label: 'To do' }, { value: 'active', label: 'In progress' }, { value: 'done', label: 'Done' }];
const MAX_COLUMNS = 12;
const AUTO = 'auto';
type Draft = { name: string; category: Category; color: string; expectedVersion:number };

/**
 * Column editor for Owner and Manager: add, rename, recolour, change category, reorder (buttons, so no dragging is needed) and delete.
 * Every change is its own call with expectedBoardVersion read from the freshest board in the cache; after each call the board is
 * refetched so the next one uses the new structureVersion. A stale version reloads the board and keeps the dialog open.
 */
export function ColumnsDialog({ boardId, open, onClose, readOnly = false }: { readOnly?: boolean; boardId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const snapshot = queryClient.getQueryData<BoardSnapshotData>(['board', boardId]);
  const columns = [...(snapshot?.columns ?? [])].sort((a, b) => a.position - b.position);
  const {state}=useSession();const actorId=state.status==='ready'?state.session.actor.id:'';const scope=['columns',actorId,boardId];
  const [drafts,setDrafts]=useMemoryValue<Record<string,Draft>>([...scope,'drafts'],{});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [newName,setNewName]=useMemoryValue([...scope,'new-name'],'');
  const [newCategory,setNewCategory]=useMemoryValue<Category>([...scope,'new-category'],'todo');
  const [newColor,setNewColor]=useMemoryValue([...scope,'new-color'],AUTO);
  const [, bump] = useState(0);

  // The dialog re-renders when the board query changes; this keeps the cached snapshot read fresh.
  // Deferred and only while open: the cache notifies during other components' renders, and a direct setState there triggers React's warning.
  useEffect(() => (open ? queryClient.getQueryCache().subscribe(() => queueMicrotask(() => bump((n) => n + 1))) : undefined), [queryClient, open]);
  useEffect(()=>{if(open){setError('');setConfirming(null);}},[open]);

  const draftOf = (id: string): Draft => {
    const column = columns.find((c) => c.id === id)!;
    return drafts[id] ?? { name: column.name, category: column.category as Category, color: COLUMN_TONES.some((t) => t.value === column.color) ? column.color : AUTO, expectedVersion:snapshot?.board.structureVersion??0 };
  };
  const setDraft = (id: string, patch: Partial<Draft>) => { setError(''); setDrafts((d) => ({ ...d, [id]: { ...draftOf(id), ...patch } })); };
  const isDirty = (id: string) => {
    const column = columns.find((c) => c.id === id);
    if (!column || !drafts[id]) return false;
    const d = drafts[id]!;
    const currentColor = COLUMN_TONES.some((t) => t.value === column.color) ? column.color : AUTO;
    return d.name.trim() !== column.name || d.category !== column.category || d.color !== currentColor;
  };

  const dirty=!!newName||newCategory!=='todo'||newColor!==AUTO||Object.keys(drafts).some((id)=>!columns.some((c)=>c.id===id)||isDirty(id));
  const clearDirty=useMemoryDirty([...scope,'dirty'],dirty);
  const version = () => queryClient.getQueryData<BoardSnapshotData>(['board', boardId])?.board.structureVersion ?? 0;
  const run = async (action: () => Promise<unknown>, done: string) => {
    if (busy || readOnly || !actorId) return false;
    setBusy(true); setError('');
    try { await action(); await queryClient.refetchQueries({ queryKey: ['board', boardId] }); toast(done, { icon: 'check' }); return true; }
    catch (err) {
      if (isStale(err)) { await queryClient.refetchQueries({ queryKey: ['board', boardId] }); setConfirming(null); setError('Someone else changed these columns. Your draft is kept. Review the current columns before reapplying.'); }
      else setError(describeError(err));
      return false;
    } finally { setBusy(false); }
  };

  const save = (id: string) => {
    const d = draftOf(id); const column = columns.find((c) => c.id === id)!;
    if (!d.name.trim()) { setError('Enter a column name.'); return; }
    const color = d.color === AUTO ? undefined : d.color;
    void run(() => api.updateColumn(boardId, id, {
      ...(d.name.trim() !== column.name ? { name: d.name.trim() } : {}),
      ...(d.category !== column.category ? { category: d.category } : {}),
      ...(color && color !== column.color ? { color } : {}),
      ...(d.color === AUTO && COLUMN_TONES.some((t) => t.value === column.color) ? { color: '#64748b' } : {}),
      expectedBoardVersion: d.expectedVersion,
    }), 'Column saved').then((ok) => { if (ok) setDrafts((all) => { const { [id]: _gone, ...rest } = all; return rest; }); });
  };
  const move = (id: string, delta: -1 | 1) => {
    const ids = columns.map((c) => c.id); const at = ids.indexOf(id); const to = at + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to]!, ids[at]!];
    void run(() => api.reorderColumns(boardId, { columnIds: ids, expectedBoardVersion: version() }), 'Column moved');
  };
  const remove = (id: string) => void run(() => api.deleteColumn(boardId, id, { expectedBoardVersion: version() }), 'Column deleted').then(() => setConfirming(null));
  const add = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) { setError('Enter a column name.'); return; }
    if (name.length > 80) { setError('Column names can be up to 80 characters.'); return; }
    const ok = await run(() => api.createColumn(boardId, { name, category: newCategory, color: newColor === AUTO ? '#64748b' : newColor, expectedBoardVersion: version() }), 'Column added');
    if (ok) { setNewName('');setNewCategory('todo');setNewColor(AUTO); }
  };

  const full = columns.length >= MAX_COLUMNS;
  return (
    <DialogLayer open={open} onClose={onClose} labelledBy="columnsTitle" className="wide cols-dialog">
      <div className="dialog-head">
        <div className="dialog-head-copy"><h2 id="columnsTitle">Edit columns</h2><p>{columns.length} of {MAX_COLUMNS} columns. Owner and Manager only. Changes save one at a time.</p></div>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Close edit columns dialog"><Icon name="x" /></button>
      </div>
      <div className="dialog-body col-editor">
        <p className="field-help">Closing keeps column drafts in this tab.</p>
        {Object.entries(drafts).filter(([id])=>!columns.some((c)=>c.id===id)).map(([id,draft])=><p className="note" key={id}>Saved draft for a column no longer listed: {draft.name}. Copy its text into an existing or new column, or <button className="btn sm" type="button" onClick={()=>setDrafts((all)=>{const next={...all};delete next[id];return next;})}>Discard this column draft</button>.</p>)}
        {readOnly && <p className="hint" role="status">This board is read-only. Column drafts are kept; changes cannot be saved.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <fieldset disabled={readOnly||busy||!actorId} style={{border:0,padding:0,margin:0,minWidth:0}}><ol className="col-editor-list" aria-label="Columns, in board order">
          {columns.map((column, index) => {
            const d = draftOf(column.id);
            return (
              <li key={column.id} className="col-editor-row">
                <span className="column-dot" style={{ background: `var(--dot-${toneFor({ name: d.name, category: d.category, color: d.color === AUTO ? null : d.color })})` }} aria-hidden="true" />
                <label className="sr-only" htmlFor={`colName-${column.id}`}>Name of column {index + 1}</label>
                <input className="control" id={`colName-${column.id}`} type="text" maxLength={80} autoComplete="off" value={d.name} onChange={(e) => setDraft(column.id, { name: e.target.value })} />
                <label className="sr-only" htmlFor={`colCat-${column.id}`}>Category of {column.name}</label>
                <select className="control" id={`colCat-${column.id}`} value={d.category} onChange={(e) => setDraft(column.id, { category: e.target.value as Category })}>
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <label className="sr-only" htmlFor={`colColor-${column.id}`}>Colour of {column.name}</label>
                <select className="control" id={`colColor-${column.id}`} value={d.color} onChange={(e) => setDraft(column.id, { color: e.target.value })}>
                  <option value={AUTO}>Automatic</option>
                  {COLUMN_TONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {drafts[column.id]&&d.expectedVersion!==version()&&<p className="hint">The board changed. Current column: {column.name} · {column.category} · {column.color}. <button className="btn sm" type="button" onClick={()=>setDrafts((all)=>({...all,[column.id]:{...d,expectedVersion:version()}}))}>Use latest version, keep this draft</button></p>}
                <span className="col-editor-actions">
                  {isDirty(column.id) && <button className="btn sm primary" type="button" disabled={readOnly || busy || d.expectedVersion!==version()} onClick={() => save(column.id)}>Save</button>}
                  <button className="icon-btn" type="button" aria-label={`Move ${column.name} earlier`} title="Move earlier" disabled={readOnly || busy || index === 0} onClick={() => move(column.id, -1)}><Icon name="chevron-up" /></button>
                  <button className="icon-btn" type="button" aria-label={`Move ${column.name} later`} title="Move later" disabled={readOnly || busy || index === columns.length - 1} onClick={() => move(column.id, 1)}><Icon name="chevron-down" /></button>
                  <button className="icon-btn" type="button" aria-label={`Delete ${column.name}`} title="Delete column" disabled={readOnly || busy} onClick={() => setConfirming(confirming === column.id ? null : column.id)}><Icon name="trash" /></button>
                </span>
                {confirming === column.id && (
                  <p className="col-editor-confirm" role="group" aria-label={`Confirm deleting ${column.name}`}>
                    <span>Delete <strong>{column.name}</strong>? {column.activeCardCount > 0 ? `It holds ${column.activeCardCount} card${column.activeCardCount === 1 ? '' : 's'}; the server only allows deleting an empty column, so move them first.` : 'This cannot be undone.'}</span>
                    <button className="btn sm danger" type="button" disabled={readOnly || busy} onClick={() => remove(column.id)}>Delete column</button>
                    <button className="btn sm" type="button" onClick={() => setConfirming(null)}>Keep</button>
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <form className="col-editor-add" onSubmit={add} noValidate>
          <h3>Add a column</h3>
          {full ? <p className="field-optional">This board has the maximum of {MAX_COLUMNS} columns. Delete an empty column to add another.</p> : (
            <div className="col-editor-row is-new">
              <label className="sr-only" htmlFor="newColName">New column name</label>
              <input className="control" id="newColName" type="text" maxLength={80} autoComplete="off" placeholder="Column name" value={newName} onChange={(e) => { setError(''); setNewName(e.target.value); }} />
              <label className="sr-only" htmlFor="newColCat">New column category</label>
              <select className="control" id="newColCat" value={newCategory} onChange={(e) => setNewCategory(e.target.value as Category)}>{CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
              <label className="sr-only" htmlFor="newColColor">New column colour</label>
              <select className="control" id="newColColor" value={newColor} onChange={(e) => setNewColor(e.target.value)}><option value={AUTO}>Automatic</option>{COLUMN_TONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
              <button className="btn primary" type="submit" disabled={readOnly || busy}><Icon name="plus" />Add column</button>
            </div>
          )}
        </form></fieldset>
      </div>
      <footer className="dialog-foot">{dirty&&<button className="btn" type="button" disabled={busy} onClick={()=>{setDrafts({});setNewName('');setNewCategory('todo');setNewColor(AUTO);clearDirty();}}>Discard column drafts</button>}<span className="spacer" /><button className="btn" type="button" onClick={onClose}>Done</button></footer>
    </DialogLayer>
  );
}
