import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { chromium } from '/workspace/node_modules/@playwright/test/index.mjs';
import { safeBrowserError } from '/workspace/scripts/e2e/hosted-mcp-browser-diagnostics.mjs';
const source=await fs.readFile('/evidence/baseline-original-runner.mjs','utf8');
const lines=source.split('\n');
const index=lines.findIndex(line=>line.includes('browser = await chromium.launch('));
const originalStatement=lines[index];
if(index!==216)throw new Error('Unexpected original source location');
try {
 await vm.runInNewContext(`(async()=>{\n${originalStatement}\n})()`,{chromium,process:{env:{}},browser:undefined},{filename:'/workspace/scripts/e2e/hosted-mcp-browser.mjs',lineOffset:index-1});
 process.exitCode=2;
}catch(error){
 console.log(JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,sourceSHA:'e5c5687aadfac676699e35015477d2c3d4df72b3',sourceHash:crypto.createHash('sha256').update(source).digest('hex'),originalStatementLine:index+1,...safeBrowserError(error),missingExecutable:error.message.includes("executable doesn't exist"),originalMacPath:error.message.includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')}));
 process.exitCode=1;
}
