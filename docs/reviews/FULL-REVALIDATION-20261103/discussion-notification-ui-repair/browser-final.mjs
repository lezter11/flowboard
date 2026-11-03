import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { startSyntheticApi } from '../../../../scripts/e2e/server.mjs';

const root=process.cwd(), output=path.join(root,'docs/reviews/FULL-REVALIDATION-20261103/discussion-notification-ui-repair/browser-final');
await fs.mkdir(output,{recursive:true});
const sources=['apps/web/src/lib/comment-state.ts','apps/web/src/lib/protected-drafts.ts','apps/web/src/components/board/card-comments.tsx','apps/web/src/app/inbox/page.tsx','apps/web/src/lib/notification-link.ts','apps/web/src/lib/activity.ts','apps/web/src/components/board/card-detail-drawer.tsx','apps/web/src/components/board/activity-details.tsx','apps/web/src/components/board/board-view.tsx','apps/web/src/app/activity/page.tsx'];
sources.push('apps/web/src/lib/session.tsx','apps/web/src/lib/cursor-feed.ts','apps/web/src/lib/retained-command.ts','apps/web/src/components/board/comment-composer.tsx','apps/api/src/adapters/activity.ts','apps/api/src/adapters/comments.ts','apps/api/src/adapters/notifications.ts','packages/contracts/src/discussion.ts','packages/contracts/src/common.ts');
sources.push('apps/api/src/services/activity-people.ts','apps/api/src/services/person-suffix.ts');
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
   await page.screenshot({path:path.join(output,changed?'changed-edit-retained.png':'canonical-edit-cleared.png'),fullPage:true});
   if(!changed) {
     const currentAccess=(await f.call('owner','GET',`/api/v1/boards/${f.board.id}/access`)).data;
     await f.call('owner','PUT',`/api/v1/boards/${f.board.id}/grants/${f.people.member.user.id}`,{expectedAccessRevision:currentAccess.accessRevision});
     await drawer.getByRole('button',{name:'Close card details',exact:true}).click();await page.waitForURL(url=>!url.searchParams.has('card'));
     await page.getByText('Regression card 01',{exact:true}).first().click();release();
     const remounted=page.getByRole('dialog').first();await expect(remounted.getByRole('article',{name:'Comment by Synthetic member',exact:true}).getByText(original,{exact:true})).toBeVisible();await expect(remounted.getByRole('combobox',{name:'Edit your comment',exact:true})).toHaveCount(0);
     result.observations.push({flow:'unchanged baseline remount after access restoration',canonicalCopyDidNotReappear:true});
   }
   release();await context.close();
 }
 {
   const f=await api.fixture(), original='SYNTHETIC_UNCHANGED_PENDING_EDIT';
   const comment=(await f.call('member','POST',`/api/v1/cards/${f.cards[0].id}/comments`,{body:original,mentions:[]})).data;
   const {context,page}=await pageFor(f);await page.goto(`http://127.0.0.1:44932/board?id=${f.board.id}&card=${f.cards[0].id}`,{waitUntil:'networkidle',timeout:60000});
   const drawer=page.getByRole('dialog').first();await drawer.getByRole('article',{name:'Comment by Synthetic member',exact:true}).getByRole('button',{name:'Edit your comment',exact:true}).click();
   const commentsPath=`/api/v1/cards/${f.cards[0].id}/comments`,editPath=`/api/v1/comments/${comment.id}`;let lose=true,hold=false,release;const pending=new Promise(r=>release=r);releases.push(release);const sent=[];
   await page.route('**/api/v1/**',async route=>{const req=route.request(),u=new URL(req.url());
     if(req.method()==='PATCH'&&u.pathname===editPath){sent.push({key:req.headers()['idempotency-key'],body:req.postData()});if(lose){lose=false;const reply=await route.fetch();assert.equal(reply.status(),200);await route.abort('failed');return;}}
     if(hold&&req.method()==='GET'&&u.pathname!==commentsPath&&u.pathname!=='/api/v1/session')await pending;
     await route.continue().catch(()=>{});
   });
   await drawer.getByRole('button',{name:'Save comment',exact:true}).click();await expect(drawer.getByText('The server may have saved this. Retry the original request before editing; it will not post twice.',{exact:true})).toBeVisible();hold=true;
   const access=(await f.call('owner','GET',`/api/v1/boards/${f.board.id}/access`)).data;await f.call('owner','DELETE',`/api/v1/boards/${f.board.id}/grants/${f.people.member.user.id}`,{expectedAccessRevision:access.accessRevision});
   const denied=page.waitForResponse(r=>new URL(r.url()).pathname===commentsPath&&r.status()===404,{timeout:20000});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await denied;
   await expect(drawer.getByRole('combobox',{name:'Edit your comment',exact:true})).toHaveCount(0);const retry=drawer.getByRole('button',{name:'Retry original comment edit',exact:true});await expect(retry).toBeDisabled();
   const currentAccess=(await f.call('owner','GET',`/api/v1/boards/${f.board.id}/access`)).data;await f.call('owner','PUT',`/api/v1/boards/${f.board.id}/grants/${f.people.member.user.id}`,{expectedAccessRevision:currentAccess.accessRevision});
   const recovered=page.waitForResponse(r=>new URL(r.url()).pathname===commentsPath&&r.status()===200,{timeout:20000});await drawer.getByRole('button',{name:'Reload comments',exact:true}).click();await recovered;await expect(retry).toBeEnabled();await retry.focus();await page.keyboard.press('Enter');await expect(retry).toHaveCount(0);
   assert.equal(sent.length,2);assert.deepEqual(sent[1],sent[0]);const row=(await api.pool.query('SELECT version FROM comments WHERE id=$1',[comment.id])).rows[0];assert.equal(row.version,2);const updates=(await api.pool.query("SELECT COUNT(*)::int AS count FROM activity_log WHERE card_id=$1 AND action='comment_updated'",[f.cards[0].id])).rows[0].count;assert.equal(updates,1);
   result.observations.push({flow:'unknown edit reply then revocation and recovery',canonicalEditorHidden:true,retryDisabledWhileDenied:true,retryOriginalAfterAuthorizedRead:true,sameOriginalPayloadAndKey:true,oneSavedEdit:true});await page.screenshot({path:path.join(output,'original-edit-retry-after-recovery.png'),fullPage:true});release();await context.close();
 }
 {
   const f=await api.fixture();const body='Notification link @Synthetic member';await f.call('owner','POST',`/api/v1/cards/${f.cards[0].id}/comments`,{body,mentions:[{userId:f.people.member.user.id,start:body.indexOf('@'),end:body.length}]});
   const {context,page}=await pageFor(f);await page.goto('http://127.0.0.1:44932/inbox',{waitUntil:'networkidle',timeout:60000});
   const open=page.getByRole('link',{name:'Open card',exact:true});await expect(open).toBeVisible();const href=await open.getAttribute('href');
   assert.equal(href,`/board?id=${encodeURIComponent(f.board.id)}&card=${encodeURIComponent(f.cards[0].id)}`);
   await open.focus();await page.keyboard.press('Enter');await page.waitForURL(/\/board\?id=/);const drawer=page.getByRole('dialog').first();await expect(drawer).toBeVisible();await expect(drawer.getByText('Regression card 01',{exact:true})).toBeVisible();
   result.observations.push({flow:'notification keyboard Open',renderedHref:href,cardDialogCount:await page.getByRole('dialog').count(),targetCardDetailVisible:true});await page.screenshot({path:path.join(output,'notification-opens-card.png'),fullPage:true});await context.close();
 }
 // Card ancestry controls: authorized-to-both wrong board, off-page lazy card,
 // and aggregate source-board routing without requiring prior loaded card data.
 {
   const f=await api.fixture(), {context,page}=await pageFor(f,'owner');
   await page.goto(`http://127.0.0.1:44932/board?id=${f.hiddenBoard.id}&card=${f.cards[0].id}`,{waitUntil:'networkidle',timeout:60000});let drawer=page.getByRole('dialog').first();await expect(drawer.getByText('This card is not available on this board.',{exact:true})).toBeVisible();assert.equal(await drawer.getByText('Synthetic full card description',{exact:true}).count(),0);assert.equal(await drawer.getByRole('textbox').count(),0);
   await page.goto(`http://127.0.0.1:44932/board?id=${f.board.id}&card=${f.cards[23].id}`,{waitUntil:'networkidle',timeout:60000});drawer=page.getByRole('dialog').first();await expect(drawer.getByText('Regression card 24',{exact:true})).toBeVisible();
   await page.goto(`http://127.0.0.1:44932/board?id=${f.hiddenBoard.id}&boards=${encodeURIComponent(f.hiddenBoard.id+','+f.board.id)}&cardBoard=${f.board.id}&card=${f.cards[0].id}`,{waitUntil:'networkidle',timeout:60000});drawer=page.getByRole('dialog').first();await expect(drawer.getByText('Synthetic full card description',{exact:true})).toBeVisible();
   result.observations.push({flow:'board ancestry',contradictoryAuthorizedBoardHidden:true,offpageDeepLinkVisible:true,aggregateSourceBoardVisible:true});await context.close();
 }
 {
   const f=await api.fixture();
   const unsafeLooking='<img src=x onerror="window.auditExecuted=true">';const long='LONG_HISTORY_SENTINEL '+('synthetic history '.repeat(200));
   await f.call('owner','PATCH',`/api/v1/cards/${f.cards[0].id}`,{expectedVersion:f.cards[0].version,assigneeIds:[f.people.member.user.id]});
   const current=(await f.call('owner','GET',`/api/v1/cards/${f.cards[0].id}`)).data;
   await f.call('owner','PATCH',`/api/v1/cards/${f.cards[0].id}`,{expectedVersion:current.version,title:'Audit AFTER sentinel',description:long,priority:'urgent',dueDate:'2026-11-10',assigneeIds:[]});
   const latest=(await f.call('owner','GET',`/api/v1/cards/${f.cards[0].id}`)).data;
   const placement=(await f.call('owner','GET',`/api/v1/boards/${f.board.id}/columns/${f.columns[1].id}/placement?movingCardId=${f.cards[0].id}&at=last`)).data;
   await f.call('owner','POST',`/api/v1/cards/${f.cards[0].id}/move`,{toColumnId:placement.toColumnId,previousCardId:placement.previousCardId,nextCardId:placement.nextCardId,expectedVersion:latest.version,expectedBoardVersion:placement.structureVersion});
   const second=(await f.call('owner','GET',`/api/v1/cards/${f.cards[1].id}`)).data;await f.call('owner','PATCH',`/api/v1/cards/${f.cards[1].id}`,{expectedVersion:second.version,description:unsafeLooking});
   const events=(await f.call('owner','GET',`/api/v1/cards/${f.cards[0].id}/activity`)).data;
   const assignment=events.find(e=>e.action==='card_updated'&&e.safeChanges?.assignees?.added?.length);assert.ok(assignment.referencedPeople?.some(p=>p.id===f.people.member.user.id&&p.displayName==='Synthetic member'));assert.ok(!JSON.stringify(assignment.referencedPeople).includes('@example.invalid'));assert.ok(!assignment.referencedPeople.some(p=>p.id===f.people.viewer.user.id));
   const {context,page}=await pageFor(f,'owner');await page.goto(`http://127.0.0.1:44932/board?id=${f.board.id}&card=${f.cards[0].id}`,{waitUntil:'networkidle',timeout:60000});let drawer=page.getByRole('dialog').first();await drawer.getByRole('tab',{name:'Activity',exact:true}).focus();await page.keyboard.press('ArrowRight');await drawer.getByRole('tab',{name:'Activity',exact:true}).click();
   await expect(drawer.getByText('updated the assignees on this card',{exact:false})).toBeVisible();await expect(drawer.getByText('Regression card 01',{exact:true})).toBeVisible();await expect(drawer.getByText('Synthetic member',{exact:true}).first()).toBeVisible();const longSummary=drawer.locator('summary').filter({hasText:'LONG_HISTORY_SENTINEL'});await expect(longSummary).toBeVisible();await longSummary.focus();await page.keyboard.press('Enter');await expect(drawer.getByText(long,{exact:true})).toBeVisible();
   for(const value of ['urgent','high','2026-11-10',f.columns[0].name,f.columns[1].name])await expect(drawer.locator('.activity-list').getByText(value,{exact:true}).first()).toBeVisible();
   await page.screenshot({path:path.join(output,'card-audit-details.png'),fullPage:true});
   for(const scope of ['project','workspace']) {
     await page.goto(scope==='project'?`http://127.0.0.1:44932/activity?project=${f.project.id}`:`http://127.0.0.1:44932/activity?scope=workspace&workspace=${f.project.workspaceId}`,{waitUntil:'networkidle',timeout:60000});
     await expect(page.getByText('updated the assignees on a card',{exact:false})).toBeVisible();await expect(page.getByText('Regression card 01',{exact:true})).toBeVisible();await expect(page.getByText('Synthetic member',{exact:true}).first()).toBeVisible();await expect(page.getByText(unsafeLooking,{exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>window.auditExecuted===true),false);assert.equal(await page.locator('.activity-event img').count(),0);
     for(const value of ['urgent','high','2026-11-10',f.columns[0].name,f.columns[1].name])await expect(page.locator('.activity-event').getByText(value,{exact:true}).first()).toBeVisible();
     await page.screenshot({path:path.join(output,`${scope}-audit-details.png`),fullPage:true});
   }
   result.observations.push({flow:'card project workspace audit',assignmentOnlyDescribed:true,referencedNamesOnly:true,oldAndNewFieldDetailsVisible:true,priorityAndDueDateVisible:true,fromToColumnsVisible:true,longDetailsKeyboardExpandable:true,htmlLikeTextInert:true});await context.close();
   const member=await pageFor(f);await member.page.goto(`http://127.0.0.1:44932/board?id=${f.board.id}&card=${f.cards[0].id}`,{waitUntil:'networkidle',timeout:60000});const memberDrawer=member.page.getByRole('dialog').first();await memberDrawer.getByRole('tab',{name:'Activity',exact:true}).click();await expect(memberDrawer.locator('.activity-list').getByText('Regression card 01',{exact:true})).toBeVisible();
   const activityPath=`/api/v1/cards/${f.cards[0].id}/activity`;let release;const pending=new Promise(r=>release=r);releases.push(release);
   await member.page.route('**/api/v1/**',async route=>{const u=new URL(route.request().url());if(route.request().method()==='GET'&&u.pathname!==activityPath&&u.pathname!=='/api/v1/session')await pending;await route.continue().catch(()=>{});});
   const access=(await f.call('owner','GET',`/api/v1/boards/${f.board.id}/access`)).data;await f.call('owner','DELETE',`/api/v1/boards/${f.board.id}/grants/${f.people.member.user.id}`,{expectedAccessRevision:access.accessRevision});
   const denied=member.page.waitForResponse(r=>new URL(r.url()).pathname===activityPath&&r.status()===404,{timeout:20000});await member.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await denied;await expect(memberDrawer.locator('.activity-list dl')).toHaveCount(0);assert.equal((await memberDrawer.locator('.activity-list').innerText()).includes('LONG_HISTORY_SENTINEL'),false);
   result.observations.push({flow:'activity refusal before other reads',safeDetailRowsRemoved:true,copiedHistoryTextAbsent:true});await member.page.screenshot({path:path.join(output,'history-detail-refusal.png'),fullPage:true});release();await member.context.close();
 }
 result.status='passed';
} catch(error){result.status='probe-error';result.error={name:error.name,message:error.message};process.exitCode=1;}
finally {for(const release of releases)release();if(browser)await browser.close();if(web){web.kill('SIGTERM');await new Promise(r=>web.once('exit',r));}if(log)await log.close();if(api)await api.close();result.sourceAfter=await hashes();result.sourceChanged=sources.filter(p=>result.sourceBefore[p]!==result.sourceAfter[p]);result.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,observations:result.observations,error:result.error,sourceChanged:result.sourceChanged}));}
