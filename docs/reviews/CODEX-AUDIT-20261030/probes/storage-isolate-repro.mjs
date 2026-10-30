import { Worker } from 'node:worker_threads';
import { getStorageDriver } from '../../../../apps/api/src/adapters/storage.ts';

const active = getStorageDriver();
await active.put('audit-probe-key', new Uint8Array([1, 2, 3]), 'image/png');
const workerUrl = new URL('../../../../apps/api/src/adapters/storage.ts', import.meta.url).href;
const freshIsolateValue = await new Promise((resolve, reject) => {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    import(workerData).then(async ({getStorageDriver}) => {
      parentPort.postMessage(await getStorageDriver().get('audit-probe-key'));
    }).catch((error) => { throw error; });
  `, { eval: true, workerData: workerUrl });
  worker.once('message', resolve);
  worker.once('error', reject);
});
console.log(JSON.stringify({ activeDriverClass: active.constructor.name, writerReadAfterPut: Boolean(await active.get('audit-probe-key')), freshWorkerIsolateRead: freshIsolateValue }));
