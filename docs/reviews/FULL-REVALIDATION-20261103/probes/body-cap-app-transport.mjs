import {serve} from '@hono/node-server';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {Agent} from 'undici';
import {routeAuthFixture} from '../../../../apps/api/test/support/route-auth-fixture.ts';
const control=process.env.FLOWBOARD_TRANSPORT_CONTROL??'baseline';
if(!['baseline','close','web-drain'].includes(control))throw new Error('Choose baseline, close or web-drain control.');
const run=process.env.FLOWBOARD_TRANSPORT_RUN??crypto.randomUUID();
if(!/^[a-zA-Z0-9_-]{1,40}$/.test(run))throw new Error('Invalid probe run name');
const cleanup=[];const f=await routeAuthFixture({after(fn){cleanup.push(fn);}});const events=[],results=[];
async function discardBeforeRefusal(request){
 const stream=request.body;if(!stream||stream.locked)return;
 const reader=stream.getReader();let timer;
 try{await Promise.race([(async()=>{let bytes=0;for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>11*1024*1024)break;}})(),new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);}finally{clearTimeout(timer);void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
}
const server=serve({fetch:async(request,env)=>{const response=await f.app.fetch(request,env);if(response.status===413&&control!=='baseline'){if(control==='web-drain')await discardBeforeRefusal(request);response.headers.set('Connection','close');}return response;},hostname:'127.0.0.1',port:0});
server.on('request',(req,res)=>{const record={path:req.url,bytes:Number(req.headers['content-length']),socket:req.socket.remotePort,requestComplete:false,ended:false};events.push(record);req.once('end',()=>record.ended=true);req.once('aborted',()=>record.aborted=true);req.once('error',e=>record.requestError=e.code);res.once('finish',()=>{record.status=res.statusCode;record.finished=true;record.requestComplete=req.complete;record.ended=req.readableEnded;});res.once('close',()=>{record.responseClosed=true;});});
if(!server.listening)await once(server,'listening');const port=server.address().port;
const agent=new Agent({connections:1,pipelining:1});
try{
 for(const [path,bytes]of [['/api/v1/boards/brd/cards',1048576],['/api/v1/boards/brd/cards',1048577],['/api/v1/boards/absent/imports',5308416],['/api/v1/boards/absent/imports',5308417],['/api/v1/boards/brd/cards',1048576]]){
 const start=performance.now();try{const r=await fetch(`http://127.0.0.1:${port}${path}`,{dispatcher:agent,method:'POST',headers:{Cookie:`flowboard_session=${f.actors.owner.session.id}`,Origin:'http://localhost:4173','Idempotency-Key':crypto.randomUUID(),'Content-Type':'application/octet-stream'},body:Buffer.alloc(bytes,65)});const text=await r.text();results.push({path,bytes,status:r.status,text,ms:performance.now()-start});}catch(error){results.push({path,bytes,error:error.name,code:error.cause?.code,ms:performance.now()-start});}}
}finally{await agent.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));for(const fn of cleanup.reverse())await fn();}
const out={kind:'synthetic mechanism diagnostic, not a passing test gate',control,results,events};await fs.writeFile(new URL(`../raw/body-cap-app-transport-repro-${control}-${run}.json`,import.meta.url),JSON.stringify(out,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(out));
