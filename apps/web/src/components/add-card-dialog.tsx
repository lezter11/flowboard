'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus, X } from 'lucide-react';
import { MOCK_BOARDS, MOCK_PEOPLE, type MockCard } from '@/lib/mock-data';

interface Props { isOpen: boolean; onClose: () => void; onAddCard: (card: MockCard) => void; activeBoardId: string; portalContainer?: HTMLElement | null }
type Priority = 'low' | 'medium' | 'high' | 'urgent';
type Column = MockCard['columnId'];
const editableBoards = MOCK_BOARDS.filter((board) => board.id !== 'unified');

export function AddCardDialog({ isOpen, onClose, onAddCard, activeBoardId, portalContainer }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [columnId, setColumnId] = useState<Column>('col_todo');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const priorityRef = useRef<HTMLSelectElement>(null);
  const board = editableBoards.find((item) => item.id === activeBoardId);

  useEffect(() => { if (isOpen) setError(''); }, [isOpen]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!board) { setError('Choose an individual board before creating a card.'); return; }
    if (!title.trim() || title.trim().length > 200) { setError('Enter a title with 1 to 200 characters.'); titleRef.current?.focus(); return; }
    if (!priority) { setError('Choose Low, Medium, High, or Urgent priority.'); priorityRef.current?.focus(); return; }
    if (description.length > 20000) { setError('Description must be 20,000 characters or fewer.'); return; }
    const now = new Date().toISOString();
    const keyPrefix = board.id === 'board_dev' ? 'DEV' : board.id === 'board_ops' ? 'OPS' : 'MKT';
    const card: MockCard = { id: crypto.randomUUID(), key: `${keyPrefix}-PREVIEW`, title: title.trim(), description: description.trim(), boardId: board.id, boardName: board.name, columnId, priority, dueDate: dueDate || null, assigneeIds, commentCount: 0, imageCount: 0, createdAt: now, updatedAt: now };
    onAddCard(card);
    setTitle(''); setDescription(''); setPriority(''); setDueDate(''); setAssigneeIds([]); setColumnId('col_todo'); setError(''); onClose();
  };
  const toggleAssignee = (id: string) => setAssigneeIds((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]);
  return <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal container={portalContainer ?? undefined}><Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[min(95vw,36rem)] max-h-[90dvh] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl"><div className="flex items-center justify-between border-b border-line pb-3"><Dialog.Title className="text-lg font-bold text-ink flex items-center gap-2"><Plus className="w-5 h-5 text-accent" />Add card to preview</Dialog.Title><Dialog.Close asChild><button type="button" aria-label="Close add card dialog" className="rounded-lg p-2 text-muted hover:bg-surface-3 focus-visible:outline-2"><X className="w-5 h-5" /></button></Dialog.Close></div><Dialog.Description className="mt-3 text-xs text-muted">This card stays in this browser session. It is not saved to the Flowboard server.</Dialog.Description><form noValidate onSubmit={submit} className="mt-4 space-y-4 text-xs"><div><label htmlFor="new-title" className="block mb-1 font-semibold text-ink">Title *</label><input ref={titleRef} id="new-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} aria-invalid={!!error && !title.trim()} aria-describedby={error ? 'new-card-error' : undefined} placeholder="What needs to be done?" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent" /></div><div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label htmlFor="new-board" className="block mb-1 font-semibold text-ink">Board</label><input id="new-board" value={board?.name ?? 'Unavailable'} readOnly className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink" /></div><div><label htmlFor="new-column" className="block mb-1 font-semibold text-ink">Initial column</label><select id="new-column" value={columnId} onChange={(event) => setColumnId(event.target.value as Column)} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink"><option value="col_todo">To Do</option><option value="col_progress">In Progress</option><option value="col_done">Done</option></select></div></div><div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label htmlFor="new-priority" className="block mb-1 font-semibold text-ink">Priority *</label><select ref={priorityRef} id="new-priority" value={priority} onChange={(event) => { setPriority(event.target.value as Priority | ''); setError(''); }} aria-invalid={!!error && !priority} aria-describedby={error ? 'new-card-error' : undefined} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink"><option value="">Choose priority</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div><div><label htmlFor="new-due" className="block mb-1 font-semibold text-ink">Due date</label><input id="new-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink" /></div></div><fieldset><legend className="font-semibold text-ink mb-1">Assignees in preview</legend><div className="flex flex-wrap gap-2">{Object.values(MOCK_PEOPLE).filter((person) => person.role !== 'Viewer').map((person) => <button key={person.id} type="button" aria-pressed={assigneeIds.includes(person.id)} onClick={() => toggleAssignee(person.id)} className={`rounded-full border px-2.5 py-1.5 focus-visible:outline-2 ${assigneeIds.includes(person.id) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:bg-surface-2'}`}>{person.name}</button>)}</div></fieldset><div><label htmlFor="new-description" className="block mb-1 font-semibold text-ink">Description</label><textarea id="new-description" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={20000} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink resize-none focus-visible:outline-2" /></div>{error && <p id="new-card-error" role="alert" className="text-danger text-xs">{error}</p>}<div className="flex justify-end gap-2 border-t border-line pt-3"><button type="button" onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-muted hover:bg-surface-2">Keep draft and close</button><button type="submit" className="rounded-lg bg-accent px-4 py-2 font-semibold text-[var(--accent-ink)] hover:bg-accent-hover">Add to preview</button></div></form></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
