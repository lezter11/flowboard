import assert from 'node:assert/strict';
import test from 'node:test';
import { closePool, getPool } from '../src/adapters/postgres.ts';

test('Global test pool refuses missing, shared-port or remote fallback before any connection exists',async()=>{
  const previous=process.env['DATABASE_URL'],mode=process.env['NODE_ENV'];
  await closePool();process.env['NODE_ENV']='test';
  try{
    delete process.env['DATABASE_URL'];assert.throws(()=>getPool());
    for(const candidate of ['postgres://flowboard_harness:synthetic@127.0.0.1:55432/flowboard_harness','postgres://flowboard_harness:synthetic@127.0.0.1:55479/flowboard_harness','postgres://flowboard_harness:synthetic@127.0.0.1/flowboard_harness','postgres://flowboard_harness:synthetic@remote.example:55931/flowboard_harness']){
      process.env['DATABASE_URL']=candidate;assert.throws(()=>getPool());await closePool();
    }
    process.env['DATABASE_URL']='postgres://flowboard_harness:synthetic@127.0.0.1:55931/flowboard_harness';
    const pool=getPool();assert.equal(pool.totalCount,0,'Creating the permitted pool must not connect for this safety test');
  }finally{await closePool();if(previous===undefined)delete process.env['DATABASE_URL'];else process.env['DATABASE_URL']=previous;if(mode===undefined)delete process.env['NODE_ENV'];else process.env['NODE_ENV']=mode;}
});
