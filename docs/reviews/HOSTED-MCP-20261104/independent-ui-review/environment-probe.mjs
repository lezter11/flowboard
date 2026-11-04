// Generic reviewer worker only. This checks the local runtime environment, not product acceptance.
import fs from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_generateASSETSBinding } from 'wrangler';
const out = 'docs/reviews/HOSTED-MCP-20261104/independent-ui-review/setup/2026-11-04T12-46-53.203Z';
const lifetime = new AbortController();
const log = Object.fromEntries(['debug','info','log','warn','error'].map(k => [k, () => {}]));
let mf;
const result = { kind: 'Environment setup only; generic reviewer worker, no product Pages acceptance', status: 'not-run' };
try {
  const assets = await unstable_generateASSETSBinding({ directory: out + '/stage/out', log, signal: lifetime.signal });
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'review-environment', modules: true, script: 'export default {fetch(request,env){return env.ASSETS.fetch(request)}}', compatibilityDate: '2026-10-19', serviceBindings: { ASSETS: assets } }], host: '127.0.0.1', port: 0 }));
  await mf.ready;
  const r = await mf.dispatchFetch('http://127.0.0.1/connect', { redirect: 'manual' });
  result.status = 'ready'; result.assetStatus = r.status; result.cache = r.headers.get('cache-control'); result.referrer = r.headers.get('referrer-policy'); await r.arrayBuffer();
} catch(e) { result.status = 'failed'; result.error = String(e?.message ?? e); process.exitCode = 1; }
finally { lifetime.abort(); await mf?.dispose(); await fs.writeFile(out + '/environment-only-round4.json', JSON.stringify(result,null,2) + '\n'); console.log(JSON.stringify(result)); }
