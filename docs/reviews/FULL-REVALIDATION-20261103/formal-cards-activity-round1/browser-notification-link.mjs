import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {startSyntheticApi} from '../../../../scripts/e2e/server.mjs';
const root=process.cwd(),output=path.join(root,'docs/reviews/FULL-REVALIDATION-20261103/formal-cards-activity-round1/browser-comment-retention');await fs.mkdir(output,{recursive:true});
const sources=['apps/web/src/app/inbox/page.tsx','apps/api/src/adapters/comments.ts','apps/api/src/adapters/notifications.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex')])));
const result={executor:'collaboration:/root/formal_cards_activity_round1',kind:'local synthetic mounted PostgreSQL + actual Chrome observation, not acceptance pass',startedAt:new Date().toISOString(),sourceBefore:await hashes(),network:[]};
let api,web,browser,log,release;const pending=new Promise(r=>release=r);
try{
 api=await startSyntheticApi();const f=await api.fixture();
 const body='Notification link @Synthetic member';await f.call('owner','POST',`/api/v1/cards/${f.cards[0].id}/comments`,{body,mentions:[{userId:f.people.member.user.id,start:body.indexOf('@'),end:body.length}]});
 web=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'dev','-p','44932','-H','127.0.0.1'],{cwd:path.join(root,'apps/web'),env:{...process.env,API_URL:'http://127.0.0.1:44931',NEXT_DIST_DIR:'.next-independent-notification-link',NEXT_EXPORT:'false',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 log=await fs.open(path.join(output,'next.log'),'w');web.stdout.on('data',x=>void log.write(x));web.stderr.on('data',x=>void log.write(x));
 const until=Date.now()+90000;while(true){try{if((await fetch('http://127.0.0.1:44932/signin')).ok)break;}catch{}if(Date.now()>until)throw new Error('Next startup timeout');await new Promise(r=>setTimeout(r,300));}
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await context.addCookies([{name:'flowboard_session',value:f.people.member.session.id,domain:'127.0.0.1',path:'/',sameSite:'Lax',httpOnly:true}]);
 const page=await context.newPage();page.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))result.network.push({method:r.request().method(),path:u.pathname,status:r.status()});});
 await page.goto('http://127.0.0.1:44932/inbox',{waitUntil:'networkidle',timeout:60000});
 const open=page.getByRole('link',{name:'Open card',exact:true});await expect(open).toBeVisible();
 const href=await open.getAttribute('href');const sourceLink=(await api.pool.query('SELECT link FROM notifications WHERE user_id=$1',[f.people.member.user.id])).rows[0].link;
 await open.click();await page.waitForURL(/\/board\?id=/);await expect(page.getByText('Regression card 01',{exact:true}).first()).toBeVisible();await page.waitForLoadState('networkidle');
 result.observation={sourceLink,renderedHref:href,finalPath:new URL(page.url()).pathname+new URL(page.url()).search,cardDialogCount:await page.getByRole('dialog').count(),targetCardVisibleOnBoard:true};
 await page.screenshot({path:path.join(output,'notification-opens-board-without-target-card.png'),fullPage:true});assert.equal(new URL(page.url()).searchParams.has('card'),false);assert.equal(result.observation.cardDialogCount,0);
 result.browser=await browser.version();result.status='observed-defect';
}catch(error){result.status='probe-error';result.error={name:error.name,message:error.message};process.exitCode=1;}
finally{release();if(browser)await browser.close();if(web){web.kill('SIGTERM');await new Promise(r=>web.once('exit',r));}if(log)await log.close();if(api)await api.close();result.sourceAfter=await hashes();result.sourceChanged=sources.filter(p=>result.sourceBefore[p]!==result.sourceAfter[p]);result.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,observation:result.observation,error:result.error,sourceChanged:result.sourceChanged}));}
