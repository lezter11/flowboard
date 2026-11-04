import fs from 'node:fs/promises';
const dir=new URL('./',import.meta.url),original=await fs.readFile(new URL('profile-import-xml.ts',dir),'utf8'),excel=await fs.readFile(new URL('profile-excel-parser.ts',dir),'utf8');
const oldScalar="  for (const ch of xml) if (!validScalar(ch.codePointAt(0)!)) throw invalidXml('Invalid XML character.');";
const newScalar="  if (/[^\\u0009\\u000a\\u000d\\u0020-\\ud7ff\\ue000-\\ufffd\\u{10000}-\\u{10ffff}]/u.test(xml)) throw invalidXml('Invalid XML character.');";
const oldPreflight=`  let segment = 0;
  for (let i = 0; i < xml.length; i++) {
    if (xml.charCodeAt(i) === 60) { if (++budget.markup > MAX_XML_MARKUP) throw xmlLimit(); segment = 0; }
    else if (++segment > MAX_XML_SEGMENT) throw xmlLimit();
  }`;
const newPreflight=`  let previous = -1;
  for (let i = xml.indexOf('<'); i !== -1; i = xml.indexOf('<', previous + 1)) {
    if (i - previous - 1 > MAX_XML_SEGMENT) throw xmlLimit();
    if (++budget.markup > MAX_XML_MARKUP) throw xmlLimit();
    previous = i;
  }
  if (xml.length - previous - 1 > MAX_XML_SEGMENT) throw xmlLimit();`;
if(!original.includes(oldScalar)||!original.includes(oldPreflight))throw Error('Candidate anchor drift');
for(const mode of ['scalar','preflight','both']){let xml=original;if(mode!=='preflight')xml=xml.replace(oldScalar,newScalar);if(mode!=='scalar')xml=xml.replace(oldPreflight,newPreflight);await fs.writeFile(new URL(`candidate-${mode}-import-xml.ts`,dir),xml);await fs.writeFile(new URL(`candidate-${mode}-excel-parser.ts`,dir),excel.replace("'./profile-import-xml.ts'",`'./candidate-${mode}-import-xml.ts'`));}
