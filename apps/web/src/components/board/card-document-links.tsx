'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { cardDocumentLinkSchema, cardDocumentLinksSchema, MAX_CARD_DOCUMENT_LINKS, type CardDocumentLink } from '@flowboard/contracts';
import { Icon } from '@/components/ui/icon';

interface Props {
  links: CardDocumentLink[];
  editable: boolean;
  disabled: boolean;
  onChange: (links: CardDocumentLink[]) => void;
}

function documentType(url: string): string {
  const address = new URL(url);
  if (address.hostname === 'drive.google.com') return 'Google Drive file';
  if (address.pathname.startsWith('/spreadsheets/')) return 'Google Sheets';
  return 'Google Docs';
}

export function CardDocumentLinks({ links, editable, disabled, onChange }: Props) {
  const id = useId();
  const addButton = useRef<HTMLButtonElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const displayed = links.flatMap((link) => {
    const parsed = cardDocumentLinkSchema.safeParse(link);
    return parsed.success ? [parsed.data] : [];
  });
  const full = links.length >= MAX_CARD_DOCUMENT_LINKS;

  useEffect(() => {
    if (adding && editable) titleInput.current?.focus();
    if (!editable) {
      setAdding(false);
      setTitle('');
      setUrl('');
      setError('');
    }
  }, [adding, editable]);

  const closeForm = () => {
    setAdding(false);
    setTitle('');
    setUrl('');
    setError('');
    addButton.current?.focus();
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!editable || disabled || full) return;
    const entry = cardDocumentLinkSchema.safeParse({ title, url });
    if (!entry.success) {
      setError(entry.error.issues[0]?.message ?? 'Enter a name and a Google Drive file link.');
      return;
    }
    const next = cardDocumentLinksSchema.safeParse([...links, entry.data]);
    if (!next.success) {
      setError(next.error.issues[0]?.message ?? 'Check the link and try again.');
      return;
    }
    onChange(next.data);
    closeForm();
  };

  if (!editable && !displayed.length) return null;
  return (
    <section className="detail-section document-links" aria-labelledby={`${id}-heading`}>
      <div className="section-head">
        <h2 id={`${id}-heading`}>Documents</h2>
        {editable && <button ref={addButton} type="button" className="btn sm" aria-expanded={adding} disabled={disabled || full} onClick={() => adding ? closeForm() : setAdding(true)}><Icon name="plus" />Add link</button>}
      </div>
      {displayed.length > 0 && <ul className="document-link-list">
        {displayed.map((link) => <li key={link.url} className="document-link-row">
          <a className="document-link" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${link.title} (opens in a new tab)`}>
            <span className="document-link-icon"><Icon name="file" /></span>
            <span className="document-link-copy"><strong>{link.title}</strong><span>{documentType(link.url)}</span></span>
            <Icon name="external" className="document-link-external" />
          </a>
          {editable && <button type="button" className="icon-btn" disabled={disabled} aria-label={`Remove link ${link.title}`} onClick={() => onChange(links.filter((entry) => entry.url !== link.url))}><Icon name="x" /></button>}
        </li>)}
      </ul>}
      {editable && full && <p className="hint">This card has {MAX_CARD_DOCUMENT_LINKS} links. Remove a link to add another.</p>}
      {editable && adding && !full && <form className="document-link-form" onSubmit={add} onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        closeForm();
      }}>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-title`}>Document name</label>
          <input className="control" id={`${id}-title`} ref={titleInput} value={title} maxLength={100} required disabled={disabled} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-url`}>Google Drive link</label>
          <input className="control" id={`${id}-url`} type="url" value={url} maxLength={2000} required disabled={disabled} onChange={(event) => setUrl(event.target.value)} />
        </div>
        <p className="hint">Share the file with teammates in Google Drive first. Use Save changes to keep your links on the card.</p>
        {error && <p className="field-note" role="alert">{error}</p>}
        <div className="document-link-actions">
          <button type="button" className="btn sm ghost" onClick={closeForm}>Cancel</button>
          <button type="submit" className="btn sm primary" disabled={disabled}>Add to card</button>
        </div>
      </form>}
    </section>
  );
}
