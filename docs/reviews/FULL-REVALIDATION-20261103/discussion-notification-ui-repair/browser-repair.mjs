import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { startSyntheticApi } from '../../../../scripts/e2e/server.mjs';

const root=process.cwd(), output=path.join(root,'docs/reviews/FULL-REVALIDATION-20261103/discussion-notification-ui-repair/browser');
await fs.mkdir(output,{recursive:true});
const sources=['apps/web/src/lib/comment-state.ts','apps/web/src/lib/protected-drafts.ts','apps/web/src/components/board/card-comments.tsx','apps/web/src/app/inbox/page.tsx','apps/web/src/lib/notification-link.ts','apps/web/src/lib/activity.ts','apps/web/src/components/board/card-detail-drawer.tsx','apps/web/src/app/activity/page.tsx'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex')])));
const result={executor:'collaboration:/root/discussion_notification_ui_repair',kind:'builder local mounted synthetic PostgreSQL and Chrome; not independent acceptance or hosted proof',startedAt:new Date().toISOString(),sourceBefore:await hashes(),observations:[],externalRequests:[],network:[]};
let api,web,browser,log;const releases=[];
try {
 api=await startSyntheticApi();
 web=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'dev','-p','44932','-H','127.0.0.1'],{cwd:path.join(root,'apps/web'),env:{...process.env,NODE_ENV:'development',API_URL:'http://127.0.0.1:44931',NEXT_DIST_DIR:'.next',NEXT_EXPORT:'false',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 log=await fs.open(path.join(output,'next.log'),'w');web.stdout.on('data',x=>void log.write(x));web.stderr.on('data',x=>void log.write(x));
 const until=Date.now()+90000;while(true){try{if((await fetch('http://127.0.0.1:44932/signin')).ok)break;}catch{}if(Date.now()>until)throw new Error('Next startup timeout');await new Promise(r=>setTimeout(r,300));}
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});result.browser=await browser.version();
 async function pageFor(f,role='member') {
   const context=await browser.newContext({viewport:{width:1440,height:1000}});
   await context.route('**/*',route=>{const url=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(url.hostname))return route.continue();result.externalRequests.push({origin:url.origin,path:url.pathname});return route.abort();});
   await context.addCookies([{name:'flowboard_session',value:f.people[role].session.id,domain:'127.0.0.1',path:'/',sameSite:'Lax',httpOnly:true}]);
   const page=await context.newPage();page.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))result.network.push({method:r.request().method(),path:u.pathname,status:r.status()});});
   return {context,page};
 }
 for(const changed of [false,true]) {
   const f=await api.fixture(), original='SYNTHETIC_FETCHED_COMMENT', authored='My newly authored unsent edit';
   await f.call('member','POST',`/api/v1/cards/${f.cards[0].id}/comments`,{body:original,mentions:[]});
   const {context,page}=await pageFor(f);
   await page.goto(`http://127.0.0.1:44932/board?id=${f.board.id}`,{waitUntil:'networkidle',timeout:60000});await page.getByText('Regression card 01',{exact:true}).first().click();
   const drawer=page.getByRole('dialog').first();const article=drawer.getByRole('article',{name:'Comment by Synthetic member',exact:true});
   await expect(article.getByText(original,{exact:true})).toBeVisible();await article.getByRole('button',{name:'Edit your comment',exact:true}).click();
   const editor=drawer.getByRole('combobox',{name:'Edit your comment',exact:true});await expect(editor).toHaveValue(original);if(changed)await editor.fill(authored);
   await page.waitForLoadState('networkidle');
   const commentsPath=`/api/v1/cards/${f.cards[0].id}/comments`;let release;const pending=new Promise(r=>release=r);releases.push(release);let held=0;
   await page.route('**/api/v1/**',async route=>{const u=new URL(route.request().url());if(route.request().method()==='GET'&&u.pathname!==commentsPath&&u.pathname!=='/api/v1/session'){held++;await pending;}await route.continue().catch(()=>{});});
   const access=(await f.call('owner','GET',`/api/v1/boards/${f.board.id}/access`)).data;
   await f.call('owner','DELETE',`/api/v1/boards/${f.board.id}/grants/${f.people.member.user.id}`,{expectedAccessRevision:access.accessRevision});
   const denied=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname===commentsPath&&r.status()===404,{timeout:20000});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await denied;
   if(changed){await expect(editor).toHaveValue(authored);await expect(editor).toHaveAttribute('readonly','');}else await expect(editor).toHaveCount(0);
   assert.equal(await drawer.getByRole('article',{name:'Comment by Synthetic member',exact:true}).count(),0);
   result.observations.push({flow:'comment refusal before other reads',changed,editorCount:await editor.count(),editorValue:changed?await editor.inputValue():null,heldOtherReadResponses:held});
   await page.screenshot({path:path.join(output,changed?'changed-edit-retained.png':'canonical-edit-cleared.png'),fullPage:true});release();await context.close();
 }
 {
   const f=await api.fixture();const body='Notification link @Synthetic member';await f.call('owner','POST',`/api/v1/cards/${f.cards[0].id}/comments`,{body,mentions:[{userId:f.people.member.user.id,start:body.indexOf('@'),end:body.length}]});
   const {context,page}=await pageFor(f);await page.goto('http://127.0.0.1:44932/inbox',{waitUntil:'networkidle',timeout:60000});
   const open=page.getByRole('link',{name:'Open card',exact:true});await expect(open).toBeVisible();const href=await open.getAttribute('href');
   assert.equal(href,`/board?id=${encodeURIComponent(f.board.id)}&card=${encodeURIComponent(f.cards[0].id)}`);
   await open.focus();await page.keyboard.press('Enter');await page.waitForURL(/\/board\?id=/);const drawer=page.getByRole('dialog').first();await expect(drawer).toBeVisible();await expect(drawer.getByText('Regression card 01',{exact:true})).toBeVisible();
   result.observations.push({flow:'notification keyboard Open',renderedHref:href,cardDialogCount:await page.getByRole('dialog').count(),targetCardDetailVisible:true});await page.screenshot({path:path.join(output,'notification-opens-card.png'),fullPage:true});await context.close();
 }
 // Confirm the mandatory audit gap through the real mounted API before renderer edits.
 {
   const f=await api.fixture();await f.call('owner','PATCH',`/api/v1/cards/${f.cards[0].id}`,{expectedVersion:f.cards[0].version,title:'Audit AFTER sentinel',description:'Audit AFTER description',assigneeIds:[f.people.member.user.id]});
   const events=(await f.call('owner','GET',`/api/v1/cards/${f.cards[0].id}/activity`)).data;const update=events.find(e=>e.action==='card_updated');assert.ok(update?.safeChanges?.title?.old);assert.ok(update.safeChanges.assignees);
   const {context,page}=await pageFor(f,'owner');await page.goto(`http://127.0.0.1:44932/board?id=${f.board.id}&card=${f.cards[0].id}`,{waitUntil:'networkidle',timeout:60000});const drawer=page.getByRole('dialog').first();await drawer.getByRole('tab',{name:'Activity',exact:true}).click();await expect(drawer.getByText('updated the title, the description on this card',{exact:false})).toBeVisible();
   const text=await drawer.locator('.activity-list').innerText();assert.equal(text.includes('Regression card 01'),false);assert.equal(text.includes('Audit AFTER description'),false);
   result.observations.push({flow:'audit pre-renderer gap confirmation',oldNewPayloadPresent:true,assigneeDeltaPresent:true,oldTitleVisible:false,newDescriptionVisible:false,renderedText:text});await page.screenshot({path:path.join(output,'audit-before-detail-repair.png'),fullPage:true});await context.close();
 }
 result.status='passed-first-two-repairs-and-confirmed-audit-gap';
} catch(error){result.status='probe-error';result.error={name:error.name,message:error.message};process.exitCode=1;}
finally {for(const release of releases)release();if(browser)await browser.close();if(web){web.kill('SIGTERM');await new Promise(r=>web.once('exit',r));}if(log)await log.close();if(api)await api.close();result.sourceAfter=await hashes();result.sourceChanged=sources.filter(p=>result.sourceBefore[p]!==result.sourceAfter[p]);result.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,observations:result.observations,error:result.error,sourceChanged:result.sourceChanged}));}
