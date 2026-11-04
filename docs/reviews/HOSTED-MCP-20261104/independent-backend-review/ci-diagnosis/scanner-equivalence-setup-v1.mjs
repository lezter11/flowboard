// Independent correctness comparisons only; not a product or timing acceptance test.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=new URL('../../../../../',import.meta.url);
const original=new URL('apps/api/src/services/import-xml.ts',root);
const candidate=pathToFileURL('/var/folders/jr/scqd6q3j7nggl004yfg9_vsh0000gn/T/flowboard-linux-xlsx-OjWZdf/source-candidate/apps/api/src/services/import-xml.ts');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const expectedOriginal='dd9b5c7f1abbc1a4e366dbe7cc17d5a8a32de6a5aeb6e7beae2c439154e11fdc',expectedCandidate='185d0f47bd7bac63e97529e376d4eba687d31826c9d35cd9ea4439d25690b96d';
assert.equal(sha(await fs.readFile(original)),expectedOriginal);assert.equal(sha(await fs.readFile(candidate)),expectedCandidate);
const hooks=registerHooks({resolve(specifier,context,next){return next(specifier==='fast-xml-parser'?new URL('node_modules/fast-xml-parser/src/fxp.js',root).href:specifier,context);}});
const left=await import(original.href),right=await import(candidate.href);
assert.equal(left.MAX_XML_SEGMENT,right.MAX_XML_SEGMENT);assert.equal(left.MAX_XML_MARKUP,right.MAX_XML_MARKUP);
const cap=left.MAX_XML_SEGMENT,markupCap=left.MAX_XML_MARKUP,results=[];
const utf8=s=>Buffer.from(s,'utf8');
const utf16=(s,be=false,bom=true)=>{const bytes=Buffer.concat([bom?Buffer.from([255,254]):Buffer.alloc(0),Buffer.from(s,'utf16le')]);return be?bytes.swap16():bytes;};
const stable=value=>JSON.stringify(value,(_key,v)=>v instanceof Map?[...v.entries()]:v);
function execute(module,parts,count,throwAt){const budget={markup:count};let checks=0;const output=[];for(const bytes of parts){try{const tree=module.parseXmlPart(bytes,()=>{checks++;if(checks===throwAt){const error=new Error('Independent deterministic checkpoint');error.code='REVIEW_CHECKPOINT';throw error;}},budget);output.push({ok:true,treeSHA256:sha(stable(tree)),markup:budget.markup,checks});}catch(error){output.push({ok:false,code:error.code??error.name,status:error.status??null,messageSHA256:sha(error.message),markup:budget.markup,checks});}}return output;}
function compare(id,parts,{count=0,throwAt=-1}={}){const a=execute(left,parts,count,throwAt),b=execute(right,parts,count,throwAt);assert.deepEqual(b,a,id);results.push({id,partBytes:parts.map(x=>x.length),startingMarkup:count,throwAt,outputs:a});}
const small=[['empty',''],['simple','<r/>'],['leading-text','x<r/>'],['trailing-text','<r/>x'],['comment-literal-less','<r><!-- << << --><c/></r>'],['cdata-literal-less','<r><![CDATA[<<<< &amp;]]></r>'],['attribute-literal-less','<r a="<"/>'],['attribute-encoded-less','<r a="&lt;&amp;"/>'],['entity-once','<r>&amp;#x41;&amp;amp;</r>'],['namespace','<r xmlns="urn:r" xmlns:q="urn:q"><q:c a="x"/></r>'],['bad-scalar-before-xxe','<!DOCTYPE r><r>\u0001</r>'],['xxe-before-structure','<!DOCTYPE r><r>'+ 'x'.repeat(cap+1)+'</r>']];
for(const [id,s]of small)compare(id,[utf8(s)]);
for(const n of [0,8,9,10,11,12,13,14,31,32,0xd7ff,0xe000,0xfffd,0xfffe,0xffff,0x10000,0x1fffe,0x10ffff]){const s='<r>'+String.fromCodePoint(n)+'</r>';compare('scalar-'+n,[utf8(s)]);compare('utf16le-'+n,[utf16(s)]);compare('utf16be-'+n,[utf16(s,true)]);}
for(const [id,s]of [['lone-high','<r>\ud800</r>'],['lone-low','<r>\udfff</r>'],['reverse-surrogates','<r>\udc00\ud800</r>'],['paired-surrogates','<r>\ud800\udc00</r>']]){compare(id+'-le',[utf16(s)]);compare(id+'-be',[utf16(s,true)]);}
for(const [id,bytes]of [['utf8-surrogate',[0xed,0xa0,0x80]],['utf8-above-max',[0xf4,0x90,0x80,0x80]],['utf8-overlong',[0xc0,0x80]],['utf8-truncated',[0xe2,0x82]]])compare(id,[Buffer.concat([utf8('<r>'),Buffer.from(bytes),utf8('</r>')])]);
for(const size of [cap-1,cap,cap+1]){compare('plain-gap-'+size,[utf8('x'.repeat(size))]);compare('leading-gap-'+size,[utf8('x'.repeat(size)+'<r/>')],{count:markupCap});compare('inner-gap-'+size,[utf8('<r>'+'x'.repeat(size-2)+'</r>')]);}
const astral='\ud800\udc00'.repeat((cap-2)/2);compare('astral-gap-exact-codeunits',[utf16('<r>'+astral+'</r>')]);compare('astral-gap-plus-one-codeunit',[utf16('<r>'+astral+'x</r>')]);
for(const count of [0,1,markupCap-2,markupCap-1,markupCap]){for(const [id,s]of small.slice(1,9))compare(id+'-budget-'+count,[utf8(s)],{count});compare('shared-parts-'+count,[utf8('<r/>'),utf8('<r/>'),utf8('<r><c/></r>')],{count});}
for(const throwAt of [1,2,3,4])compare('checkpoint-order-'+throwAt,[utf8('<r><c>safe</c></r>')],{throwAt});
hooks.deregister();assert.equal(sha(await fs.readFile(original)),expectedOriginal);assert.equal(sha(await fs.readFile(candidate)),expectedCandidate);
const report={kind:'independent actual parseXmlPart correctness comparison; controlled checkpoints, not timing/production acceptance',sourceHashes:{original:expectedOriginal,candidate:expectedCandidate},cases:results.length,status:'pass',results,sourceUnchanged:true};
const output=new URL('./scanner-equivalence-result.json',import.meta.url);await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:report.cases,output:fileURLToPath(output),sourceUnchanged:true}));
