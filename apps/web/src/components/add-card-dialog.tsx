'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus, X } from 'lucide-react';
import type { ColumnSummary, PersonDisplay } from '@flowboard/contracts';
import { api } from '@/lib/api';
import { describeError, isStale } from '@/lib/errors';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  boardId: string;
  columns: ColumnSummary[];
  people: PersonDisplay[];
  structureVersion: number;
  onCreated: () => void;
  onStale: () => void;
}

type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent';

export function AddCardDialog({ isOpen, onClose, boardId, columns, people, structureVersion, onCreated, onStale }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [columnId, setColumnId] = useState(columns[0]?.id ?? '');
  const [priority, setPriority] = useState<Priority>('none');
  const [dueDate, setDueDate] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  // One key per drafted card: a retry after a network drop replays instead of duplicating.
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const assignable = people.filter((p) => p.activeInProject && p.assignable !== false);

  useEffect(() => { if (isOpen) setError(''); }, [isOpen]);
  useEffect(() => { if (!columns.some((c) => c.id === columnId)) setColumnId(columns[0]?.id ?? ''); }, [columns, columnId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || title.trim().length > 200) { setError('Enter a title with 1 to 200 characters.'); titleRef.current?.focus(); return; }
    if (!columnId) { setError('Choose a column.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.createCard(boardId, {
        title: title.trim(),
        description: description.trim(),
        priority,
        columnId,
        dueDate: dueDate || null,
        assigneeIds,
        expectedBoardVersion: structureVersion,
      }, idempotencyKey.current);
      setTitle(''); setDescription(''); setPriority('none'); setDueDate(''); setAssigneeIds([]);
      idempotencyKey.current = crypto.randomUUID();
      onCreated();
      onClose();
    } catch (err) {
      if (isStale(err)) { onStale(); onClose(); } else setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleAssignee = (id: string) => setAssigneeIds((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content onOpenAutoFocus={(event) => { event.preventDefault(); titleRef.current?.focus(); }} className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[min(95vw,36rem)] max-h-[90dvh] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <Dialog.Title className="text-lg font-bold text-ink flex items-center gap-2"><Plus className="w-5 h-5 text-accent" />Add card</Dialog.Title>
            <Dialog.Close asChild><button type="button" aria-label="Close add card dialog" className="rounded-lg p-2 text-muted hover:bg-surface-3 focus-visible:outline-2"><X className="w-5 h-5" /></button></Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Create a card on this board.</Dialog.Description>
          <form noValidate onSubmit={submit} className="mt-4 space-y-4 text-xs">
            <div>
              <label htmlFor="new-title" className="block mb-1 font-semibold text-ink">Title *</label>
              <input ref={titleRef} id="new-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} aria-describedby={error ? 'new-card-error' : undefined} placeholder="What needs to be done?" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="new-column" className="block mb-1 font-semibold text-ink">Column</label>
                <select id="new-column" value={columnId} onChange={(e) => setColumnId(e.target.value)} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink">
                  {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="new-priority" className="block mb-1 font-semibold text-ink">Priority</label>
                <select id="new-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink">
                  <option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label htmlFor="new-due" className="block mb-1 font-semibold text-ink">Due date</label>
                <input id="new-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink" />
              </div>
            </div>
            {assignable.length > 0 && (
              <fieldset>
                <legend className="font-semibold text-ink mb-1">Assignees</legend>
                <div className="flex flex-wrap gap-2">
                  {assignable.map((p) => (
                    <button key={p.id} type="button" aria-pressed={assigneeIds.includes(p.id)} onClick={() => toggleAssignee(p.id)} className={`rounded-full border px-2.5 py-1.5 focus-visible:outline-2 ${assigneeIds.includes(p.id) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:bg-surface-2'}`}>{p.displayName}</button>
                  ))}
                </div>
              </fieldset>
            )}
            <div>
              <label htmlFor="new-description" className="block mb-1 font-semibold text-ink">Description</label>
              <textarea id="new-description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={20000} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink resize-none focus-visible:outline-2" />
            </div>
            {error && <p id="new-card-error" role="alert" className="text-danger text-xs">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <button type="button" onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-muted hover:bg-surface-2">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-accent px-4 py-2 font-semibold text-[var(--accent-ink)] hover:bg-accent-hover disabled:opacity-50">{saving ? 'Adding...' : 'Add card'}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
