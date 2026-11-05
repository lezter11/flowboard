import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
const origin = 'https://router-review.example';
const options = { pool: { query() { throw new Error('No database allowed'); } }, storage: null };
const values = [];
for (const label of ['smart', 'actual']) {
  const { createApp } = await import('./' + label + '-app.mjs');
  for (const [route, expected] of [['/health/live', 200], ['/api/v1/session', 401], ['/.well-known/oauth-authorization-server', 200]]) {
    const cpuRounds = [], times = [];
    for (let round = 0; round < 5; round++) {
      const cpu = process.cpuUsage();
      for (let i = 0; i < 300; i++) {
        const start = performance.now(), app = createApp(async () => {}, options);
        const response = await app.fetch(new Request(origin + route), { APP_ORIGIN: origin });
        assert.equal(response.status, expected); await response.arrayBuffer();
        times.push(performance.now() - start);
      }
      const used = process.cpuUsage(cpu); cpuRounds.push((used.user + used.system) / 1000 / 300);
    }
    times.sort((a, b) => a - b);
    values.push({ label, route, cpuMsPerOperationRounds: cpuRounds, medianCpuMs: [...cpuRounds].sort((a, b) => a - b)[2],
      p50WallMs: times[749], p95WallMs: times[1424], p99WallMs: times[1484], requests: 1500 });
  }
}
const comparison = values.filter(x => x.label === 'actual').map(actual => {
  const baseline = values.find(x => x.label === 'smart' && x.route === actual.route);
  return { route: actual.route, actualMedianCpuMs: actual.medianCpuMs, baselineMedianCpuMs: baseline.medianCpuMs,
    fractionOfBaseline: actual.medianCpuMs / baseline.medianCpuMs };
});
assert.ok(comparison.every(row => row.fractionOfBaseline < 1), 'Every measured fresh-request family must improve locally');
const result = { node: process.version, status: 'measured', values, comparison,
  limits: 'Fresh actual application per operation; no DB or network. Node process CPU includes GC; no claim of Cloudflare-metered CPU, deployed headroom, sole production cause or authenticated workload timings. Same-process baseline first then actual may include JIT/order effects; prior separate-process five-round and actual workerd corroboration retained independently.' };
await fs.writeFile(new URL('./independent-performance.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
