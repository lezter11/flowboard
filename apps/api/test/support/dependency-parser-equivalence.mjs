import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { XMLParser as Candidate } from 'fast-xml-parser';

/** Compare the actual installed backport with a byte-verified upstream copy.
 * Only the temporary copy is reconstructed; installed dependencies stay read-only.
 * A temporary dependency-directory symlink supplies the same dependency versions;
 * there are no resolver or parser behavior hooks.
 */
export async function runParserBackportEquivalence() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'flowboard-parser-equivalence-'));
  try {
    const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.resolve('fast-xml-parser'))));
    const baseline = path.join(temporary, 'upstream');
    await fs.cp(packageRoot, baseline, { recursive: true });
    await fs.symlink(path.dirname(packageRoot), path.join(temporary, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const manifestUrl = new URL('../../vendor-patches/fast-xml-parser-5.11.2/manifest.json', import.meta.url);
    const manifest = JSON.parse(await fs.readFile(manifestUrl, 'utf8'));
    const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
    for (const record of manifest.files) {
      const file = path.join(baseline, record.path), bytes = await fs.readFile(file, 'utf8');
      assert.equal(hash(bytes), record.patchedSha256, 'Test must exercise the actual verified backport.');
      const patch = JSON.parse(await fs.readFile(new URL(record.patch, manifestUrl), 'utf8'));
      const upstream = bytes.replace(patch.after, patch.before);
      assert.equal(hash(upstream), record.upstreamSha256);
      await fs.writeFile(file, upstream);
    }
    const { XMLParser: Original } = await import(pathToFileURL(path.join(baseline, 'src/fxp.js')).href);
const selected={preserveOrder:true,ignoreAttributes:false,attributeNamePrefix:'',parseTagValue:false,parseAttributeValue:false,trimValues:false,processEntities:false,htmlEntities:false,cdataPropName:'#cdata',commentPropName:'#comment',ignorePiTags:true,ignoreDeclaration:true,maxNestedTags:64};
const options=[['default',{}],['selected',selected],['ordered-metadata',{...selected,captureMetaData:true}],['default-metadata',{captureMetaData:true,ignoreAttributes:false}],['all-attributes-raw',{ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false,alwaysCreateTextNode:true}],['stop-nodes',{ignoreAttributes:false,preserveOrder:true,stopNodes:['r.stop'],captureMetaData:true}],['unpaired',{ignoreAttributes:false,preserveOrder:true,unpairedTags:['br'],captureMetaData:true}],['pi-cdata-comments',{ignoreAttributes:false,preserveOrder:true,commentPropName:'#comment',cdataPropName:'#cdata',ignorePiTags:false,captureMetaData:true}],['entities-html',{ignoreAttributes:false,htmlEntities:true,processEntities:true}],['no-entities',{ignoreAttributes:false,processEntities:false}],['matcher-callbacks',{ignoreAttributes:false,captureMetaData:true,jPath:false}],['transforms',{ignoreAttributes:false,removeNSPrefix:true,transformTagName:n=>n==='rename'?'renamed':n,transformAttributeName:n=>'p_'+n}],['typed-processors',{ignoreAttributes:false,parseTagValue:true,parseAttributeValue:true}],['grouped-arrays',{ignoreAttributes:false,attributesGroupName:'attrs',alwaysCreateTextNode:true}]];
const corpus=['','plain tail no next delimiter','\ud800\udc00\ud800\udc00','<r/>','<r></r>','<r>text</r>','<r>before<c/>after</r>','<r>one<c>two</c>three<d/>four</r>','<r>trailing no close','<r/>tail without less-than','leading text<r/>tail','<r>😀🙂𝄞</r>','<r>left\ud800middle\udc00right</r>','<r>\r\nA\rB\n<c/>😀tail</r>','<r> &lt;child/&gt; &amp;#65; &#65; &#x1F600; </r>','<r a="&amp;" b="hello > world" c="😀">x</r>','<r a="literal < value">raw</r>','<r a="1" a="2">x</r>','<?xml version="1.0"?><r>zero<?p a="1"?>one</r>','<r>A<!-- <comment/> &amp; -->B<![CDATA[C <d/> &amp; 😀]]>D</r>','<r><![CDATA[]]><c/>tail</r>','<r><stop a="1"> raw <b>nested</b> &amp; <![CDATA[<c/>]]> </stop><c>after</c></r>','<r><br>one<br/>two<c>three</c></r>','<r><rename a="x">value</rename><drop>discard</drop><item>one</item><item>two</item></r>','<r xmlns:n="urn:test"><n:c n:a="1">content</n:c></r>','<!DOCTYPE r [<!ENTITY sample "value">]><r>&sample;</r>','<r>&unknown;</r>','<r>&amp</r>','<r>&#0;</r>','<r>&#xD800;</r>','<r>&#x110000;</r>','<r>unclosed<','<r><!-- broken','<r><![CDATA[broken','<r><?p broken','<r><c></r>','<r/> extra <s/>','<r>'+'a'.repeat(10000)+'</r>'];
let seed=20261104;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};for(let i=0;i<100;i++){let value='';for(let j=0;j<80;j++)value+=['a',' ','😀','\r\n','&amp;','&lt;','&#65;','é','_','0'][next()%10];corpus.push(`<r a="${i}">${value}<c>${i}</c>${value}</r>`);}
const text='<r>α😀<c a="β">𐀀tail</c></r>';corpus.push(new Uint8Array(Buffer.from(text,'utf8')),Buffer.from(text,'utf8'),Buffer.from(text,'utf16le'));
function normalize(value,metadata){if(value===null||typeof value!=='object')return value;const entries=Reflect.ownKeys(value).map(k=>[k===metadata?'[[XML_METADATA]]':typeof k==='symbol'?'[[SYMBOL:'+k.description+']]':k,normalize(value[k],metadata)]);return {type:Array.isArray(value)?'array':Object.getPrototypeOf(value)===null?'null-prototype-object':'object',entries};}
function run(Parser,base,input,validation){const trace=[],metadata=Parser.getMetaDataSymbol(),context=v=>v&&typeof v==='object'&&typeof v.getCurrentTag==='function'?{path:v.toString(),tag:v.getCurrentTag()}:v;const opts={...base};opts.updateTag=(name,jPath,attrs)=>{trace.push(['updateTag',name,context(jPath),normalize(attrs,metadata)]);return name==='drop'?false:name;};opts.tagValueProcessor=(name,value,jPath,...rest)=>{trace.push(['tagValueProcessor',name,value,context(jPath),...rest]);return base.parseTagValue===true&&name==='c'?String(value)+'!':value;};opts.attributeValueProcessor=(name,value,jPath)=>{trace.push(['attributeValueProcessor',name,value,context(jPath)]);return value;};opts.isArray=(...args)=>{trace.push(['isArray',...args.map(context)]);return args[0]==='item';};try{return {ok:true,result:normalize(new Parser(opts).parse(input,validation),metadata),trace};}catch(error){return {ok:false,error:{name:error.name,message:error.message},trace};}}
let comparisons=0;for(const [name,opts]of options)for(const [index,input]of corpus.entries())for(const validation of [false,true]){assert.deepEqual(run(Candidate,opts,input,validation),run(Original,opts,input,validation),`${name} input${index} validation${validation}`);comparisons++;}
// Also compare untouched defaults without callback wrappers.
for(const [index,input]of corpus.entries())for(const validation of [false,true]){function bare(Parser){try{return {ok:true,result:normalize(new Parser().parse(input,validation),Parser.getMetaDataSymbol())};}catch(e){return {ok:false,error:{name:e.name,message:e.message}};}}assert.deepEqual(bare(Candidate),bare(Original),'pure defaults input'+index);comparisons++;}
return { comparisons, corpusInputs: corpus.length, optionSets: options.length, metadataAndCallbackTracesCompared: true };
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
