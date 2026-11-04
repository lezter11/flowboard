export const profileTimings: unknown[] = [];
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { HttpError } from "/Users/shubham/.codex/worktrees/mcp-uat-repair/Flowboard/apps/api/src/http/errors.ts";

export const MAX_XML_MARKUP = 50_000;
export const MAX_XML_TEXT = 65_536;
// A valid20k-character description can use up to10source characters/reference.
export const MAX_XML_SEGMENT = MAX_XML_TEXT * 10;
export const MAX_XML_DEPTH = 64;
export const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const STRICT_SPREADSHEET_NS = 'http://purl.oclc.org/ooxml/spreadsheetml/main';
export const DOCUMENT_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const STRICT_DOCUMENT_REL_NS = 'http://purl.oclc.org/ooxml/officeDocument/relationships';
export const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

export const invalidXml = (message = 'Invalid workbook XML.') => HttpError.unprocessable('INVALID_WORKBOOK', message);
const xmlLimit = () => HttpError.unprocessable('XML_LIMIT_EXCEEDED', 'Workbook XML exceeds the supported structural or text limits.');
const validScalar = (n: number) => n === 9 || n === 10 || n === 13 || (n >= 0x20 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff);

/** Decode only original references. Replacement strings are never scanned a second time. */
export function decodeXmlText(value: string): string {
  const builtins: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return value.replace(/&([^;\s<&]*);|&/g, (original, entity: string | undefined) => {
    if (!entity) throw invalidXml('Malformed XML entity reference.');
    if (Object.hasOwn(builtins, entity)) return builtins[entity]!;
    if (!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity)) throw invalidXml('Unknown XML entity reference.');
    const n = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!validScalar(n)) throw invalidXml('Invalid XML character reference.');
    return String.fromCodePoint(n);
  });
}

