import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import {decodeXmlText,invalidXml} from '../../../../apps/api/src/services/import-xml.ts';
const original=execFileSync('git',['show','c1ccbf800e1ba5ebbdd8556eb935810a6fc4aef1:apps/api/src/services/import-xml.ts'],{encoding:'utf8'});
const start=original.indexOf('export function decodeXmlText('),end=original.indexOf('/** Only UTF8',start);
const js=stripTypeScriptTypes(original.slice(start,end).replace('export function','function'),{mode:'strip'});
const validScalar=n=>n===9||n===10||n===13||(n>=0x20&&n<=0xd7ff)||(n>=0xe000&&n<=0xfffd)||(n>=0x10000&&n<=0x10ffff);
const baseline=Function('invalidXml','validScalar',js+';return decodeXmlText;')(invalidXml,validScalar);
const outcome=(f,s)=>{try{return ['ok',f(s)]}catch(e){return ['error',e.status,e.code,e.message]}};
const atoms=['','x','&',';','amp','&amp;','&amp','&AMP;','&#65;','&#x41;','&lt;','&gt;','&quot;','&apos;','&unknown;','&#0;','&#xD800;','🙂','<','\n'];
let cases=0;
for(const a of atoms)for(const b of atoms)for(const c of atoms){const s=a+b+c;assert.deepEqual(outcome(decodeXmlText,s),outcome(baseline,s),JSON.stringify(s));cases++;}
for(const n of [1,100,20_000])for(const tail of atoms){const s='&amp;'.repeat(n)+tail;assert.deepEqual(outcome(decodeXmlText,s),outcome(baseline,s),`amp count ${n},tail ${JSON.stringify(tail)}`);cases++;}
console.log(JSON.stringify({status:'pass',cases,baselineCommit:'c1ccbf800e1ba5ebbdd8556eb935810a6fc4aef1',comparison:'exact return strings or status/code/message; original function stripped with native Node type stripper',limit:'pure decoder differential only; no mounted/runtime/database/performance claim'}));
