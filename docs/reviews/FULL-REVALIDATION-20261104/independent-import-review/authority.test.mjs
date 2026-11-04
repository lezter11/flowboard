import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { lifecycleFixture } from '../../../../apps/api/test/support/lifecycle-fixture.ts';
import { workbook } from '../../../../apps/api/test/support/import-workbook.ts';
import { createPersonalAccessToken } from '../../../../apps/api/src/adapters/tokens.ts';

test('Independent mounted import authority, exact text, report and revoked receipt', async t => {
  const f = await lifecycleFixture(t);
  let checks = 0;
  const equal = (actual, expected, label) => { assert.equal(actual, expected, label); checks++; };
  const bytes = workbook([{externalId:'00001',title:'=Literal &#65;',description:'  &amp;#65; &unknown; 🙂  ',priority:'high'}],{inlineStrings:true});
  const upload = (actor, extra = {}) => f.app.request('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col', { method:'POST',headers:{...(actor ? {cookie:`flowboard_session=${f.actors[actor].session.id}`} : {}),origin:'http://localhost','content-type':'application/octet-stream',...extra},body:bytes });
  equal((await upload(null)).status,401,'anonymous');
  equal((await upload('owner',{origin:'https://hostile.example'})).status,403,'cross-site cookie');
  for(const [actor,status] of [['member',403],['viewer',403],['outsider',404]]) equal((await upload(actor)).status,status,actor);
  const before=Number((await f.pool.query('SELECT COUNT(*) AS n FROM card_imports')).rows[0].n); equal(before,0,'denied writes stage nothing');
  const created=await upload('manager');equal(created.status,201,'granted manager');const preview=(await created.json()).data;
  equal(preview.rows[0].externalId,'00001','leading zeros');equal(preview.rows[0].title,'=Literal &#65;','literal entity-like title');equal(preview.rows[0].description,'  &amp;#65; &unknown; 🙂  ','literal entity-like description');
  const pat=await createPersonalAccessToken(f.pool,{userId:f.actors.owner.user.id,name:'Independent import denied token',scopes:['projects:read','boards:read','cards:read','cards:create'],projectId:'prj'});
  for(const [method,route] of [['GET','/import/template'],['GET','/boards/brd/import-template'],['POST','/boards/brd/imports'],['POST','/boards/brd/card-imports'],['GET',`/imports/${preview.id}`],['GET',`/card-imports/${preview.id}`],['POST',`/imports/${preview.id}/mappings`],['POST',`/imports/${preview.id}/commit`],['DELETE',`/imports/${preview.id}`],['GET',`/imports/${preview.id}/report`]]) {
    const denied=await f.app.request('http://localhost/api/v1'+route,{method,headers:{authorization:`Bearer ${pat.token}`,cookie:`flowboard_session=${f.actors.owner.session.id}`}});equal(denied.status,403,'PAT '+method+route);equal((await denied.json()).data,undefined,'no PAT data');
  }
  const body={expectedVersion:preview.version,previewDigest:preview.previewDigest,defaultColumnId:'col'};
  equal((await f.request('POST',`/imports/${preview.id}/commit`,'manager',{...body,previewDigest:'tampered'})).status,409,'tampered digest');
  equal((await f.request('POST',`/imports/${preview.id}/commit`,'manager',{...body,defaultColumnId:'col2'})).status,409,'destination override');
  const key=crypto.randomUUID();equal((await f.request('POST',`/imports/${preview.id}/commit`,'manager',body,key)).status,200,'explicit commit');
  const card=(await f.pool.query("SELECT title,description FROM cards WHERE id=(SELECT card_id FROM card_import_duplicates WHERE external_id='00001')")).rows[0];equal(card.title,'=Literal &#65;','committed title');equal(card.description,'  &amp;#65; &unknown; 🙂  ','committed description');
  const report=await f.request('GET',`/imports/${preview.id}/report`,'manager');equal(report.status,200,'safe report');assert.ok((await report.text()).includes("'=Literal &#65;"));checks++;
  const replay=await f.request('POST',`/imports/${preview.id}/commit`,'manager',body,key);equal(replay.status,200,'lost response retry');equal((await replay.json()).replayed,true,'same receipt');
  await f.pool.query("DELETE FROM board_grants WHERE board_id='brd' AND user_id=$1",[f.actors.manager.user.id]);
  for(const [method,route,requestBody] of [['GET',`/imports/${preview.id}`],['GET',`/imports/${preview.id}/report`],['POST',`/imports/${preview.id}/commit`,body]]) equal((await f.request(method,route,'manager',requestBody,key)).status,404,'revoked manager '+method+route);
  equal(Number((await f.pool.query("SELECT COUNT(*) AS n FROM cards WHERE title='=Literal &#65;' ")).rows[0].n),1,'one logical effect');
  t.diagnostic(JSON.stringify({checks,pass:true,scope:'mounted current identity/token/project+board grants/receipt authority with real PostgreSQL; no source edits'}));
});