/** Only UTF8 and UTF16 are supported. Fatal decoding prevents silent U+FFFD replacement. */
function decodeXmlBytes(bytes: Buffer): string {
  let encoding: 'utf-8' | 'utf-16le' | 'utf-16be' = 'utf-8';
  let bom = false;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; bom = true; }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; bom = true; }
  else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bom = true;
  else if (bytes[0] === 0 && bytes[1] === 0x3c && bytes[2] === 0 && bytes[3] === 0x3f) encoding = 'utf-16be';
  else if (bytes[0] === 0x3c && bytes[1] === 0 && bytes[2] === 0x3f && bytes[3] === 0) encoding = 'utf-16le';
  let xml: string;
  try { xml = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw invalidXml('Invalid or unsupported workbook XML encoding.'); }
  const declaration = xml.match(/^<\?xml\s+[^?]*\?>/u)?.[0];
  const declared = declaration?.match(/\bencoding\s*=\s*(['"])([^'"]+)\1/u)?.[2]?.toLowerCase();
  if (declared && declared !== encoding && !(declared === 'utf-16' && encoding.startsWith('utf-16') && bom)) {
    throw invalidXml('Unsupported or mismatched XML encoding declaration.');
  }
  if (declaration && !/^<\?xml\s+version\s*=\s*(['"])1\.0\1(?:\s|\?)/u.test(declaration)) throw invalidXml('Only XML 1.0 is supported.');
  for (const ch of xml) if (!validScalar(ch.codePointAt(0)!)) throw invalidXml('Invalid XML character.');
  return xml;
}

export interface XmlElement {
  name: string;
  ns: string;
  attrs: Map<string, string>;
  children: XmlElement[];
  text: string;
}
export const attr = (node: XmlElement, name: string, ns = '') => node.attrs.get(`${ns}\0${name}`);
export const children = (node: XmlElement, name: string) => node.children.filter(c => c.name === name && c.ns === node.ns);
export const child = (node: XmlElement, name: string) => children(node, name)[0];
export function descendants(node: XmlElement, name: string): XmlElement[] {
  return node.children.flatMap(c => [...(c.name === name && c.ns === node.ns ? [c] : []), ...descendants(c, name)]);
}
export function requireRoot(node: XmlElement, name: string, namespaces: string[]): void {
  if (node.name !== name || !namespaces.includes(node.ns)) throw invalidXml(`Invalid ${name} document namespace or root.`);
}

/**
 * Grammar is handled by the maintained parser and validator. Resource preflight
 * counts markup delimiters conservatively before either builds its structures.
 * CDATA is explicit so literal '&amp;' within it never enters entity decoding.
 */
export function parseXmlPart(bytes: Buffer, checkBudget: () => void, budget = { markup: 0 }): XmlElement {
  const timings: Record<string,number> = {}; let mark=performance.now(); const stamp=(name:string)=>{timings[name]=performance.now()-mark;mark=performance.now();};
  const xml = decodeXmlBytes(bytes); stamp("decodeAndScalars");
  checkBudget();
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml)) throw HttpError.unprocessable('XXE_DETECTED', 'DTD and entity declarations are disallowed in every workbook part.');
  let segment = 0;
  for (let i = 0; i < xml.length; i++) {
    if (xml.charCodeAt(i) === 60) { if (++budget.markup > MAX_XML_MARKUP) throw xmlLimit(); segment = 0; }
    else if (++segment > MAX_XML_SEGMENT) throw xmlLimit();
  }
  stamp("resourcePreflight");
  if (XMLValidator.validate(xml, { allowBooleanAttributes: false }) !== true) throw invalidXml('Malformed workbook XML.');
  checkBudget();
  stamp("validate");
  // Max nesting is enforced by FXP while constructing its bounded ordered tree.
  let ordered: Array<Record<string, unknown>>;
  try {
    ordered = new XMLParser({
      preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '',
      parseTagValue: false, parseAttributeValue: false, trimValues: false,
      processEntities: false, htmlEntities: false, cdataPropName: '#cdata',
      commentPropName: '#comment', ignorePiTags: true, ignoreDeclaration: true,
      maxNestedTags: MAX_XML_DEPTH,
    }).parse(xml) as Array<Record<string, unknown>>;
  } catch { throw invalidXml('Malformed or excessively nested workbook XML.'); }
  checkBudget();
  stamp("parse");
  const resolve = (qname: string, namespaces: Map<string, string>, isAttr = false) => {
    const parts = qname.split(':');
    if (parts.length > 2 || parts.some(p => !p)) throw invalidXml('Invalid qualified XML name.');
    const prefix = parts.length === 2 ? parts[0]! : '';
    if (prefix && !namespaces.has(prefix)) throw invalidXml('Unbound XML namespace prefix.');
    return { name: parts.at(-1)!, ns: isAttr && !prefix ? '' : namespaces.get(prefix) ?? '' };
  };
  const convert = (item: Record<string, unknown>, inherited: Map<string, string>, depth: number): XmlElement => {
    if (depth > MAX_XML_DEPTH) throw xmlLimit();
    const qname = Object.keys(item).find(k => k !== ':@')!;
    const attrsRaw = (item[':@'] ?? {}) as Record<string, string>;
    const namespaces = new Map(inherited);
    for (const [key, raw] of Object.entries(attrsRaw)) if (key === 'xmlns' || key.startsWith('xmlns:')) {
      const prefix = key === 'xmlns' ? '' : key.slice(6), uri = decodeXmlText(raw);
      if (prefix === 'xmlns' || uri === XMLNS_NS || (prefix === 'xml') !== (uri === XML_NS) || (prefix && !uri)) throw invalidXml('Invalid XML namespace declaration.');
      namespaces.set(prefix, uri);
    }
    const resolved = resolve(qname, namespaces), attrs = new Map<string, string>();
    for (const [key, raw] of Object.entries(attrsRaw)) if (key !== 'xmlns' && !key.startsWith('xmlns:')) {
      const a = resolve(key, namespaces, true), expanded = `${a.ns}\0${a.name}`;
      if (attrs.has(expanded)) throw invalidXml('Duplicate expanded XML attribute.');
      attrs.set(expanded, decodeXmlText(raw));
    }
    const node: XmlElement = { ...resolved, attrs, children: [], text: '' };
    for (const value of item[qname] as Array<Record<string, unknown>>) {
      const kind = Object.keys(value)[0]!;
      if (kind === '#text') node.text += decodeXmlText(String(value[kind]));
      else if (kind === '#cdata') node.text += (value[kind] as Array<Record<string, string>>).map(v => v['#text'] ?? '').join('');
      else if (kind !== '#comment' && !kind.startsWith('?')) node.children.push(convert(value, namespaces, depth + 1));
      if (node.text.length > MAX_XML_TEXT) throw xmlLimit();
    }
    return node;
  };
  const roots = ordered.filter(v => !Object.keys(v)[0]!.startsWith('#') && !Object.keys(v)[0]!.startsWith('?'));
  if (roots.length !== 1) throw invalidXml('Workbook XML requires one document element.');
  const root = convert(roots[0]!, new Map([['xml', XML_NS]]), 1);
  for (const item of ordered) if ('#text' in item && String(item['#text']).trim()) throw invalidXml('Text outside XML document element.');
  checkBudget();
  stamp("convert"); profileTimings.push({partBytes:bytes.length,timings});
  return root;
}
