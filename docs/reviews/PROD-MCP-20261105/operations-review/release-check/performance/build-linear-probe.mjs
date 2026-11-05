import fs from 'node:fs/promises';
import path from 'node:path';
import * as esbuild from 'esbuild';
const root=process.cwd(),here=path.dirname(new URL(import.meta.url).pathname),main=root+'/apps/api/src/http/app.ts';
const needle='const app = new Hono<{ Variables: { requestId: string; pool?: pg.Pool; limits?: Limits } }>();';
await esbuild.build({entryPoints:[main],outfile:here+'/current-linear-app.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@flowboard/contracts':root+'/packages/contracts/src/index.ts'},plugins:[{name:'synthetic-main-linear-router',setup(build){build.onLoad({filter:/\/http\/app\.ts$/},async({path:loaded})=>{if(loaded!==main)return;const text=await fs.readFile(loaded,'utf8');if(text.split(needle).length!==2)throw new Error('Unexpected main app constructor shape');return {contents:"import { LinearRouter } from 'hono/router/linear-router';\n"+text.replace(needle,needle.replace('>();','>({ router: new LinearRouter() });')),loader:'ts'};});}}],logLevel:'warning'});
