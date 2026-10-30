import fs from 'node:fs/promises';
import { transformSync } from '../../../../node_modules/esbuild/lib/main.js';
import { onRequest as proxy } from '../../../../apps/web/functions/api/[[path]].ts';

// Node does not implement Workers' extensionless TypeScript import resolution. Transpile an
// in-memory copy to a temp file with only that import made explicit; the target source stays frozen.
const middlewarePath = new URL('../../../../apps/web/functions/_middleware.ts', import.meta.url);
const returnPath = new URL('../../../../apps/web/src/lib/return-path.ts', import.meta.url);
const middlewareSource = (await fs.readFile(middlewarePath, 'utf8')).replace("'../src/lib/return-path'", `'${returnPath.href}'`);
const compiled = transformSync(middlewareSource, {loader:'ts',format:'esm',target:'es2022'}).code;
const compiledPath = '/private/tmp/flowboard-pages-middleware-pass2.mjs';
await fs.writeFile(compiledPath, compiled);
const { onRequest: gate } = await import(`file://${compiledPath}`);

const captured = [];
const upstream = {
  async fetch(request) {
    captured.push({ url:request.url, method:request.method, cookie:request.headers.get('cookie'), authorization:request.headers.get('authorization') });
    return new Response(null,{status:302,headers:{location:'https://accounts.google.com/test', 'set-cookie':'flowboard_session=synthetic; HttpOnly; SameSite=Lax'}});
  },
};
const proxied = await proxy({request:new Request('https://flowboard-app-uat.pages.dev/api/v1/auth/google',{headers:{cookie:'flowboard_session=synthetic','x-test':'x'}}),env:{API:upstream}});
const noApi = await proxy({request:new Request('https://pages.invalid/api/v1/private'),env:{}});
let apiCalls=0;
const next = async () => { apiCalls++; return new Response('next',{status:200}); };
const signedOut = await gate({request:new Request('https://pages.invalid/project?id=guessed'),env:{},next});
const asset = await gate({request:new Request('https://pages.invalid/_next/static/app.js'),env:{},next});
const apiBypass = await gate({request:new Request('https://pages.invalid/api/v1/session'),env:{},next});
let gateApiCalls=0;
const invalidSession = await gate({request:new Request('https://pages.invalid/project?id=guessed',{headers:{cookie:'flowboard_session=synthetic'}}),env:{API:{fetch:async()=>{gateApiCalls++;return new Response(JSON.stringify({error:{code:'UNAUTHORIZED'}}),{status:401});}}},next});
console.log(JSON.stringify({
  proxy:{status:proxied.status,location:proxied.headers.get('location'),setCookieCount:proxied.headers.getSetCookie().length,cacheControl:proxied.headers.get('cache-control'),forwarded:captured[0]},
  missingBinding:{status:noApi.status,cacheControl:noApi.headers.get('cache-control')},
  gate:{signedOutStatus:signedOut.status,location:signedOut.headers.get('location'),cacheControl:signedOut.headers.get('cache-control'),assetPassThrough:asset.status===200,apiPassThrough:apiBypass.status===200,unauthSessionRedirect:invalidSession.status,invalidSessionLocation:invalidSession.headers.get('location'),sessionApiCalls:gateApiCalls,otherApiCalls:apiCalls},
}));
