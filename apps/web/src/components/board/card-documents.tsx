'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_CARD_DOCUMENTS, MAX_DOCUMENT_BYTES, documentFilenameSchema, type CardDocument } from '@flowboard/contracts';
import { usePollKeys } from '@/components/polling';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { ErrorNote } from '@/components/ui/error-note';
import { Icon } from '@/components/ui/icon';
import { api, ApiError } from '@/lib/api';
import { discardRefusedRows } from '@/lib/feed-state';
import { describeFailure } from '@/lib/errors';
import { useSession } from '@/lib/session';

interface UploadAttempt { file: File; key: string }
interface RemovalAttempt { document: CardDocument; key: string }

const documentSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

function uploadError(error: unknown) {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'PAYLOAD_TOO_LARGE': return 'Choose a document up to 1 MB.';
      case 'DOCUMENT_TOO_LARGE':
      case 'UNSUPPORTED_DOCUMENT':
      case 'DOCUMENT_REJECTED':
      case 'DOCUMENT_LIMIT_REACHED':
      case 'DOCUMENT_UPLOAD_IN_PROGRESS':
      case 'DOCUMENT_PROCESSOR_UNAVAILABLE':
      case 'RATE_LIMITED': return describeFailure(error).body;
    }
    if ([401, 403, 404].includes(error.status)) return 'You no longer have permission to add a document to this card.';
    if (!mayRetryUpload(error)) return 'This file couldn’t be added. Reload the card or choose another file.';
  }
  return 'The upload could not be confirmed. Retry this file to check the original request.';
}

function mayRetryUpload(error: unknown) {
  return !(error instanceof ApiError) || error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500 || error.code === 'DOCUMENT_UPLOAD_IN_PROGRESS';
}

export function CardDocuments({ cardId }: { cardId: string }) {
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  return <DocumentList key={JSON.stringify([state.session.actor.id, cardId])} actorId={state.session.actor.id} cardId={cardId} />;
}

