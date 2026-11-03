// Independent synthetic account-expiry probe. No real provider, cloud or stored bearer output.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {startSyntheticApi} from '../../../../scripts/e2e/server.mjs';
import {createSession} from '../../../../apps/api/src/adapters/session.ts';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const run=process.env.FLOWBOARD_EXPIRY_RUN??'final-expired-session-browser-1';assert.match(run,/^[a-z0-9-]+$/);
const out=path.join(root,'docs/reviews/FULL-REVALIDATION-20261103/round4-foundation-account-review',run);
await fs.mkdir(out,{recursive:false});await fs.copyFile(fileURLToPath(import.meta.url),path.join(out,'probe-source.mjs'));
const frozen=JSON.parse(await fs.readFile(path.join(root,'docs/reviews/FULL-REVALIDATION-20261103/raw/independent-round4-gates-3/source-before.json'),'utf8'));
async function changed(){const result=[];for(const [p,h] of Object.entries(frozen.files))if(crypto.createHash('sha256').update(await fs.readFile(path.join(root,p))).digest('hex')!==h)result.push(p);return result;}
assert.deepEqual(await changed(),[]);
const report={kind:'independently executed local synthetic expired-session UI acceptance; real Google renewal remains UAT pending',startedAt:new Date().toISOString(),sourceDigest:frozen.digest,checks:[],blockedExternalOrigins:[]};
let api,web,browser,webLog;
try{
 api=await startSyntheticApi();const f=await api.fixture();
 report.privateBoardMatrix=[];
 for(const [actor,status] of [['anonymous',401],['outsider',404]]){
   const responses=[];
   for(const boardId of [f.board.id,'absent_account_review_board']){
     const r=await fetch(`http://127.0.0.1:44931/api/v1/boards/${boardId}`,{headers:actor==='anonymous'?{}:{cookie:`flowboard_session=${f.people.outsider.session.id}`}});
     const body=await r.json();assert.equal(r.status,status);assert.equal(body.data,undefined);
     responses.push({status:r.status,code:body.error.code,message:body.error.message});
   }
   assert.deepEqual(responses[0],responses[1]);report.privateBoardMatrix.push({actor,existing:responses[0],missing:responses[1],status:'pass'});
 }

 webLog=await fs.open(path.join(out,'next.log'),'wx');
 web=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'dev','-p','44932','-H','127.0.0.1'],{cwd:path.join(root,'apps/web'),env:{...process.env,API_URL:'http://127.0.0.1:44931',NEXT_EXPORT:'false',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore',webLog.fd,webLog.fd]});
 const deadline=Date.now()+90000;while(true){try{if((await fetch('http://127.0.0.1:44932/signin')).ok)break;}catch{}if(Date.now()>deadline)throw Error('Next startup deadline');await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({headless:true,executablePath:process.env.FLOWBOARD_CHROME_EXECUTABLE});report.browser=await browser.version();
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const blocked=new Set();
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol))return route.continue();blocked.add(u.origin);return route.abort();});
 await context.addCookies([{name:'flowboard_session',value:f.people.owner.session.id,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();await page.goto(`http://127.0.0.1:44932/board?id=${f.board.id}`,{waitUntil:'networkidle'});
 await page.getByText('Regression card 01',{exact:true}).first().click();
 const title=page.getByRole('textbox',{name:'Card title',exact:true});await expect(title).toHaveValue('Regression card 01');
 const ownDraft='Own unsent expiry recovery draft';await title.fill(ownDraft);await expect(page.getByRole('textbox',{name:'Description',exact:true})).toHaveValue('Synthetic full card description');
 const before=(await api.pool.query('SELECT title,description,version FROM cards WHERE id=$1',[f.cards[0].id])).rows[0];
 // Change only this synthetic actor's test sessions, never a real cookie/profile.
 await api.pool.query("UPDATE sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",[f.people.owner.user.id]);
 const ended=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/session'&&r.status()===401,{timeout:25000});
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await ended;
 await expect(page.getByRole('button',{name:'I’ve signed in',exact:true})).toBeAttached({timeout:10000});
 await expect(page.getByRole('textbox',{name:'Description',exact:true})).toHaveCount(0);
 assert.equal((await page.request.get(`http://127.0.0.1:44932/api/v1/cards/${f.cards[0].id}`)).status(),401);
 const existingBoard=await page.request.get(`http://127.0.0.1:44932/api/v1/boards/${f.board.id}`);const missingBoard=await page.request.get('http://127.0.0.1:44932/api/v1/boards/absent_account_review_board');
 const existingBody=await existingBoard.json(),missingBody=await missingBoard.json();assert.equal(existingBody.data,undefined);assert.equal(missingBody.data,undefined);assert.deepEqual({status:existingBoard.status(),code:existingBody.error.code,message:existingBody.error.message},{status:missingBoard.status(),code:missingBody.error.code,message:missingBody.error.message});report.privateBoardMatrix.push({actor:'expired',status:'pass',existingStatus:existingBoard.status(),missingStatus:missingBoard.status()});
 report.sharedBoardExistence={existingStatus:existingBoard.status(),missingStatus:missingBoard.status(),privacyInvariant:existingBoard.status()===missingBoard.status()?'pass':'fail',source:'apps/api/src/http/routes/boards.ts:211-221',note:'Independent recheck: existing and missing private board must be indistinguishable before identity.'};
 const refused=await page.request.patch(`http://127.0.0.1:44932/api/v1/cards/${f.cards[0].id}`,{headers:{origin:'http://127.0.0.1:44932','idempotency-key':crypto.randomUUID()},data:{title:'Must never save expired',expectedVersion:before.version}});assert.equal(refused.status(),401);
 assert.deepEqual((await api.pool.query('SELECT title,description,version FROM cards WHERE id=$1',[f.cards[0].id])).rows[0],before);
 report.checks.push({name:'expired session detected by real polling; private baseline hidden and direct reads/writes401 with unchanged row',status:'pass'});
 await page.screenshot({path:path.join(out,'expired-redacted.png'),fullPage:true});
 // A test-only new session stands in for successful provider renewal, whose hosted outcome is unclaimed.
 const renewed=await createSession(f.people.owner.user.id,24,api.pool);
 await context.addCookies([{name:'flowboard_session',value:renewed.id,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Lax'}]);
 // If the drawer survives, close it using its normal controls before reaching the shell recovery button.
 const close=page.getByRole('button',{name:'Close card details',exact:true});if(await close.count()){await close.click();const closeDraft=page.getByRole('button',{name:/Close and keep drafts/i});if(await closeDraft.count())await closeDraft.click();}
 await page.getByRole('button',{name:'I’ve signed in',exact:true}).click();
 await expect(page.getByText('Regression card 01',{exact:true}).first()).toBeVisible({timeout:15000});
 if(await title.count()===0)await page.getByText('Regression card 01',{exact:true}).first().click();
 await expect(title).toHaveValue(ownDraft,{timeout:15000});
 await expect(page.getByRole('textbox',{name:'Description',exact:true})).toHaveValue(before.description);
 assert.deepEqual((await api.pool.query('SELECT title,description,version FROM cards WHERE id=$1',[f.cards[0].id])).rows[0],before);
 report.checks.push({name:'same-actor UI recovery refetches authorized baseline and restores only own unsent title without mutation',status:'pass'});
 await page.screenshot({path:path.join(out,'renewed-own-draft.png'),fullPage:true});
 report.blockedExternalOrigins=[...blocked];report.expiryChecksStatus='pass';report.status=report.sharedBoardExistence.privacyInvariant==='pass'?'pass':'fail';if(report.status==='fail')process.exitCode=1;
}catch(error){report.status='fail';report.failure={name:error.name,message:String(error.message).split('\n')[0].slice(0,300)};process.exitCode=1;}
finally{
 if(browser)await browser.close();
 if(web){web.kill('SIGTERM');await new Promise(resolve=>{if(web.exitCode!==null)return resolve();web.once('exit',resolve);setTimeout(()=>{if(web.exitCode===null)web.kill('SIGKILL');resolve();},5000).unref();});}
 if(webLog)await webLog.close();if(api)await api.close();report.changedSources=await changed();if(report.changedSources.length){report.status='fail';process.exitCode=1;}report.completedAt=new Date().toISOString();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
