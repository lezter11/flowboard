import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
const location=(await fs.readFile(new URL('private-config-location.txt',import.meta.url),'utf8')).trim(),config=JSON.parse(await fs.readFile(location,'utf8'));
config.candidateSource=path.join(config.dir,'source-candidate');await fs.cp(config.source,config.candidateSource,{recursive:true});
const file='apps/api/src/services/import-xml.ts',original=await fs.readFile(path.join(config.source,file),'utf8');
const scalar="  for (const ch of xml) if (!validScalar(ch.codePointAt(0)!)) throw invalidXml('Invalid XML character.');",replacement="  if (/[^\\u0009\\u000a\\u000d\\u0020-\\ud7ff\\ue000-\\ufffd\\u{10000}-\\u{10ffff}]/u.test(xml)) throw invalidXml('Invalid XML character.');";
const scan=`  let segment = 0;
  for (let i = 0; i < xml.length; i++) {
    if (xml.charCodeAt(i) === 60) { if (++budget.markup > MAX_XML_MARKUP) throw xmlLimit(); segment = 0; }
    else if (++segment > MAX_XML_SEGMENT) throw xmlLimit();
  }`,newScan=`  let previous = -1;
  for (let i = xml.indexOf('<'); i !== -1; i = xml.indexOf('<', previous + 1)) {
    if (i - previous - 1 > MAX_XML_SEGMENT) throw xmlLimit();
    if (++budget.markup > MAX_XML_MARKUP) throw xmlLimit();
    previous = i;
  }
  if (xml.length - previous - 1 > MAX_XML_SEGMENT) throw xmlLimit();`;
if(!original.includes(scalar)||!original.includes(scan))throw Error('Source anchor drift');const candidate=original.replace(scalar,replacement).replace(scan,newScan);await fs.writeFile(path.join(config.candidateSource,file),candidate);await fs.writeFile(location,JSON.stringify(config),{mode:0o600});
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');await fs.writeFile(new URL('mounted-candidate-delta.json',import.meta.url),JSON.stringify({file,originalSha256:hash(original),candidateSha256:hash(candidate),diagnosticOnly:true,changes:[{before:scalar,after:replacement},{before:scan,after:newScan}]},null,2)+'\n');console.log('Separate diagnostic clone prepared with exactly two scan substitutions.');
