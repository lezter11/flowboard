'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FinalizedImage } from '@flowboard/contracts';
import { api, ApiError } from '@/lib/api';
import { describeError, describeUploadError } from '@/lib/errors';
import { browserEnv, prepareImage } from '@/lib/image-prepare';
import { createUploadStore, type UploadItem } from '@/lib/image-uploads';
import { can, type Role } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toasts';

const MAX_IMAGES = 10;
const ACCEPT = 'image/png,image/jpeg,image/webp';
/** The API's /thumbnail currently returns the full image (same bytes as /content), so one download serves tile and viewer. */
const imagesKey = (cardId: string) => ['card-images', cardId] as const;

// One queue for the whole app, so an upload survives the drawer re-mounting when the card's version changes.
let queryClientRef: ReturnType<typeof useQueryClient> | null = null;
const store = createUploadStore({
  prepare: (file) => prepareImage(file, browserEnv),
  createUpload: async (cardId, input, key) => (await api.createImageUpload(cardId, input as never, key)).data,
  putContent: (id, blob, opts) => api.putImageContent(id, blob, opts),
  finalize: (id, key) => api.finalizeImageUpload(id, key),
  cancel: (id) => api.cancelImageUpload(id),
  describe: describeUploadError,
  onFinalized: (cardId) => {
    void queryClientRef?.invalidateQueries({ queryKey: imagesKey(cardId) });
    void queryClientRef?.invalidateQueries({ queryKey: ['card', cardId] });
  },
});

const labelOf = (filename: string) => filename.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_-]+/g, ' ').trim() || 'Image';
const sizeOf = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Fetches a private image through the authenticated API and exposes it as an object URL that is revoked on cleanup. */
function useImageUrl(imageId: string, enabled: boolean) {
  const blob = useQuery({ queryKey: ['image-blob', imageId], queryFn: () => api.fetchImageBlob(imageId, 'content'), enabled, staleTime: Infinity, gcTime: 120_000, retry: (n, e) => !(e instanceof ApiError && [401, 403, 404].includes(e.status)) && n < 1 });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob.data) { setUrl(null); return; }
    const made = URL.createObjectURL(blob.data);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [blob.data]);
  return { url, error: blob.isError, loading: blob.isPending && enabled };
}

function Tile({ image, canRemove, onOpen, onRemove }: { image: FinalizedImage; canRemove: boolean; onOpen: () => void; onRemove: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current; if (!node) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setNear(true); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const { url, error, loading } = useImageUrl(image.id, near);
  const label = labelOf(image.filename);
  return (
    <li ref={ref} className="image-tile">
      <button type="button" className="image-open" onClick={onOpen} aria-label={`Open image ${label}`}>
        {url && <img src={url} alt={label} decoding="async" />}
        {!url && <span className="image-placeholder" aria-hidden="true">{error ? <Icon name="alert" /> : loading ? '' : <Icon name="image" />}</span>}
        <span className="image-shade" />
        <span className="image-lock"><Icon name="lock" />Private</span>
        <span className="image-label">{label}</span>
      </button>
      {error && <span className="image-error" role="status">Could not load</span>}
      {canRemove && <button className="image-remove" type="button" onClick={onRemove} aria-label={`Remove image ${label}`}><Icon name="x" /></button>}
    </li>
  );
}

function Lightbox({ images, index, onIndex, onClose }: { images: FinalizedImage[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const image = images[index]!;
  const { url, error, loading } = useImageUrl(image.id, true);
  const label = labelOf(image.filename);
  const go = (delta: number) => onIndex((index + delta + images.length) % images.length);
  return (
    <DialogLayer open onClose={onClose} labelledBy="lightboxTitle" className="lightbox">
      <div className="lightbox-body" onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } }}>
        <div className="lightbox-head">
          <div><h2 id="lightboxTitle">{label}</h2><p>{index + 1} of {images.length} · {sizeOf(image.byteLength)}{image.width && image.height ? ` · ${image.width}×${image.height}` : ''}</p></div>
          <button className="dialog-close" type="button" data-autofocus onClick={onClose} aria-label="Close image viewer"><Icon name="x" /></button>
        </div>
        <div className="lightbox-stage">
          {images.length > 1 && <button className="lightbox-nav prev" type="button" onClick={() => go(-1)} aria-label="Previous image"><Icon name="arrow-left" /></button>}
          {url && <img src={url} alt={label} />}
          {!url && <p role="status">{error ? 'This image could not be loaded.' : loading ? 'Loading…' : ''}</p>}
          {images.length > 1 && <button className="lightbox-nav next" type="button" onClick={() => go(1)} aria-label="Next image"><Icon name="arrow-right" /></button>}
        </div>
        <div className="lightbox-foot">{url && <a className="btn sm" href={url} download={image.filename}><Icon name="download" />Download</a>}<span className="hint"><Icon name="lock" />Private to this project. Use the arrow keys to move between images.</span></div>
      </div>
    </DialogLayer>
  );
}

