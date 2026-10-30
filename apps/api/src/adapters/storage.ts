import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpError } from '../http/errors.ts';

/**
 * Storage Driver Interface and Implementations
 *
 * Provides a portable object storage interface. Production uses R2StorageDriver over the
 * private `IMAGES` bucket binding. MemoryStorageDriver is for tests only: its bytes live in one
 * process, so a second Worker isolate could never read them.
 * Files are addressed by key; metadata and ownership reside in PostgreSQL.
 *
 * Fail closed: when no driver is configured, every storage call throws 503 CONFIG_ERROR. There
 * is no silent fallback to memory.
 */

export interface StoredObject {
  data: Uint8Array;
  contentType: string;
}

export interface StorageDriver {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

/** The part of the Cloudflare R2 bucket binding this driver uses. Structural, so tests can fake it. */
export interface R2BucketBinding {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string | undefined } | undefined;
  } | null>;
  delete(key: string): Promise<void>;
}

/**
 * Durable private object storage on Cloudflare R2. The bucket must be private with no public
 * access; bytes are only served through the API after an authorization check.
 */
export class R2StorageDriver implements StorageDriver {
  private readonly bucket: R2BucketBinding;

  constructor(bucket: R2BucketBinding) {
    this.bucket = bucket;
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    await this.bucket.put(key, data, { httpMetadata: { contentType } });
  }

  async get(key: string): Promise<StoredObject | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    return {
      data: new Uint8Array(await object.arrayBuffer()),
      contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
    };
  }

  async delete(key: string): Promise<void> {
    // R2 treats a missing key as success, so cleanup is safe to repeat.
    await this.bucket.delete(key);
  }
}

/** Test-only: the bytes live in one process and are lost on restart. */
export class MemoryStorageDriver implements StorageDriver {
  private readonly store = new Map<string, StoredObject>();

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    // Clone buffer to prevent external mutation
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    this.store.set(key, { data: copy, contentType });
  }

  async get(key: string): Promise<StoredObject | null> {
    const item = this.store.get(key);
    if (!item) return null;
    const copy = new Uint8Array(item.data.byteLength);
    copy.set(item.data);
    return { data: copy, contentType: item.contentType };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

// A request or scheduled run may bind its own driver (the Worker binds its IMAGES bucket, or
// null when the binding is absent). Without a binding, the process default applies (tests).
interface StorageScope {
  driver: StorageDriver | null;
}
const storageScope = new AsyncLocalStorage<StorageScope>();
let defaultStorageDriver: StorageDriver | null = null;

export function runWithStorageDriver<T>(driver: StorageDriver | null, fn: () => T): T {
  return storageScope.run({ driver }, fn);
}

export function getStorageDriver(): StorageDriver {
  const scope = storageScope.getStore();
  const driver = scope ? scope.driver : defaultStorageDriver;
  if (!driver) {
    throw new HttpError(503, 'CONFIG_ERROR', 'Image storage is not configured for this deployment.');
  }
  return driver;
}

export function setStorageDriver(driver: StorageDriver | null): void {
  defaultStorageDriver = driver;
}