function DocumentList({ actorId, cardId }: { actorId: string; cardId: string }) {
  const client = useQueryClient();
  const key = useMemo(() => ['card-documents', cardId, actorId] as const, [actorId, cardId]);
  const list = useQuery({ queryKey: key, queryFn: async ({ signal }) => (await api.listCardDocuments(cardId, signal)).data, retry: false });
  const unavailable = list.error instanceof ApiError && list.error.code === 'CONFIG_ERROR';
  const denied = list.error instanceof ApiError && [401, 403, 404].includes(list.error.status);
  usePollKeys([key], !unavailable && !denied);
  useEffect(() => { discardRefusedRows(client, key, list.error); }, [client, key, list.error]);

  const input = useRef<HTMLInputElement>(null);
  const heading = useId();
  const removeTitle = useId();
  const removeCopy = useId();
  const [attempt, setAttempt] = useState<UploadAttempt | null>(null);
  const [removing, setRemoving] = useState<RemovalAttempt | null>(null);
  const [uploadNote, setUploadNote] = useState('');
  const [removeError, setRemoveError] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);

  const canUpload = list.isSuccess && list.data.canUpload;
  const items = list.isSuccess ? list.data.items : [];
  const removeTarget = removing && items.find(item => item.id === removing.document.id && item.canRemove);

  useEffect(() => {
    if (denied || unavailable) {
      setAttempt(null);
      setRemoving(null);
      setUploadNote('');
      setRemoveError(null);
    }
  }, [denied, unavailable]);

  async function refresh() {
    await client.invalidateQueries({ queryKey: key, exact: true });
    void client.invalidateQueries({ queryKey: ['card-activity', cardId, actorId], exact: true });
  }

  async function upload(original: UploadAttempt) {
    if (!canUpload || checking) return;
    setAttempt(original);
    setUploadNote('');
    setChecking(true);
    try {
      await api.uploadCardDocument(cardId, original.file, original.key);
      setAttempt(null);
      await refresh();
    } catch (error) {
      setUploadNote(uploadError(error));
      if (!mayRetryUpload(error)) setAttempt(null);
      await refresh();
    } finally { setChecking(false); }
  }

  function choose(file: File) {
    if (!documentFilenameSchema.safeParse(file.name).success) { setUploadNote('Choose a PDF, Word (.docx), or Excel (.xlsx) file.'); return; }
    if (file.size === 0 || file.size > MAX_DOCUMENT_BYTES) { setUploadNote('Choose a document up to 1 MB.'); return; }
    void upload({ file, key: crypto.randomUUID() });
  }

  async function remove() {
    if (!removing || !removeTarget || removeBusy) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await api.removeCardDocument(removing.document.id, removing.key);
      setRemoving(null);
      await refresh();
    } catch (error) {
      setRemoveError(error);
      await refresh();
    } finally { setRemoveBusy(false); }
  }

  if (unavailable || denied || (list.isSuccess && !items.length && !canUpload)) return null;
  return (
    <section className="detail-section" aria-labelledby={heading}>
      <div className="section-head"><h2 id={heading}>Documents</h2></div>
      {list.isPending && <p className="hint" role="status">Loading documents…</p>}
      {list.isError && <ErrorNote error={list.error} onRetry={() => void list.refetch()} />}
      {items.length > 0 && <ul className="document-list">
        {items.map(document => <li className="document-row" key={document.id}>
          <span className="document-name">{document.filename}</span>
          <span className="count">{documentSize(document.byteLength)}</span>
          <a className="btn sm" href={`/api/v1/documents/${encodeURIComponent(document.id)}/content`} download={document.filename} aria-label={`Download ${document.filename}`}><Icon name="download" />Download</a>
          {document.canRemove && <button type="button" className="icon-btn" aria-label={`Remove ${document.filename}`} onClick={() => { setRemoveError(null); setRemoving({ document, key: crypto.randomUUID() }); }}><Icon name="trash" /></button>}
        </li>)}
      </ul>}
      {canUpload && <div className="document-actions">
        <button className="btn sm" type="button" onClick={() => input.current?.click()} disabled={checking || !!attempt || items.length >= MAX_CARD_DOCUMENTS}><Icon name="upload" />Add document</button>
        <input ref={input} type="file" accept=".pdf,.docx,.xlsx" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) choose(file); }} />
        <span className="hint">{items.length >= MAX_CARD_DOCUMENTS ? `This card has ${MAX_CARD_DOCUMENTS} documents.` : 'PDF, Word (.docx), or Excel (.xlsx) · up to 1 MB each'}</span>
      </div>}
      {checking && <p className="hint" role="status">Checking document…</p>}
      {uploadNote && <ErrorNote text={uploadNote}>
        {attempt && canUpload && <div className="document-actions">
          <button className="btn sm" type="button" disabled={checking} onClick={() => void upload(attempt)}>Retry this file</button>
          <button className="btn ghost sm" type="button" disabled={checking} onClick={() => { setAttempt(null); setUploadNote(''); input.current?.click(); }}>Choose another file</button>
        </div>}
      </ErrorNote>}
      <DialogLayer open={!!removeTarget} onClose={() => { if (!removeBusy) setRemoving(null); }} labelledBy={removeTitle} describedBy={removeCopy} role="alertdialog">
        <div className="dialog-head"><h2 id={removeTitle}>Remove this document?</h2></div>
        <div className="dialog-body">
          <p className="confirm-copy" id={removeCopy}>“{removeTarget?.filename}” will be removed from this card.</p>
          {removeError != null && <ErrorNote error={removeError} />}
        </div>
        <footer className="dialog-foot"><span className="spacer" /><button className="btn" type="button" data-autofocus disabled={removeBusy} onClick={() => setRemoving(null)}>Keep document</button><button type="button" className="btn danger" disabled={removeBusy} onClick={() => void remove()}>{removeBusy ? 'Removing…' : 'Remove document'}</button></footer>
      </DialogLayer>
    </section>
  );
}
