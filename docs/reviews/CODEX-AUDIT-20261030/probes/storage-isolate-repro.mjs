import { Worker } from 'node:worker_threads';
import { R2StorageDriver, getStorageDriver, runWithStorageDriver } from '../../../../apps/api/src/adapters/storage.ts';

const objects = new Map();
const binding = {
  async put(key, value, options) { objects.set(key, { bytes: new Uint8Array(value), contentType: options?.httpMetadata?.contentType }); },
  async get(key) {
    const item = objects.get(key);
    if (!item) return null;
    const copy = new Uint8Array(item.bytes);
    return { arrayBuffer: async () => copy.buffer, httpMetadata: { contentType: item.contentType } };
  },
  async delete(key) { objects.delete(key); },
};
const bytes = new Uint8Array([1, 2, 3]);
const driver = new R2StorageDriver(binding);
await runWithStorageDriver(driver, () => getStorageDriver().put('audit-probe-key', bytes, 'image/png'));
const freshDriver = new R2StorageDriver(binding);
const freshIsolateRead = await freshDriver.get('audit-probe-key');
const absentBindingFailsClosed = await runWithStorageDriver(null, async () => {
  try { getStorageDriver(); return false; }
  catch (error) { return error.status === 503 && error.code === 'CONFIG_ERROR'; }
});
console.log(JSON.stringify({
  sameObjectStoreRead: Boolean(freshIsolateRead && [...freshIsolateRead.data].join(',') === '1,2,3'),
  contentType: freshIsolateRead?.contentType,
  absentBindingFailsClosed,
  verdict: 'shared fake R2 bucket validates independent driver access; hosted R2 not exercised',
}));
