// Isolated anonymous policy probe: only the real document and one stylesheet reach UAT.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { effectiveReferrerPolicyFromFields } from './referrer-policy.mjs';
const base=path.dirname(fileURLToPath(import.meta.url));
const artifact=JSON.parse(await fs.readFile('/private/tmp/flowboard-hosted-pages-dce1a67/artifact-manifest.json','utf8'));
assert.equal(artifact.sourceCommit,'dce1a67dedb1de8f5f7aae9b99fcbcb2b875d105');
const html=await fs.readFile('/private/tmp/flowboard-hosted-pages-dce1a67/out/connect.html','utf8');
const css=[...html.matchAll(/href="([^"]+\.css)"/g)].map(m=>m[1]).find(p=>p.startsWith('/_next/static/'));
assert.ok(css&&artifact.pages['out'+css]);
const origin='https://flowboard-app-uat.pages.dev';
const target=origin+'/connect?request=invalid';
const report={kind:'actual isolated Chromium anonymous referrer-policy check',sourceCommit:artifact.sourceCommit,startedAt:new Date().toISOString(),credentialsUsed:false,applicationMutations:false,maxRequests:2,requestCount:0,requests:[],blockedResources:0,unexpectedOrigins:[],status:'running',cleanup:false,limits:['JavaScript disabled; all resources except document and one prepared stylesheet blocked. This proves policy behavior, not sign-in, app functionality or provider acceptance.']};
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 report.browser=browser.version();
 const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block'});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  const isDocument=request.url()===target&&request.resourceType()==='document';
  const isStylesheet=url.origin===origin&&url.pathname===css&&request.resourceType()==='stylesheet';
  if(!isDocument&&!isStylesheet){report.blockedResources++;if(url.origin!==origin)report.unexpectedOrigins.push(url.origin);return route.abort();}
  assert.ok(report.requestCount<2,'Policy probe request budget');
  const headers=await request.allHeaders();
  assert.equal(Object.hasOwn(headers,'authorization'),false);assert.equal(Object.hasOwn(headers,'cookie'),false);
  report.requestCount++;report.requests.push({path:url.pathname,type:request.resourceType(),refererPresent:Object.hasOwn(headers,'referer')});
  return route.continue();
 });
 const page=await context.newPage();
 const stylesheet=page.waitForResponse(r=>new URL(r.url()).pathname===css,{timeout:20000});
 const response=await page.goto(target,{waitUntil:'load',timeout:30000});
 assert.equal(response.status(),200);assert.equal((await stylesheet).status(),200);
 report.referrerPolicyFields=(await response.headersArray()).filter(field=>field.name.toLowerCase()==='referrer-policy').map(field=>field.value);report.effectivePolicy=effectiveReferrerPolicyFromFields(report.referrerPolicyFields);
 assert.equal(report.effectivePolicy,'no-referrer');
 const outgoing=report.requests.filter(r=>r.type==='stylesheet');assert.equal(outgoing.length,1);assert.equal(outgoing[0].refererPresent,false);
 assert.equal(report.unexpectedOrigins.length,0);assert.equal(report.requestCount,2);
 report.status='pass';report.exitCode=0;
}catch(error){report.status='fail';report.exitCode=1;report.errorType=/^[A-Za-z]{1,35}$/.test(error?.name??'')?error.name:'Error';process.exitCode=1;}
finally{await browser?.close();report.cleanup=true;report.completedAt=new Date().toISOString();await fs.writeFile(path.join(base,'live-referrer-browser-v2.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:report.status,exitCode:report.exitCode,requestCount:report.requestCount,effectivePolicy:report.effectivePolicy,stylesheetRefererPresent:report.requests.find(r=>r.type==='stylesheet')?.refererPresent,cleanup:true}));}
