import fs from 'node:fs/promises';
import path from 'node:path';
import * as esbuild from 'esbuild';
const here=path.dirname(new URL(import.meta.url).pathname),root=process.cwd(),old=(await fs.readFile(here+'/old-source-path.txt','utf8')).trim();
for(const [name,tree] of [['old',old],['current',root]])await esbuild.build({entryPoints:[tree+'/apps/api/src/http/app.ts'],outfile:here+'/'+name+'-app.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@flowboard/contracts':tree+'/packages/contracts/src/index.ts'},logLevel:'warning'});
