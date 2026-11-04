import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require=createRequire('/workspace/package.json');
const {chromium}=require('@playwright/test');
const hash=async p=>crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex');
const browser=await chromium.launch({headless:true});
const browserVersion=await browser.version();await browser.close();
console.log(JSON.stringify({browserVersion,node:process.version,platform:process.platform,architecture:process.arch,execPath:process.execPath,execSHA256:await hash(process.execPath),playwright:require('@playwright/test/package.json').version,managedChromiumPath:chromium.executablePath(),browserSHA256:await hash(chromium.executablePath()),packageLockSHA256:await hash('/workspace/package-lock.json'),installedLockSHA256:await hash('/workspace/node_modules/.package-lock.json'),browserOverridePresent:Object.hasOwn(process.env,'FLOWBOARD_CHROME_EXECUTABLE'),nodeOptionsPresent:Object.hasOwn(process.env,'NODE_OPTIONS')}));
