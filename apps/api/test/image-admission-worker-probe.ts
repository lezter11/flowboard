// Test-only entry: actual app/auth/PostgreSQL, with a deliberately uncooperative
// verifier so workerd response timeout can be observed independently of its work.
import {createApp} from '../src/http/app.ts';
import {createPool} from '../src/adapters/postgres.ts';
import {MemoryStorageDriver} from '../src/adapters/storage.ts';
import type {ExecutionContext} from 'hono';
const storage=new MemoryStorageDriver();
const pending=new Set<()=>void>();
let released=false;
let calls=0;
export default {
  async fetch(request:Request,env:{DATABASE_URL:string},ctx:ExecutionContext){
    const path=new URL(request.url).pathname;
    if(path==='/__image_test/state')return Response.json({pending:pending.size,calls});
    if(path==='/__image_test/release'){
      released=true;
      for(const release of pending)release();
      return Response.json({released:true});
    }
    const pool=createPool(env.DATABASE_URL,1);
    let imageWork:Promise<void>|undefined;
    const deadlineMs=path.endsWith('/content')&&!released?250:5000;
    const app=createApp(async()=>{},{pool,storage,deadlineMs,onImageWorkLifetime:work=>{imageWork=work;},imageVerifier:{verify:async()=>{
      calls++;
      if(released)return;
      let resume!:()=>void;
      const wait=new Promise<void>(r=>resume=r);
      pending.add(resume);
      try{await wait;}finally{pending.delete(resume);}
    }},rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
    try{return await app.fetch(request,undefined,ctx);}finally{
      if(imageWork)ctx.waitUntil(imageWork.then(()=>pool.end()));
      else await pool.end();
    }
  }
};
