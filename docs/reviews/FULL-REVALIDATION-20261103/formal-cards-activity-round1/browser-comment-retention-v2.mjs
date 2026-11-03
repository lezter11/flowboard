import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {startSyntheticApi} from '../../../../scripts/e2e/server.mjs';
const root=process.cwd(),output=path.join(root,'docs/reviews/FULL-REVALIDATION-20261103/formal-cards-activity-round1/browser-comment-retention-v2');await fs.mkdir(output,{recursive:true});
const sources=['apps/web/src/lib/comment-state.ts','apps/web/src/components/board/card-comments.tsx','apps/web/src/components/board/card-detail-drawer.tsx','apps/web/src/lib/protected-drafts.ts','apps/web/src/lib/session.tsx'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex')])));
const result={executor:'collaboration:/root/formal_cards_activity_round1',kind:'local synthetic mounted PostgreSQL + actual Chrome observation, not acceptance pass',startedAt:new Date().toISOString(),sourceBefore:await hashes(),network:[]};
let api,web,browser,log,release;const pending=new Promise(r=>release=r);
try{
 api=await startSyntheticApi();const f=await api.fixture();
 const original='SYNTHETIC_UNCHANGED_FETCHED_COMMENT';
 const comment=(await f.call('member','POST',`/api/v1/cards/${f.cards[0].id}/comments`,{body:original,mentions:[]})).data;
 web=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'dev','-p','44932','-H','127.0.0.1'],{cwd:path.join(root,'apps/web'),env:{...process.env,API_URL:'http://127.0.0.1:44931',NEXT_DIST_DIR:'.next-independent-cards-retention-v2',NEXT_EXPORT:'false',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 log=await fs.open(path.join(output,'next.log'),'w');web.stdout.on('data',x=>void log.write(x));web.stderr.on('data',x=>void log.write(x));
 const until=Date.now()+90000;while(true){try{if((await fetch('http://127.0.0.1:44932/signin')).ok)break;}catch{}if(Date.now()>until)throw new Error('Next startup timeout');await new Promise(r=>setTimeout(r,300));}
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await context.addCookies([{name:'flowboard_session',value:f.people.member.session.id,domain:'127.0.0.1',path:'/',sameSite:'Lax',httpOnly:true}]);
 const page=await context.newPage();page.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))result.network.push({method:r.request().method(),path:u.pathname,status:r.status()});});
 await page.goto(`http://127.0.0.1:44932/board?id=${f.board.id}`,{waitUntil:'networkidle',timeout:60000});await page.getByText('Regression card 01',{exact:true}).first().click();const drawer=page.getByRole('dialog').first();
 const article=drawer.getByRole('article',{name:'Comment by Synthetic member',exact:true});await expect(article.getByText(original,{exact:true})).toBeVisible();await article.getByRole('button',{name:'Edit your comment',exact:true}).click();
 const editor=drawer.getByRole('combobox',{name:'Edit your comment',exact:true});await expect(editor).toHaveValue(original);await page.waitForLoadState('networkidle');
 const commentsPath=`/api/v1/cards/${f.cards[0].id}/comments`;
 let held=0;
 await page.route('**/api/v1/**',async route=>{const u=new URL(route.request().url());if(route.request().method()==='GET'&&u.pathname!==commentsPath&&u.pathname!=='/api/v1/session'){held++;await pending;}await route.continue().catch(()=>{});});
 const access=(await f.call('owner','GET',`/api/v1/boards/${f.board.id}/access`)).data;
 await f.call('owner','DELETE',`/api/v1/boards/${f.board.id}/grants/${f.people.member.user.id}`,{expectedAccessRevision:access.accessRevision});
 const denied=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname===commentsPath&&r.status()===404,{timeout:20000});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await denied;
 await expect(drawer.getByText('This comment is not currently editable. Your draft is kept; reload comments to check access.',{exact:true})).toBeVisible();
 result.observation={commentReadDenied404:true,ownChangesMade:false,editorVisible:await editor.isVisible(),editorValue:await editor.inputValue(),originalCommentArticleCount:await drawer.getByRole('article',{name:'Comment by Synthetic member',exact:true}).count(),heldOtherReadResponses:held};
 await page.screenshot({path:path.join(output,'after-comment-access-denial.png'),fullPage:true});assert.equal(result.observation.editorValue,original);assert.equal(result.observation.editorVisible,true);assert.equal(result.observation.originalCommentArticleCount,0);
 result.browser=await browser.version();result.status='observed-defect';
}catch(error){result.status='probe-error';result.error={name:error.name,message:error.message};process.exitCode=1;}
finally{release();if(browser)await browser.close();if(web){web.kill('SIGTERM');await new Promise(r=>web.once('exit',r));}if(log)await log.close();if(api)await api.close();result.sourceAfter=await hashes();result.sourceChanged=sources.filter(p=>result.sourceBefore[p]!==result.sourceAfter[p]);result.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,observation:result.observation,error:result.error,sourceChanged:result.sourceChanged}));}
