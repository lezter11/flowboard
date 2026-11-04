import assert from 'node:assert/strict';
import {handleHostedMcpTransport} from '../../../../apps/api/src/services/hosted-mcp-transport.ts';
const controller=new AbortController();controller.abort();let cancelled=false;
const body=new ReadableStream({cancel(){cancelled=true;}});
const request=new Request('https://flowboard.example/api/v1/mcp',{method:'POST',headers:{accept:'application/json, text/event-stream','content-type':'application/json'},signal:controller.signal,body,duplex:'half'});
const operations={listProjects:async()=>[],listBoards:async()=>[],getBoard:async()=>({}),createCard:async()=>({}),searchCards:async()=>[]};
const result=await Promise.race([handleHostedMcpTransport(request,operations),new Promise(resolve=>setTimeout(()=>resolve(null),100))]);
assert.ok(result,'already-aborted body must settle without manual close');assert.equal(cancelled,true);assert.equal(result.status,400);
console.log(JSON.stringify({alreadyAborted:true,settledWithoutManualClose:true,bodyCancelled:cancelled,responseStatus:result.status}));
