import type { Prepared } from './image-prepare';

/**
 * Upload queue for card images (S-15). It lives outside React on purpose: the card drawer re-mounts whenever the card's version
 * changes (finalizing an image bumps it), and an upload must not vanish with the component. One file is prepared and sent at a
 * time, so only one decoded bitmap exists at once.
 *
 * Honest states: a file is only "saved" once the server finalized it. Until then it is optimising, staging, uploading or validating.
 */
export type UploadStatus = 'optimising' | 'staging' | 'uploading' | 'validating' | 'failed';
export interface UploadItem {
  id: string;
  name: string;
  status: UploadStatus;
  /** 0..1, meaningful while uploading. */
  progress: number;
  /** "Optimised 4.2 MB → 610 KB" and similar. */
  note: string;
  error: string;
  retryable: boolean;
}
export interface UploadDeps {
  prepare(file: File): Promise<Prepared>;
  createUpload(cardId: string, input: { filename: string; byteLength: number; contentType: string; sha256: string }, key: string): Promise<{ id: string }>;
  putContent(uploadId: string, blob: Blob, opts: { onProgress: (fraction: number) => void; signal: AbortSignal }): Promise<unknown>;
  finalize(uploadId: string, key: string): Promise<unknown>;
  cancel(uploadId: string): Promise<unknown>;
  /** Friendly sentence for a failure, and whether trying again could help. */
  describe(error: unknown): { message: string; retryable: boolean };
  /** Called after the server finalized an image, so lists and counts can refresh. */
  onFinalized(cardId: string): void;
}

interface Entry { item: UploadItem; file: File; cardId: string; controller: AbortController; uploadId: string | null; removed: boolean }

const key = () => `idemp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export function createUploadStore(deps: UploadDeps) {
  const entries: Entry[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const snapshots = new Map<string, UploadItem[]>();
  let running = false;
  const pending = new Set<Entry>();

  const publish = (cardId: string) => {
    snapshots.set(cardId, entries.filter((e) => e.cardId === cardId && !e.removed).map((e) => ({ ...e.item })));
    listeners.get(cardId)?.forEach((fn) => fn());
  };
  const patch = (entry: Entry, change: Partial<UploadItem>) => { Object.assign(entry.item, change); publish(entry.cardId); };
  const drop = (entry: Entry) => { entry.removed = true; const i = entries.indexOf(entry); if (i >= 0) entries.splice(i, 1); publish(entry.cardId); };

  async function work(entry: Entry): Promise<void> {
    const { cardId, file } = entry;
    entry.controller = new AbortController();
    patch(entry, { status: 'optimising', progress: 0, error: '', note: '' });
    try {
      const prepared = await deps.prepare(file);
      if (entry.removed) return;
      patch(entry, { status: 'staging', note: prepared.note, name: prepared.filename });
      const upload = await deps.createUpload(cardId, { filename: prepared.filename, byteLength: prepared.byteLength, contentType: prepared.contentType, sha256: prepared.sha256 }, key());
      entry.uploadId = upload.id;
      if (entry.removed) { void deps.cancel(upload.id).catch(() => undefined); return; }
      patch(entry, { status: 'uploading', progress: 0 });
      await deps.putContent(upload.id, prepared.blob, { onProgress: (progress) => patch(entry, { progress }), signal: entry.controller.signal });
      if (entry.removed) { void deps.cancel(upload.id).catch(() => undefined); return; }
      patch(entry, { status: 'validating', progress: 1 });
      await deps.finalize(upload.id, key());
      entry.uploadId = null;
      drop(entry);
      deps.onFinalized(cardId);
    } catch (error) {
      if (entry.removed || isAbort(error)) { if (entry.uploadId) void deps.cancel(entry.uploadId).catch(() => undefined); if (!entry.removed) drop(entry); return; }
      const { message, retryable } = deps.describe(error);
      // A staged upload that failed stays on the server until it expires; cancel it so it does not count against the card.
      if (entry.uploadId) void deps.cancel(entry.uploadId).catch(() => undefined);
      entry.uploadId = null;
      patch(entry, { status: 'failed', error: message, retryable });
    }
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const next = pending.values().next().value as Entry | undefined;
        if (!next) break;
        pending.delete(next);
        await work(next);
      }
    } finally { running = false; }
  }

  return {
    subscribe(cardId: string, fn: () => void) {
      let set = listeners.get(cardId); if (!set) { set = new Set(); listeners.set(cardId, set); }
      set.add(fn); return () => { set!.delete(fn); };
    },
    get(cardId: string): UploadItem[] { return snapshots.get(cardId) ?? EMPTY; },
    add(cardId: string, files: File[]) {
      for (const file of files) {
        const entry: Entry = { item: { id: key(), name: file.name, status: 'optimising', progress: 0, note: 'Waiting…', error: '', retryable: false }, file, cardId, controller: new AbortController(), uploadId: null, removed: false };
        entries.push(entry); pending.add(entry);
      }
      publish(cardId); void pump();
    },
    /** Stops a file: aborts the transfer and cancels the staged upload so nothing is saved. */
    cancel(cardId: string, id: string) {
      const entry = entries.find((e) => e.item.id === id && e.cardId === cardId); if (!entry) return;
      entry.controller.abort();
      pending.delete(entry);
      if (entry.item.status === 'failed') { drop(entry); return; }
      entry.removed = true;
      if (entry.uploadId) void deps.cancel(entry.uploadId).catch(() => undefined);
      drop(entry);
    },
    retry(cardId: string, id: string) {
      const entry = entries.find((e) => e.item.id === id && e.cardId === cardId); if (!entry || entry.item.status !== 'failed') return;
      patch(entry, { status: 'optimising', error: '', note: 'Waiting…', progress: 0 });
      pending.add(entry); void pump();
    },
    dismiss(cardId: string, id: string) { const entry = entries.find((e) => e.item.id === id && e.cardId === cardId); if (entry) drop(entry); },
    /** Files in flight or waiting, for the per-card limit. */
    activeCount(cardId: string) { return entries.filter((e) => e.cardId === cardId && e.item.status !== 'failed').length; },
  };
}
const EMPTY: UploadItem[] = [];
