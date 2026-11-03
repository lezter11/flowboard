'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PersonDisplay } from '@flowboard/contracts';
import { api, ApiError } from '@/lib/api';
import { activeTrigger, applyMention, backspaceMention, finalizeMentions, highlight, rankPeople, shiftMentions, type Trigger } from '@/lib/mentions';
import { isComposingInput, type ComposerDraft } from '@/lib/comment-state';
import { mentionCandidates, mentionEmptyText } from '@/lib/mention-ui';
import { formatPersonName, personAria } from '@/lib/person-name';
import { normalizeRole, ROLE_META } from '@/lib/roles';
import { Icon } from '@/components/ui/icon';
import { Avatar } from '@/components/ui/avatar';
import { ErrorNote } from '@/components/ui/error-note';

interface Props {
  cardId: string; projectId: string; actorId: string; draft: ComposerDraft;
  onChange: (draft: ComposerDraft) => void; onSubmit: () => void;
  busy: boolean; unresolved: boolean; writable: boolean; error: unknown;
  editing?: boolean; onCancel?: () => void;
}

export function CommentComposer({ cardId, projectId, actorId, draft, onChange, onSubmit, busy, unresolved, writable, error, editing, onCancel }: Props) {
  const { body, mentions } = draft;
  const id = useId(); const inputId = `${id}-input`; const listId = `${id}-list`;
  const input = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [picker, setPicker] = useState<{ trigger: Trigger; caret: number } | null>(null);
  const [active, setActive] = useState(0);
  const locked = busy || unresolved || !writable;
  const mentionPeople = useQuery({
    queryKey: ['project-people', projectId, 'mention', cardId, actorId],
    queryFn: async () => (await api.listProjectPeople(projectId, 'mention', { cardId })).data,
    enabled: writable, staleTime: 60_000,
    retry: (count, error) => !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 1,
  });
  const candidates = useMemo(() => mentionCandidates(mentionPeople.data), [mentionPeople.data]);
  const candidateNames = useMemo(() => candidates.map((p) => formatPersonName(p)), [candidates]);
  const matches = useMemo(() => picker ? rankPeople(candidates, picker.trigger.query) : [], [candidates, picker]);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    const caret = pendingCaret.current; pendingCaret.current = null;
    input.current?.focus(); input.current?.setSelectionRange(caret, caret);
  }, [body]);
  const refreshPicker = (text: string, caret: number) => {
    if (locked) { setPicker(null); return; }
    const trigger = activeTrigger(text, caret, candidateNames);
    setPicker(trigger ? { trigger, caret } : null); setActive(0);
  };
  const changeText = (text: string, caret: number) => {
    onChange({ body: text, mentions: shiftMentions(body, text, mentions) }); refreshPicker(text, caret);
  };
  const choose = (person: PersonDisplay) => {
    if (!picker || locked) return;
    const next = applyMention(body, picker.trigger, picker.caret, { id: person.id, displayName: formatPersonName(person) });
    pendingCaret.current = next.caret;
    onChange({ body: next.text, mentions: [...shiftMentions(body, next.text, mentions), next.mention] }); setPicker(null);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingInput(event.nativeEvent)) return;
    if (locked) return;
    if (event.key === 'Backspace' && event.currentTarget.selectionStart === event.currentTarget.selectionEnd) {
      const removed = backspaceMention(body, event.currentTarget.selectionStart, mentions);
      if (removed) { event.preventDefault(); pendingCaret.current = removed.caret; onChange({ body: removed.text, mentions: shiftMentions(body, removed.text, mentions) }); setPicker(null); return; }
    }
    if (!picker) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPicker(null); }
    else if (matches.length && event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => (i + 1) % matches.length); }
    else if (matches.length && event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => (i - 1 + matches.length) % matches.length); }
    else if (matches.length && (event.key === 'Enter' || event.key === 'Tab')) { event.preventDefault(); choose(matches[Math.min(active, matches.length - 1)]!); }
  };
  const startMention = () => {
    const el = input.current; if (!el || locked) return;
    const caret = el.selectionStart; const space = caret > 0 && !/\s/.test(body[caret - 1]!);
    const text = `${body.slice(0, caret)}${space ? ' ' : ''}@${body.slice(el.selectionEnd)}`;
    pendingCaret.current = caret + (space ? 2 : 1); changeText(text, pendingCaret.current);
  };
  const count = new Set(finalizeMentions(body, mentions).mentions.map((m) => m.userId)).size;
  return (
    <div className="composer" aria-busy={busy}>
      <label className="sr-only" htmlFor={inputId}>{editing ? 'Edit your comment' : 'Write a comment'}</label>
      <div className="composer-field">
        <textarea id={inputId} ref={input} placeholder="Write a comment… type @ to mention someone" maxLength={10000} value={body} readOnly={locked}
          role="combobox" aria-autocomplete="list" aria-expanded={!!picker} aria-controls={picker ? listId : undefined}
          aria-activedescendant={picker && matches.length ? `${listId}-${Math.min(active, matches.length - 1)}` : undefined}
          aria-describedby={`${id}-note`} onChange={(event) => changeText(event.target.value, event.target.selectionStart)} onKeyDown={onKeyDown}
          onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) refreshPicker(body, event.currentTarget.selectionStart); }}
          onClick={(event) => refreshPicker(body, event.currentTarget.selectionStart)} onBlur={() => setPicker(null)} />
        {picker && (
          <ul className="mention-list" id={listId} role="listbox" aria-label="People you can mention" onMouseDown={(event) => event.preventDefault()}>
            {!matches.length && <li role="presentation" className="mention-none">{mentionEmptyText({ loading: mentionPeople.isPending, failed: mentionPeople.isError, candidates, actorId, typed: picker.trigger.query })}</li>}
            {matches.map((person, index) => {
              const roleLabel = ROLE_META[normalizeRole(person.scopedRole)].label;
              return <li key={person.id} id={`${listId}-${index}`} role="option" aria-label={personAria(person, roleLabel)} aria-selected={index === active} className={`mention-option${index === active ? ' is-active' : ''}`} onClick={() => choose(person)} onMouseEnter={() => setActive(index)}>
                <Avatar id={person.id} name={formatPersonName(person)} avatarUrl={person.avatarUrl} /><span className="mention-name">{highlight(formatPersonName(person), picker.trigger.query).map((part, i) => part.hit ? <b key={i}>{part.text}</b> : <span key={i}>{part.text}</span>)}</span><small>{roleLabel}</small>
              </li>;
            })}
          </ul>
        )}
        <span className="sr-only" role="status" aria-live="polite">{picker && matches.length ? `${matches.length} people found` : ''}</span>
      </div>
      <p className="hint" id={`${id}-note`}>{editing ? 'Editing does not send new mention notifications.' : count ? `${count} ${count === 1 ? 'person will' : 'people will'} be notified.` : 'Post is separate from card Save. Drafts stay in this tab when you switch cards or projects.'}</p>
      {mentionPeople.isError && <p className="hint">Could not load mention candidates. <button className="btn sm" type="button" onClick={() => void mentionPeople.refetch()}>Retry people</button></p>}
      {unresolved && <p className="hint" role="status">The server may have saved this. Retry the original request before editing; it will not post twice.</p>}
      {error != null && <ErrorNote error={error} focusOnMount />}
      <div className="composer-actions">
        <button className="composer-tool" type="button" disabled={locked} onClick={startMention}><Icon name="at" />Mention</button><span className="spacer" />
        {onCancel && <button className="btn ghost sm" type="button" disabled={busy || unresolved} onClick={onCancel}>Discard comment edit</button>}
        <button className="btn primary sm" type="button" disabled={!body.trim() || busy || !writable} onClick={onSubmit}>{busy ? 'Saving…' : unresolved ? 'Retry original request' : editing ? 'Save comment' : 'Post comment'}</button>
      </div>
    </div>
  );
}
