import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../src/lib/api.ts';
import { createImportSessions, importReceiptActors, importedCardHref, importRowLabel, importProcessing, importMappingValue, importRowsPage, importStateText, unknownImportStatuses } from '../src/lib/import-state.ts';
import type { ImportStatus } from '@flowboard/contracts';
const status={id:'batch',version:2,state:'ready',previewDigest:'digest',rows:[{rowNumber:51,status:'Unmapped',errors:[{code:'UNRECOGNIZED_STATUS'}]}],nextCursor:'51'} as ImportStatus;
test('retained receipt links have a nonempty safe label without resurrecting original content',()=>{
  assert.equal(importRowLabel({rowNumber:2,title:null,contentRedacted:true}),'Open card from row 2');
  assert.equal(importRowLabel({rowNumber:3,title:''}),'Untitled source row 3');
  assert.equal(importRowLabel({rowNumber:4,title:'Original title'}),'Original title');
});
test('preview page retains row-number cursor and refuses a mixed generation',()=>{
  assert.equal(importRowsPage(status,status).data[0]?.id,'51');assert.equal(importRowsPage(status,status).nextCursor,'51');assert.deepEqual(unknownImportStatuses(status.rows),['Unmapped']);
  assert.throws(()=>importRowsPage({...status,version:3},status),(error)=>error instanceof ApiError&&error.code==='STALE_CURSOR');assert.throws(()=>importRowsPage({...status,state:'committed'},status));
});
test('only committed state says committed; processing and failures are distinct',()=>{assert.equal(importProcessing('committing'),true);assert.equal(importProcessing('ready'),false);assert.match(importStateText('committing'),/Waiting/);assert.equal(importStateText('committed'),'Import committed.');assert.equal(importedCardHref('b /1',{cardId:'c /2'}),'/board?id=b%20%2F1&card=c%20%2F2');assert.equal(importedCardHref('b',{cardId:null}),null);});
test('status cursor and mappings send exact current backend contracts',async()=>{
  const old=globalThis.fetch;const calls:Array<{url:URL;init?:RequestInit}>=[];const c=new AbortController();globalThis.fetch=async(url,init)=>{calls.push({url:new URL(String(url),'http://local'),init});return Response.json({data:status});};
  try{await api.getImportStatus('batch /1',{cursor:'51',limit:50,signal:c.signal});await api.updateImportMappings('batch /1',{mappings:{Unmapped:'column'},expectedVersion:2});assert.deepEqual(Object.fromEntries(calls[0]!.url.searchParams),{limit:'50',cursor:'51'});assert.equal(calls[0]!.init?.signal,c.signal);assert.equal(calls[1]!.url.pathname,'/api/v1/imports/batch%20%2F1/mappings');assert.deepEqual(JSON.parse(String(calls[1]!.init?.body)),{mappings:{},mappingEntries:[{sourceStatus:'Unmapped',columnId:'column'}],expectedVersion:2});}finally{globalThis.fetch=old;}
});
test('lost commit reply survives remount and retries original digest/default/version/key',async()=>{
  const old=globalThis.fetch;const calls:RequestInit[]=[];const sessions=createImportSessions();const session=sessions.forBatch('actor','batch');const input={previewDigest:'original',defaultColumnId:'column',expectedVersion:2};session.update({commit:input});globalThis.fetch=async(_url,init)=>{calls.push(init!);if(calls.length===1)throw new TypeError('lost reply');return Response.json({data:{...status,state:'committed'}});};
  try{await assert.rejects(session.command.run(input,(body,key)=>api.commitImport('batch',body,key)));const remounted=sessions.forBatch('actor','batch');await remounted.command.run({...input,previewDigest:'edited',expectedVersion:3},(body,key)=>api.commitImport('batch',body,key));assert.equal(calls[1]?.body,calls[0]?.body);assert.equal(new Headers(calls[1]?.headers).get('Idempotency-Key'),new Headers(calls[0]?.headers).get('Idempotency-Key'));assert.equal(sessions.forBatch('other','batch').get().commit,null);}finally{globalThis.fetch=old;}
});
test('CSV report downloads server bytes with same-origin credentials and refuses HTML success',async()=>{
  const old=globalThis.fetch;let init:RequestInit|undefined;globalThis.fetch=async(_url,options)=>{init=options;return new Response("'=formula,plain\n",{headers:{'Content-Type':'text/csv; charset=utf-8'}});};
  try{assert.equal(await(await api.getImportReport('batch')).text(),"'=formula,plain\n");assert.equal(init?.credentials,'same-origin');globalThis.fetch=async()=>new Response('<html>signin</html>',{headers:{'Content-Type':'text/html'}});await assert.rejects(api.getImportReport('batch'),(error)=>error instanceof ApiError&&error.code==='INVALID_RESPONSE');}finally{globalThis.fetch=old;}
});

test('workbook status labels cannot select inherited object keys as mappings',()=>{assert.equal(importMappingValue({},'constructor'),'');assert.equal(importMappingValue({},'__proto__'),'');assert.equal(importMappingValue({['__proto__']:'column'},'__proto__'),'column');});

test('receipt attribution uses backend facts and never invents the current viewer',()=>{assert.deepEqual(importReceiptActors({...status,state:'committed'}),{uploader:'Unknown uploader',confirmer:'Unknown confirmer'});assert.equal(importReceiptActors({...status,createdBy:{id:'actor',displayName:'Uploader',avatarUrl:null,activeInProject:true},committedBy:{id:'other',displayName:'Confirmer',avatarUrl:null,activeInProject:true},state:'committed'}).confirmer,'Confirmer');});
test('prototype-like source status is encoded as mappingEntries, not stripped record keys',async()=>{const old=globalThis.fetch;let body:unknown;globalThis.fetch=async(_url,init)=>{body=JSON.parse(String(init?.body));return Response.json({data:status});};try{await api.updateImportMappings('batch',{mappings:{['__proto__']:'column',constructor:'other'},expectedVersion:2});assert.deepEqual(body,{mappings:{},mappingEntries:[{sourceStatus:'__proto__',columnId:'column'},{sourceStatus:'constructor',columnId:'other'}],expectedVersion:2});}finally{globalThis.fetch=old;}});
