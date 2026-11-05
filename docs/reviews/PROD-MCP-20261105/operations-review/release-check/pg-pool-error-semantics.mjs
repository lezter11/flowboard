import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire('/private/tmp/flowboard-prod-release-40e51e1/package.json');const Pool=require('pg-pool');
class FakeClient extends EventEmitter {
 constructor(){super();this._queryable=true;this._ending=false;this.endCalls=0;}
 connect(callback){queueMicrotask(()=>callback(null));}
 end(callback){this.endCalls++;this._ending=true;if(callback)queueMicrotask(callback);}
 query(text,values,callback){if(typeof values==='function')callback=values;if(text==='fail-active'){queueMicrotask(()=>this.emit('error',new Error('synthetic active socket failure')));}else queueMicrotask(()=>callback(null,{rows:[]}));}
}
const pool=new Pool({Client:FakeClient,max:1,idleTimeoutMillis:0});let poolErrors=0,evictedBeforeEmit=false;
pool.on('error',()=>{poolErrors++;evictedBeforeEmit=pool.totalCount===0&&pool.idleCount===0;});
const idle=await pool.connect();assert.equal(idle.listenerCount('error'),0);idle.release();assert.equal(idle.listenerCount('error'),1);idle.emit('error',new Error('synthetic idle socket failure'));
assert.equal(poolErrors,1);assert.equal(evictedBeforeEmit,true);assert.equal(idle.endCalls,1);
await assert.rejects(pool.query('fail-active'),/synthetic active socket failure/);assert.equal(poolErrors,1);await pool.end();
console.log(JSON.stringify({status:'pass',implementation:'installed pg-pool3.14.0 with fake EventEmitter clients, no real database',idleClientEvictedBeforePoolError:true,idleListenerRemovedWhileCheckedOut:true,poolQueryActiveErrorRejectsInsteadOfPoolEvent:true,liveCalls:0},null,2));
