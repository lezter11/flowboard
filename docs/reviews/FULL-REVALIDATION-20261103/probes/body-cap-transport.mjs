import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {serve} from '@hono/node-server';
import {once} from 'node:events';
import fs from 'node:fs/promises';
const report=[];
for(const cleanup of [true,false])for(const connectionClose of [false,true]){
 const events=[];const app=new Hono();app.use('*',bodyLimit({maxSize:1048576}));app.post('/read',async c=>{const x=await c.req.arrayBuffer();return c.json({data:x.byteLength});});
 const server=serve({hostname:'127.0.0.1',port:0,autoCleanupIncoming:cleanup,fetch:async(...args)=>{const r=await app.fetch(...args);if(connectionClose&&r.status===413)r.headers.set('connection','close');return r;}});
 server.on('request',(req,res)=>{const facts={event:'request',contentLength:Number(req.headers['content-length']),socket:req.socket.remotePort,ended:false,finished:false,responseClosed:false,aborted:false};events.push(facts);req.on('end',()=>{facts.ended=true;});req.on('aborted',()=>{facts.aborted=true;});res.on('finish',()=>{facts.finished=true;});res.on('close',()=>{facts.responseClosed=true;});});
 if(!server.listening)await once(server,'listening');const port=server.address().port;
 for(const bytes of [1048576,1048577,1048576]){const started=performance.now();try{const r=await fetch(`http://127.0.0.1:${port}/read`,{method:'POST',body:Buffer.alloc(bytes)});const body=await r.text();report.push({cleanup,connectionClose,bytes,status:r.status,body,ms:performance.now()-started});}catch(error){report.push({cleanup,connectionClose,bytes,error:error.name,code:error.cause?.code,ms:performance.now()-started});}}
 await new Promise(resolve=>setTimeout(resolve,600));report.push({cleanup,connectionClose,events});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
await fs.writeFile(new URL('../raw/body-cap-transport.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
