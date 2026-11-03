// Test-only workerd entry; ordinary requests delegate to the production Worker unchanged.
import worker, {type WorkerBindings} from '../src/runtime/worker.ts';
import {createApp} from '../src/http/app.ts';
import pg from 'pg';
import {createPool} from '../src/adapters/postgres.ts';
let captured: { text: string; values: unknown[] }[] = [];
const originalQuery = pg.Client.prototype.query;
(pg.Client.prototype as any).query = function (...args: any[]) {
  const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
  if (typeof text === 'string') captured.push({ text, values: Array.isArray(args[1]) ? args[1] : args[0]?.values ?? [] });
  return (originalQuery as any).apply(this, args);
};
export default {
  async fetch(request:Request,env:WorkerBindings,ctx:any){
    const path=new URL(request.url).pathname;
    if(path === '/__runtime_probe/sql') return Response.json(captured);
    if(!path.startsWith('/__runtime_probe/')) { captured = []; return worker.fetch(request,env,ctx); }
    const pool=createPool(env.DATABASE_URL!,1);
    const app=createApp(async()=>{},{pool,deadlineMs:50});
    app.get('/__runtime_probe/fault',()=>{throw new Error('synthetic_private_sql_sentinel SELECT password FROM secret_table');});
    app.get('/__runtime_probe/slow',async(c)=>{await pool.query("INSERT INTO runtime_probe_events(kind)SELECT 'worker_slow_completed' FROM pg_sleep(0.15)");return c.json({data:'done'});});
    try{return await app.fetch(request,env,ctx);}finally{await pool.end();}
  },
};
