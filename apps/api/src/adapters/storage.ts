/**
 * Storage Driver Interface and Implementations
 *
 * Provides a portable object storage interface (Memory for tests/local, R2 for Cloudflare Workers).
 * Files are addressed by key; metadata and ownership reside in PostgreSQL.
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

let activeStorageDriver: StorageDriver = new MemoryStorageDriver();

export function getStorageDriver(): StorageDriver {
  return activeStorageDriver;
}

export function setStorageDriver(driver: StorageDriver): void {
  activeStorageDriver = driver;
}
