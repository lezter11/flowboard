import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium,expect} from '@playwright/test';
import sharp from 'sharp';
import {startSyntheticApi} from '../../../../scripts/e2e/server.mjs';
import {createDevUserAndSession} from '../../../../apps/api/src/adapters/session.ts';
const root=process.cwd(),out=path.join(root,'docs/reviews/FULL-REVALIDATION-20261103/resume-cards-activity-review/browser-layout');
await fs.mkdir(out,{recursive:false});
const gateRun=process.env.FLOWBOARD_REVIEW_GATE_RUN;assert.match(gateRun??'',/^[a-z0-9-]+$/);
const frozen=JSON.parse(await fs.readFile(path.join(root,'docs/reviews/FULL-REVALIDATION-20261103/raw',gateRun,'source-before.json'),'utf8'));
async function changed(){const bad=[];for(const[p,h]of Object.entries(frozen.files))if(crypto.createHash('sha256').update(await fs.readFile(path.join(root,p))).digest('hex')!==h)bad.push(p);return bad;}
const result={executor:'collaboration:/root/resume_cards_activity_review',kind:'independent actual Chrome synthetic local acceptance; no hosted/provider approval',startedAt:new Date().toISOString(),functionalSourceDigest:frozen.digest,sourceBeforeChanged:await changed(),observations:[],network:[],externalRequests:[],pageErrors:[]};
assert.deepEqual(result.sourceBeforeChanged,[]);
let api,web,browser,log;
try{
 api=await startSyntheticApi();const f=await api.fixture(),cardId=f.cards[0].id;
 const title=('Long card title '.repeat(15)).slice(0,200),description='LONG_DESCRIPTION_START '+('unbroken'.repeat(1500))+' LONG_DESCRIPTION_END';
 const assignees=[f.people.owner.user.id,f.people.manager.user.id,f.people.member.user.id];
 for(let i=0;i<17;i++){
  const x=await createDevUserAndSession(`layout-${i}-${crypto.randomUUID()}@example.invalid`,`Very long synthetic teammate display name ${i}`,api.pool);assignees.push(x.user.id);
  await api.pool.query("INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at)VALUES($1,$2,$3,$4,'member','active',NOW(),NOW())",['pm_'+crypto.randomUUID(),f.project.id,f.project.workspaceId,x.user.id]);
  await api.pool.query('INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by)VALUES($1,$2,$3,$4,$5)',[f.board.id,f.project.id,f.project.workspaceId,x.user.id,f.people.owner.user.id]);
 }
 await f.call('owner','PATCH',`/api/v1/cards/${cardId}`,{expectedVersion:1,title,description,assigneeIds:assignees});
 for(let i=0;i<55;i++)await f.call('owner','POST',`/api/v1/cards/${cardId}/comments`,{body:`Layout comment ${String(i).padStart(2,'0')} `+('Long comment text '.repeat(30)),mentions:[]});
 const image=await sharp({create:{width:24,height:24,channels:3,background:{r:44,g:88,b:120}}}).png().toBuffer();
 for(let i=0;i<3;i++){
  const u=(await f.call('owner','POST',`/api/v1/cards/${cardId}/image-uploads`,{filename:`layout-image-${i}.png`,byteLength:image.length,contentType:'image/png',sha256:crypto.createHash('sha256').update(image).digest('hex')})).data;
  const response=await fetch(`http://127.0.0.1:44931/api/v1/image-uploads/${u.id}/content`,{method:'PUT',headers:{cookie:`flowboard_session=${f.people.owner.session.id}`,origin:'http://127.0.0.1:44931','content-type':'image/png','idempotency-key':crypto.randomUUID()},body:image});assert.equal(response.status,200);
  await f.call('owner','POST',`/api/v1/image-uploads/${u.id}/finalize`,{});
 }
 web=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'dev','-p','44932','-H','127.0.0.1'],{cwd:path.join(root,'apps/web'),env:{...process.env,NODE_ENV:'development',API_URL:'http://127.0.0.1:44931',NEXT_DIST_DIR:'.next',NEXT_EXPORT:'false',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 log=await fs.open(path.join(out,'next.log'),'w');web.stdout.on('data',x=>void log.write(x));web.stderr.on('data',x=>void log.write(x));
 const until=Date.now()+90000;while(true){try{if((await fetch('http://127.0.0.1:44932/signin')).ok)break;}catch{}if(Date.now()>until)throw new Error('Next startup timeout');await new Promise(r=>setTimeout(r,300));}
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});result.browser=await browser.version();
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(u.hostname)||['blob:','data:'].includes(u.protocol))return route.continue();result.externalRequests.push({origin:u.origin,path:u.pathname});return route.abort();});
 await context.addCookies([{name:'flowboard_session',value:f.people.owner.session.id,domain:'127.0.0.1',path:'/',sameSite:'Lax',httpOnly:true}]);const page=await context.newPage();
 page.on('pageerror',e=>result.pageErrors.push({name:e.name,message:e.message}));page.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))result.network.push({method:r.request().method(),path:u.pathname,status:r.status()});});
 await page.goto(`http://127.0.0.1:44932/board?id=${f.board.id}`,{waitUntil:'networkidle',timeout:60000});const opener=page.locator(`[data-card-id="${cardId}"] .card-open`);await expect(opener).toBeVisible();await opener.focus();await page.keyboard.press('Enter');let drawer=page.getByRole('dialog').first();await expect(drawer.getByLabel('Card title',{exact:true})).toHaveValue(title);await expect(drawer.locator('.assignee-chip')).toHaveCount(20);await expect(drawer.locator('.image-grid li')).toHaveCount(3);await expect(drawer.getByRole('article',{name:'Comment by Synthetic owner',exact:true})).toHaveCount(50);
 const more=drawer.getByRole('button',{name:'Load more comments',exact:true});await more.focus();await page.keyboard.press('Enter');await expect(drawer.getByRole('article',{name:'Comment by Synthetic owner',exact:true})).toHaveCount(55);
 await drawer.getByLabel('Card title',{exact:true}).focus();
 for(let i=0;i<30;i++){await page.keyboard.press('Tab');assert.equal(await drawer.evaluate(el=>el.contains(document.activeElement)),true);}
 assert.equal(await drawer.evaluate(el=>!el.closest('[inert]')&&!!document.querySelector('main')?.closest('[inert]')),true);
 result.observations.push({flow:'long detail lists and keyboard',titleLength:title.length,descriptionLength:description.length,assignees:20,commentsLoaded:55,commentContinuation:true,finalizedImages:3,tabStepsContained:30,backgroundInert:true});
 async function layout(label){await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(150);const metrics=await drawer.evaluate(el=>{const r=el.getBoundingClientRect(),s=el.querySelector('.drawer-scroll'),chips=el.querySelector('.assignee-chips');return{left:r.left,right:r.right,width:r.width,viewport:innerWidth,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,bodyScrolls:s.scrollHeight>s.clientHeight,assigneeScrollWidth:chips.scrollWidth,assigneeClientWidth:chips.clientWidth,rootZoom:getComputedStyle(document.documentElement).zoom};});assert.ok(metrics.left>=-1&&metrics.right<=metrics.viewport+1,JSON.stringify(metrics));assert.ok(metrics.scrollWidth<=metrics.clientWidth+1,JSON.stringify(metrics));assert.ok(metrics.assigneeScrollWidth<=metrics.assigneeClientWidth+1,JSON.stringify(metrics));const save=drawer.getByRole('button',{name:'Save changes',exact:true});await save.scrollIntoViewIfNeeded();await expect(save).toBeVisible();await drawer.getByRole('button',{name:'Close card details',exact:true}).scrollIntoViewIfNeeded();await expect(drawer.getByRole('button',{name:'Close card details',exact:true})).toBeVisible();await page.screenshot({path:path.join(out,label+'.png'),fullPage:true});result.observations.push({flow:label,...metrics,footerAndCloseReachable:true});}
 await page.setViewportSize({width:360,height:800});await layout('narrow360-long-detail');await page.setViewportSize({width:1440,height:1000});
 const zoomBefore=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio}));await page.keyboard.press('Meta+=');await page.keyboard.press('Meta+=');await page.keyboard.press('Meta+=');await page.keyboard.press('Meta+=');await page.waitForTimeout(200);const zoomAfter=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio}));
 if(zoomAfter.width<zoomBefore.width*.75){result.observations.push({flow:'native-browser-zoom-shortcut',before:zoomBefore,after:zoomAfter});await layout('native-zoom-long-detail');await page.keyboard.press('Meta+0');}
 else {await page.evaluate(()=>{document.documentElement.style.zoom='2';});await layout('css200percent-zoom-long-detail');await page.evaluate(()=>{document.documentElement.style.zoom='';});await page.setViewportSize({width:720,height:500});await layout('equivalent200percent-reflow720');await page.setViewportSize({width:1440,height:1000});result.observations.push({flow:'zoom qualification',nativeShortcutApplied:false,nativeBefore:zoomBefore,nativeAfter:zoomAfter,checked:'actual CSS zoom2 and720CSSpx reflow equivalent to200percent on1440; not native Chrome menu zoom'});}
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(opener).toBeFocused();result.observations.push({flow:'Escape focus restoration',sourceCardFocused:true});
 await page.getByRole('searchbox',{name:'Search cards',exact:true}).fill('Long card title');await expect(page.locator(`[data-card-id="${f.cards[1].id}"]`)).toHaveCount(0);await expect(page.locator(`[data-card-id="${cardId}"]`)).toBeVisible();assert.equal(await page.locator(`[data-card-id="${cardId}"]`).getAttribute('draggable'),null);
 const moveButton=page.locator(`[data-card-id="${cardId}"] .card-move`);await moveButton.focus();await page.keyboard.press('Enter');const move=page.getByRole('dialog',{name:'Move card',exact:true});await move.getByLabel('Position',{exact:true}).selectOption('before');await expect(move.getByLabel('Reference card',{exact:true})).toBeVisible();await expect(move.getByLabel('Reference card',{exact:true}).locator('option')).toHaveCount(24);await move.getByLabel('Reference card',{exact:true}).selectOption(f.cards[19].id);await move.getByRole('button',{name:'Move card',exact:true}).focus();await page.keyboard.press('Enter');await expect(move).toHaveCount(0);
 const order=(await api.pool.query("SELECT id FROM cards WHERE column_id=$1 AND state='active' ORDER BY position,id",[f.columns[0].id])).rows.map(x=>x.id);const idx=order.indexOf(cardId);assert.equal(order[idx+1],f.cards[19].id);assert.equal(order[idx-1],f.cards[18].id);const undo=page.getByRole('button',{name:'Undo',exact:true});await undo.focus();await page.keyboard.press('Enter');await expect.poll(async()=>{const rows=(await api.pool.query("SELECT id FROM cards WHERE column_id=$1 AND state='active' ORDER BY position,id LIMIT 1",[f.columns[0].id])).rows;return rows[0]?.id;}).toBe(cardId);
 result.observations.push({flow:'filtered keyboard before Move and Undo',ambiguousDragDisabled:true,fullDestinationReferenceOptions:23,actualNeighborPairVerified:true,undoRestoredFirst:true});
 assert.deepEqual(result.pageErrors,[]);assert.deepEqual(result.externalRequests,[]);result.status='passed';await context.close();
}catch(e){result.status='failed';result.error={name:e.name,message:e.message};process.exitCode=1;}
finally{if(browser)await browser.close();if(web){web.kill('SIGTERM');await new Promise(r=>web.once('exit',r));}if(log)await log.close();if(api)await api.close();result.sourceAfterChanged=await changed();result.finishedAt=new Date().toISOString();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,observations:result.observations,error:result.error,sourceAfterChanged:result.sourceAfterChanged}));}
