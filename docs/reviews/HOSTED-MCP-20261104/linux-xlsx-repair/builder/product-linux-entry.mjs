import fs from'node:fs/promises';import {spawn}from'node:child_process';
const mode=process.argv[2],stats=async()=>({cpu:await fs.readFile('/sys/fs/cgroup/cpu.stat','utf8'),quota:await fs.readFile('/sys/fs/cgroup/cpu.max','utf8'),memory:await fs.readFile('/sys/fs/cgroup/memory.peak','utf8').catch(()=>null)});
const before=await stats();let args;
if(mode==='pressure')args=[process.execPath,['--test-concurrency=1','--test','apps/api/test/import-worker-template.test.ts']];
else if(mode==='parser')args=[process.execPath,['--test-concurrency=1','--test','apps/api/test/dependency-patches.test.ts','apps/api/test/dependency-parser-equivalence.test.ts','apps/api/test/import-xml-native-boundaries.test.ts','apps/api/test/import-xml-parser.test.ts','apps/api/test/import-xml-cell-parser.test.ts','apps/api/test/import-xml-text.test.ts']];
else if(mode==='api')args=['npm',['test','--workspace','@flowboard/api']];
else if(mode==='build')args=['npm',['run','build','--workspace','@flowboard/api']];else throw Error('Unknown fixture mode');
const p=spawn(args[0],args[1],{stdio:'inherit',env:process.env}),exitCode=await new Promise((r,j)=>{p.on('close',r);p.on('error',j)});console.log(JSON.stringify({kind:'product-whole-fixture-cgroup',mode,before,after:await stats(),exitCode,note:'Actual public product source and patch helper; no diagnostic package overlay or resolver hooks. Whole-fixture counters are not parser-only CPU.'}));process.exitCode=exitCode;