/** Images section of the card drawer: gallery, upload queue, viewer and removal. */
export function CardImages({ cardId, role, count }: { cardId: string; role: Role; count: number }) {
  const queryClient = useQueryClient();
  queryClientRef = queryClient;
  const toast = useToast();
  const { state } = useSession();
  const actorId = state.status === 'ready' ? state.session.actor.id : '';
  const canUpload = can(role, 'edit');
  const privileged = role === 'owner' || role === 'manager';

  const list = useQuery({ queryKey: imagesKey(cardId), queryFn: async (): Promise<FinalizedImage[]> => {
      // The API answers {data:{items,...}} while the contract schema says {data:[...]}; accept both until they agree.
      const data = (await api.listCardImages(cardId)).data as unknown;
      return Array.isArray(data) ? (data as FinalizedImage[]) : ((data as { items?: FinalizedImage[] }).items ?? []);
    }, retry: false });
  const images = useMemo(() => list.data ?? [], [list.data]);
  const uploads = useSyncExternalStore((fn) => store.subscribe(cardId, fn), () => store.get(cardId), () => store.get(cardId));
  const [viewing, setViewing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<FinalizedImage | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [removeBusy, setRemoveBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const unavailable = list.error instanceof ApiError && list.error.status === 503 && list.error.code === 'CONFIG_ERROR';
  const total = images.length + uploads.filter((u) => u.status !== 'failed').length;
  const room = Math.max(0, MAX_IMAGES - total);

  const addFiles = useCallback((files: File[]) => {
    const list = files.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name));
    if (list.length === 0) { setNotice('Only PNG, JPEG and WebP images can be added.'); return; }
    const free = Math.max(0, MAX_IMAGES - (images.length + store.activeCount(cardId)));
    if (free === 0) { setNotice('This card already has 10 images. Remove one to add another.'); return; }
    const take = list.slice(0, free);
    setNotice(take.length < list.length ? `Only ${take.length} of ${list.length} images were added: a card holds at most 10.` : list.length < files.length ? 'Some files were skipped: only PNG, JPEG and WebP images can be added.' : '');
    store.add(cardId, take);
  }, [cardId, images.length]);

  // Paste an image from the clipboard while the drawer is open (not while typing text).
  useEffect(() => {
    if (!canUpload) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) return;
      event.preventDefault(); addFiles(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [canUpload, addFiles]);

  const onDrop = (event: DragEvent) => { event.preventDefault(); setDrag(false); addFiles(Array.from(event.dataTransfer.files)); };
  const confirmRemove = async () => {
    if (!removing) return;
    setRemoveBusy(true); setRemoveError('');
    try {
      await api.deleteImage(removing.id, removing.version);
      toast('Image removed', { icon: 'check' });
      setRemoving(null);
      await queryClient.invalidateQueries({ queryKey: imagesKey(cardId) });
      void queryClient.invalidateQueries({ queryKey: ['card', cardId] });
    } catch (error) {
      setRemoveError(describeError(error));
      void queryClient.invalidateQueries({ queryKey: imagesKey(cardId) });
    } finally { setRemoveBusy(false); }
  };

  const shownCount = list.isSuccess ? images.length : count;
  return (
    <section className="detail-section" aria-labelledby="imagesHeading">
      <div className="section-head"><h2 id="imagesHeading">Images</h2><span className="count" aria-label={`${shownCount} of ${MAX_IMAGES} images`}>{shownCount} / {MAX_IMAGES}</span></div>

      {canUpload && !unavailable && (
        <div
          className={`dropzone image-drop${drag ? ' is-dragover' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
        >
          <Icon name="upload" />
          <strong>Drop images here, paste, or</strong>
          <button className="btn sm" type="button" disabled={room === 0} onClick={() => input.current?.click()} title={room === 0 ? 'Remove an image before adding another' : undefined}>Choose images</button>
          <span>PNG, JPEG or WebP, up to 10 per card. Large photos are shrunk and re-saved before upload, which also removes camera and location data.</span>
          <input ref={input} className="sr-only" type="file" accept={ACCEPT} multiple tabIndex={-1} aria-label="Choose images to add" onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        </div>
      )}
      <p className="sr-only" role="status">{notice}</p>
      {notice && <p className="hint" aria-hidden="true"><Icon name="info" />{notice}</p>}

      {uploads.length > 0 && (
        <ul className="upload-list" aria-label="Images being added">
          {uploads.map((u) => <UploadRow key={u.id} item={u} onCancel={() => store.cancel(cardId, u.id)} onRetry={() => store.retry(cardId, u.id)} />)}
        </ul>
      )}

      {list.isPending && <p className="hint" role="status">Loading images…</p>}
      {list.isError && <p className="hint" role="alert"><Icon name="alert" />{unavailable ? 'Image uploads are not available right now.' : describeError(list.error)} {!unavailable && <button className="btn sm" type="button" onClick={() => void list.refetch()}>Try again</button>}</p>}
      {list.isSuccess && images.length === 0 && uploads.length === 0 && (
        <div className="image-empty"><Icon name="image" /><strong>No images yet</strong><span>{canUpload ? 'Add screenshots or photos for this card. They stay private to the project.' : 'Nothing has been attached to this card.'}</span></div>
      )}
      {images.length > 0 && (
        <ul className="image-grid" aria-label="Card images">
          {images.map((image, i) => (
            <Tile key={image.id} image={image} canRemove={canUpload && (privileged || image.uploaderId === actorId)} onOpen={() => setViewing(i)} onRemove={() => { setRemoveError(''); setRemoving(image); }} />
          ))}
        </ul>
      )}

      {viewing !== null && images[viewing] && <Lightbox images={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />}
      <DialogLayer open={!!removing} onClose={() => { if (!removeBusy) setRemoving(null); }} labelledBy="removeImageTitle" describedBy="removeImageCopy" role="alertdialog">
        <div className="dialog-head"><div className="dialog-head-copy"><h2 id="removeImageTitle">Remove this image?</h2></div></div>
        <div className="dialog-body">
          <p id="removeImageCopy" className="confirm-copy">“{removing ? labelOf(removing.filename) : ''}” is deleted from this card and from storage. This cannot be undone.</p>
          {removeError && <p className="form-error" role="alert">{removeError}</p>}
        </div>
        <footer className="dialog-foot"><span className="spacer" /><button className="btn" type="button" data-autofocus onClick={() => setRemoving(null)} disabled={removeBusy}>Keep image</button><button className="btn danger" type="button" onClick={() => void confirmRemove()} disabled={removeBusy}>{removeBusy ? 'Removing…' : 'Remove image'}</button></footer>
      </DialogLayer>
    </section>
  );
}

const STATUS_TEXT: Record<UploadItem['status'], string> = { optimising: 'Optimising…', staging: 'Preparing upload…', uploading: 'Uploading…', validating: 'Checking the image…', failed: 'Not added' };

function UploadRow({ item, onCancel, onRetry }: { item: UploadItem; onCancel: () => void; onRetry: () => void }) {
  const failed = item.status === 'failed';
  return (
    <li className={`upload-row${failed ? ' is-failed' : ''}`}>
      <div className="upload-row-main">
        <strong title={item.name}>{item.name}</strong>
        <span className="upload-state">{failed ? item.error : STATUS_TEXT[item.status]}{!failed && item.note && item.status !== 'optimising' ? ` · ${item.note}` : ''}</span>
        {!failed && item.status === 'uploading' && (
          <div className="upload-progress"><span className="progress-track" role="progressbar" aria-label={`Uploading ${item.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)}><i style={{ transform: `scaleX(${Math.max(0.02, item.progress)})` }} /></span><span>{Math.round(item.progress * 100)}%</span></div>
        )}
      </div>
      {failed && item.retryable && <button className="btn sm" type="button" onClick={onRetry}>Try again</button>}
      <button className="btn sm" type="button" onClick={onCancel} aria-label={failed ? `Dismiss ${item.name}` : `Cancel adding ${item.name}`}>{failed ? 'Dismiss' : 'Cancel'}</button>
    </li>
  );
}
