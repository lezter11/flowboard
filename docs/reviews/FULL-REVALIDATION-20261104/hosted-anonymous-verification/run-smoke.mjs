import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const confirmation = JSON.parse(await fs.readFile(path.join(dir, 'deployment-confirmation.json'), 'utf8'));
const expectedCommit = 'd1c81f42fe306c352c9cb10f04883e251ead58bd';
assert.equal(confirmation.confirmedLive, true, 'deployer live confirmation required');
assert.equal(confirmation.sourceCommit, expectedCommit);
assert.ok(confirmation.workerVersionId && confirmation.pagesDeploymentId, 'both deployed IDs required');
const pagesOrigin = 'https://flowboard-app-uat.pages.dev';
assert.equal(confirmation.pagesOrigin, pagesOrigin);
const workerOrigin = confirmation.workerOrigin || null;
if (workerOrigin) {
  const parsed = new URL(workerOrigin);
  assert.equal(parsed.protocol, 'https:');
  assert.ok(/^flowboard-api-uat\.[a-z0-9-]+\.workers\.dev$/.test(parsed.hostname));
  assert.equal(parsed.origin, workerOrigin);
}
const allow = new Set([pagesOrigin, ...(workerOrigin ? [workerOrigin] : [])]);
const safeHeaders = ['content-type','cache-control','location','content-security-policy','x-content-type-options','x-frame-options','referrer-policy','permissions-policy','strict-transport-security','etag','cf-cache-status','cf-ray','x-request-id'];
const startedAt = new Date().toISOString();
const results = [];
let requests = 0;
async function get(origin, route, expected, label, options = {}) {
  const url = new URL(route, origin);
  assert.ok(allow.has(url.origin) && url.protocol === 'https:');
  assert.ok(++requests <= 20, 'HTTP GET budget exhausted');
  const start = performance.now(), at = new Date().toISOString();
  const result = { number: requests, at, url: url.toString(), method: 'GET', label, expectedStatus: expected, requestBoundary: 'anonymous; no cookies/authorization; manual redirect; no retries' };
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', headers: { accept: options.publicHtml ? 'text/html' : '*/*', 'user-agent':'Flowboard-independent-UAT-smoke/20261104' }, signal: AbortSignal.timeout(15000) });
    result.status = response.status;
    result.headers = Object.fromEntries(safeHeaders.filter(key => response.headers.has(key)).map(key => [key,response.headers.get(key)]));
    result.setCookiePresent = response.headers.has('set-cookie');
    result.failures = [];
    if (response.status !== expected) result.failures.push(`Expected${expected}, observed${response.status}`);
    if (options.noStore && !/\bno-store\b/i.test(response.headers.get('cache-control') || '')) result.failures.push('Missing no-store');
    if (options.location && response.headers.get('location') !== options.location) result.failures.push('Unexpected redirect destination');
    if (options.immutable && !/\bimmutable\b/i.test(response.headers.get('cache-control') || '')) result.failures.push('Missing immutable asset cache');
    if (options.staticSecurity) {
      for (const name of ['content-security-policy','x-content-type-options','x-frame-options','referrer-policy','permissions-policy']) if (!response.headers.get(name)) result.failures.push('Missing static security header: '+name);
      if (response.headers.get('x-content-type-options') !== 'nosniff') result.failures.push('Unexpected nosniff value');
      if (response.headers.get('x-frame-options')?.toUpperCase() !== 'DENY') result.failures.push('Unexpected frame policy');
    }
    const reader = response.body?.getReader();
    let bytes = 0, chunks = [], capped = false;
    if (reader) {
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          bytes += next.value.length;
          if (bytes > 2*1024*1024) { capped = true; await reader.cancel(); break; }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
    }
    const buffer = Buffer.concat(chunks);
    result.bodyBytesRead = bytes; result.bodyCapped = capped;
    result.bodySHA256 = crypto.createHash('sha256').update(buffer).digest('hex');
    if (capped) result.failures.push('Response exceeded2MiB read bound');
    const text = buffer.toString('utf8');
    let json;
    if (response.headers.get('content-type')?.includes('json')) try { json=JSON.parse(text); } catch { result.failures.push('Invalid JSON response'); }
    if (json) {
      result.jsonTopLevelKeys = Object.keys(json);
      if (expected === 401 || expected === 403) {
        result.errorCode = typeof json.error?.code === 'string' ? json.error.code : null;
        result.dataPresent = Object.hasOwn(json,'data');
        if (result.dataPresent) result.failures.push('Denied response includes data envelope');
        if (!result.errorCode) result.failures.push('Denied response lacks error code');
      }
      if (options.health) { result.healthStatus = json.data?.status; if (result.healthStatus !== options.health) result.failures.push('Unexpected health state'); }
    } else if (expected === 401 || expected === 403 || options.health) result.failures.push('Expected JSON error/health response');
    if (options.publicHtml && response.status === 200) {
      result.title = text.match(/<title>([^<]*)<\/title>/i)?.[1] ?? null;
      result.html = /<!doctype html|<html/i.test(text);
      result.staticAsset = [...text.matchAll(/(?:href|src)=["'](\/_next\/static\/[^"'?#]+\.(?:css|js))["']/g)][0]?.[1] ?? null;
      if (!result.html) result.failures.push('Expected static HTML');
      if (confirmation.signinArtifactSHA256) result.exactSigninArtifactMatch = result.bodySHA256 === confirmation.signinArtifactSHA256;
    }
    // Only safe summaries and hashes are retained; no response body, cookie value,
    // protected content, credential or provider redirect state is written.
    result.passed = result.failures.length === 0;
    result.elapsedMs = performance.now()-start;
    results.push(result); return result;
  } catch (error) {
    result.error = String(error?.cause?.code || error?.code || error?.name || 'NETWORK_ERROR');
    result.passed = false; result.elapsedMs = performance.now()-start; results.push(result); return result;
  }
}
await get(pagesOrigin,'/',302,'anonymous root redirect',{noStore:true,location:'/signin'});
const signin=await get(pagesOrigin,'/signin',200,'static sign-in and security headers',{publicHtml:true,staticSecurity:true});
if (signin.staticAsset) await get(pagesOrigin,signin.staticAsset,200,'same-host static asset cache',{immutable:true});
await get(pagesOrigin,'/board?id=anonymous_smoke_no_record',302,'safe protected-page redirect',{noStore:true,location:'/signin?next=%2Fboard%3Fid%3Danonymous_smoke_no_record'});
for (const route of ['/api/v1/session','/api/v1/projects','/api/v1/tokens','/api/v1/import/template','/api/v1/imports/anonymous_smoke_no_record']) await get(pagesOrigin,route,401,'anonymous protected API denial',{noStore:true});
await get(pagesOrigin,'/api/v1/system/status',403,'anonymous administrator denial',{noStore:true});
if (workerOrigin) {
  await get(workerOrigin,'/health/live',200,'actual Worker liveness',{noStore:true,health:'ok'});
  await get(workerOrigin,'/health/ready',200,'actual Worker readiness',{noStore:true,health:'ready'});
  await get(workerOrigin,'/api/v1/session',401,'direct Worker session denial',{noStore:true});
  await get(workerOrigin,'/api/v1/tokens',401,'direct Worker credential-administration denial',{noStore:true});
  await get(workerOrigin,'/api/v1/system/status',403,'direct Worker administrator denial',{noStore:true});
}
const output = { actor:'collaboration:/root/urgent_independent_import_review',startedAt,completedAt:new Date().toISOString(),sourceCommit:expectedCommit,deploymentConfirmation:confirmation,totalHttpGetRequests:requests,maxRequests:20,allowedOrigins:[...allow],mutations:0,credentialsSent:false,cookiesSent:false,automaticRedirects:false,retries:0,results,passed:results.every(r=>r.passed),coverageGaps:workerOrigin?[]:['No configured/confirmed UAT Worker default domain: direct health/readiness omitted'],limits:['Anonymous smoke only; no signed-in authorization, provider, MCP-client, private storage, scheduler or complete hosted acceptance proof.','Deployment IDs/source linkage come from confirmed deployment metadata; anonymous HTTP alone cannot attest source SHA.'] };
await fs.writeFile(path.join(dir,'results.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({totalHttpGetRequests:requests,passed:output.passed,failures:results.filter(r=>!r.passed).map(r=>({number:r.number,url:r.url,status:r.status,failures:r.failures,error:r.error})),coverageGaps:output.coverageGaps}));
process.exitCode = output.passed ? 0 : 1;
