import { posix } from 'node:path';
import {
  attr, parseXmlPart, type XmlElement, CONTENT_TYPES_NS, DOCUMENT_REL_NS, PACKAGE_REL_NS,
  SPREADSHEET_NS, STRICT_DOCUMENT_REL_NS, STRICT_SPREADSHEET_NS,
} from './import-xml.ts';
import { invalidOffice, isOfficePartName, readOfficeZip } from './document-office-zip.ts';

export type OfficeMediaType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' |
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const TYPES = '[Content_Types].xml';
const ROOT_RELATIONSHIPS = '_rels/.rels';
const OFFICE_TYPE = 'application/vnd.openxmlformats-officedocument.';
const CORE_TYPE = 'application/vnd.openxmlformats-package.core-properties+xml';
const RELATIONSHIPS_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const CORE_REL = PACKAGE_REL_NS + '/metadata/core-properties';
const CORE_NS = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STRICT_WORD_NS = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const STRICT_DRAWING_NS = 'http://purl.oclc.org/ooxml/drawingml/main';
const PROPERTIES_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/';
const STRICT_PROPERTIES_NS = 'http://purl.oclc.org/ooxml/officeDocument/';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XML_SCHEMA_INSTANCE_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const MARKUP_COMPATIBILITY_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

interface PartProfile {
  contentType: string;
  relationship: string;
  root: string;
  namespaces: readonly string[];
}

function officePart(type: string, relationship: string, root: string, namespaces: readonly string[]): PartProfile {
  return { contentType: `${OFFICE_TYPE}${type}+xml`, relationship, root, namespaces };
}

const wordNamespaces = [WORD_NS, STRICT_WORD_NS];
const sheetNamespaces = [SPREADSHEET_NS, STRICT_SPREADSHEET_NS];
const drawingNamespaces = [DRAWING_NS, STRICT_DRAWING_NS];
const wordPart = (kind: string, root = kind) => officePart(`wordprocessingml.${kind}`, kind, root, wordNamespaces);
const sheetPart = (kind: string, root = kind) => officePart(`spreadsheetml.${kind}`, kind, root, sheetNamespaces);
const wordMain = officePart('wordprocessingml.document.main', 'officeDocument', 'document', wordNamespaces);
const sheetMain = officePart('spreadsheetml.sheet.main', 'officeDocument', 'workbook', sheetNamespaces);
const theme = officePart('theme', 'theme', 'theme', drawingNamespaces);
const sharedParts = new Map<string, PartProfile>([
  ['docProps/core.xml', { contentType: CORE_TYPE, relationship: 'core-properties', root: 'coreProperties', namespaces: [CORE_NS] }],
  ...([['app', 'extended-properties'], ['custom', 'custom-properties']] as const).map(([part, kind]) => [
    `docProps/${part}.xml`, officePart(kind, kind, 'Properties', [PROPERTIES_NS + kind, STRICT_PROPERTIES_NS + kind]),
  ] as const),
]);

const wordParts = new Map<string, PartProfile>([
  ['word/document.xml', wordMain],
  ['word/styles.xml', wordPart('styles')],
  ['word/numbering.xml', wordPart('numbering')],
  ['word/settings.xml', wordPart('settings')],
  ['word/webSettings.xml', wordPart('webSettings')],
  ['word/fontTable.xml', wordPart('fontTable', 'fonts')],
  ['word/footnotes.xml', wordPart('footnotes')],
  ['word/endnotes.xml', wordPart('endnotes')],
  ['word/comments.xml', wordPart('comments')],
]);

const sheetParts = new Map<string, PartProfile>([
  ['xl/workbook.xml', sheetMain],
  ['xl/styles.xml', sheetPart('styles', 'styleSheet')],
  ['xl/sharedStrings.xml', sheetPart('sharedStrings', 'sst')],
  ['xl/calcChain.xml', sheetPart('calcChain')],
]);

function partProfile(name: string, word: boolean): PartProfile | undefined {
  const known = sharedParts.get(name) ?? (word ? wordParts : sheetParts).get(name);
  if (known) return known;
  if (word) {
    if (/^word\/header\d+\.xml$/.test(name)) return wordPart('header', 'hdr');
    if (/^word\/footer\d+\.xml$/.test(name)) return wordPart('footer', 'ftr');
    if (/^word\/theme\/theme\d+\.xml$/.test(name)) return theme;
  } else {
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) return sheetPart('worksheet');
    if (/^xl\/tables\/table\d+\.xml$/.test(name)) return sheetPart('table');
    if (/^xl\/theme\/theme\d+\.xml$/.test(name)) return theme;
  }
  return undefined;
}

function allowedAttributes(node: XmlElement, names: readonly string[]) {
  if ([...node.attrs.keys()].some(key => !key.startsWith('\0') || !names.includes(key.slice(1)))) invalidOffice();
}

function requireElement(node: XmlElement | undefined, name: string, allowedNamespaces: readonly string[]): XmlElement {
  if (!node || node.name !== name || !allowedNamespaces.includes(node.ns)) return invalidOffice();
  return node;
}

// Some producers declare these defaults for every new document. The package
// itself can still contain only the exact XML parts in this validator's profile.
const unusedProducerDefaults = new Map([
  ['png', 'image/png'], ['jpeg', 'image/jpeg'], ['jpg', 'image/jpeg'], ['bmp', 'image/bmp'], ['gif', 'image/gif'],
  ['svg', 'image/svg+xml'], ['odttf', OFFICE_TYPE + 'obfuscatedFont'],
]);

function validateContentTypes(files: Map<string, Buffer>, metadata: XmlElement, word: boolean) {
  const types = requireElement(metadata, 'Types', [CONTENT_TYPES_NS]);
  allowedAttributes(types, []);
  if (types.text.trim()) invalidOffice();
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const entry of types.children) {
    const type = attr(entry, 'ContentType');
    if (!type || entry.ns !== CONTENT_TYPES_NS || entry.children.length || entry.text.trim()) invalidOffice();
    if (entry.name === 'Default') {
      allowedAttributes(entry, ['Extension', 'ContentType']);
      const extension = attr(entry, 'Extension');
      const allowedType = extension === 'xml' ? 'application/xml' : extension === 'rels' ? RELATIONSHIPS_TYPE : unusedProducerDefaults.get(extension ?? '');
      if (!extension || defaults.has(extension) || type !== allowedType) invalidOffice();
      defaults.set(extension, type);
    } else if (entry.name === 'Override') {
      allowedAttributes(entry, ['PartName', 'ContentType']);
      const part = attr(entry, 'PartName');
      if (!part?.startsWith('/')) invalidOffice();
      const name = part.slice(1);
      if (!files.has(name) || overrides.has(name) || type !== partProfile(name, word)?.contentType) invalidOffice();
      overrides.set(name, type);
    } else invalidOffice();
  }
  for (const name of files.keys()) {
    if (name === TYPES) continue;
    const relationshipPart = name.endsWith('.rels');
    const expectedType = relationshipPart ? RELATIONSHIPS_TYPE : partProfile(name, word)?.contentType;
    if (!expectedType || (overrides.get(name) ?? defaults.get(relationshipPart ? 'rels' : 'xml')) !== expectedType) invalidOffice();
  }
}

function relationshipKind(type: string): string {
  if (type === CORE_REL) return 'core-properties';
  if (type.startsWith(DOCUMENT_REL_NS + '/')) return type.slice(DOCUMENT_REL_NS.length + 1);
  if (type.startsWith(STRICT_DOCUMENT_REL_NS + '/')) return type.slice(STRICT_DOCUMENT_REL_NS.length + 1);
  return invalidOffice();
}

function resolveRelationship(source: string, target: string): string {
  if (!/^[a-zA-Z0-9_./-]{1,240}$/.test(target) || target.startsWith('//')) return invalidOffice();
  const local = target.startsWith('/') ? target.slice(1) : posix.join(posix.dirname(source), target);
  const normalized = posix.normalize(local);
  if (!isOfficePartName(normalized)) return invalidOffice();
  return normalized;
}

function allowsRelationship(source: string, kind: string, main: string, word: boolean): boolean {
  if (!source) return ['officeDocument', 'core-properties', 'extended-properties', 'custom-properties'].includes(kind);
  if (source === main) return !['officeDocument', 'core-properties', 'extended-properties', 'custom-properties', 'table'].includes(kind);
  return !word && /^xl\/worksheets\/sheet\d+\.xml$/.test(source) && kind === 'table';
}

interface Relationship { target: string; kind: string }
type Relationships = Map<string, Map<string, Relationship>>;

function readRelationships(documents: Map<string, XmlElement>, main: string, word: boolean): Relationships {
  const relationships: Relationships = new Map();
  for (const [path, document] of documents) {
    if (!path.endsWith('.rels')) continue;
    const root = requireElement(document, 'Relationships', [PACKAGE_REL_NS]);
    allowedAttributes(root, []);
    if (root.text.trim()) invalidOffice();
    const match = /^(?:([a-zA-Z0-9_./-]+)\/)?_rels\/([^/]+\.xml)\.rels$/.exec(path);
    if (path !== ROOT_RELATIONSHIPS && !match) invalidOffice();
    const source = match ? (match[1] ? `${match[1]}/${match[2]}` : match[2]!) : '';
    if (source && (!documents.has(source) || !partProfile(source, word))) invalidOffice();
    const relations = new Map<string, Relationship>();
    for (const child of root.children) {
      requireElement(child, 'Relationship', [PACKAGE_REL_NS]);
      allowedAttributes(child, ['Id', 'Target', 'TargetMode', 'Type']);
      const id = attr(child, 'Id');
      const target = attr(child, 'Target');
      const type = attr(child, 'Type');
      const mode = attr(child, 'TargetMode');
      if (!id || !/^[a-zA-Z_][\w.-]{0,127}$/.test(id) || relations.has(id) || !target || !type ||
          (mode !== undefined && mode !== 'Internal') || child.children.length || child.text.trim()) invalidOffice();
      const path = resolveRelationship(source, target);
      const kind = relationshipKind(type);
      if (!documents.has(path) || partProfile(path, word)?.relationship !== kind || !allowsRelationship(source, kind, main, word)) invalidOffice();
      relations.set(id, { target: path, kind });
    }
    relationships.set(source, relations);
  }
  const entry = [...(relationships.get('')?.values() ?? [])].filter(link => link.kind === 'officeDocument');
  if (entry.length !== 1 || entry[0]?.target !== main) invalidOffice();
  const reached = new Set<string>();
  const pending = [''];
  while (pending.length > 0) {
    const source = pending.pop()!;
    if (reached.has(source)) continue;
    reached.add(source);
    for (const link of relationships.get(source)?.values() ?? []) pending.push(link.target);
  }
  for (const part of documents.keys()) if (part !== TYPES && !part.endsWith('.rels') && !reached.has(part)) invalidOffice();
  return relationships;
}

const allowedFunctions = new Set([
  'ABS', 'AND', 'AVERAGE', 'AVERAGEIF', 'AVERAGEIFS', 'CEILING', 'CHOOSE', 'CONCAT', 'CONCATENATE', 'COUNT', 'COUNTA',
  'COUNTBLANK', 'COUNTIF', 'COUNTIFS', 'DATE', 'DAY', 'EXACT', 'FLOOR', 'HLOOKUP', 'IF', 'IFERROR', 'INDEX', 'INT',
  'ISBLANK', 'ISERROR', 'ISNUMBER', 'ISTEXT', 'LEFT', 'LEN', 'LOWER', 'MATCH', 'MAX', 'MEDIAN', 'MID', 'MIN', 'MOD',
  'MONTH', 'NOT', 'OR', 'POWER', 'RIGHT', 'ROUND', 'ROUNDDOWN', 'ROUNDUP', 'ROW', 'ROWS', 'SQRT', 'SUBSTITUTE',
  'SUBTOTAL', 'SUM', 'SUMIF', 'SUMIFS', 'SUMPRODUCT', 'TEXT', 'TODAY', 'TRIM', 'UPPER', 'VALUE', 'VLOOKUP', 'YEAR',
]);

const localName = /^(?:_xlnm\.)?(?:Print_Area|Print_Titles|_FilterDatabase)$/;
const cell = /^\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}$/i;
const sheetName = /^[a-zA-Z0-9_][a-zA-Z0-9_. ]{0,30}$/;

/** Constrain the tokens Excel can interpret. Never evaluate or rewrite formulas. */
function validateFormula(value: string, allowEmpty: boolean) {
  const text = value.trim();
  if (!text) {
    if (allowEmpty) return;
    return invalidOffice();
  }
  if (text.length > 8192) invalidOffice();
  const token = /\s+|\"(?:[^"\r\n]|\"\")*\"|'[a-zA-Z0-9_. ]{1,31}'|\d+(?:\.\d*)?(?:[Ee][+-]?\d+)?|\.\d+(?:[Ee][+-]?\d+)?|\$?[a-zA-Z_][a-zA-Z0-9_.$]*|\$\d+|[!()+\-*/^&%=<>,:]/gy;
  const nextNonWhitespace = /\s*(\S)/y;
  let depth = 0;
  let previous = '';
  for (let position = 0; position < text.length; position = token.lastIndex) {
    const match = token.exec(text);
    if (!match) return invalidOffice();
    const word = match[0];
    if (!word.trim()) continue;
    nextNonWhitespace.lastIndex = token.lastIndex;
    const next = nextNonWhitespace.exec(text)?.[1] ?? '';
    if (/^[a-z$_']/i.test(word)) {
      const label = word.replace(/^'|'$/g, '');
      if (next === '!') {
        if (!sheetName.test(label)) invalidOffice();
      } else if (next === '(') {
        if (!allowedFunctions.has(word.toUpperCase())) invalidOffice();
      } else if (!(cell.test(word) || /^(?:TRUE|FALSE|\$[A-Z]{1,3}|\$\d+)$/i.test(word))) invalidOffice();
    }
    if (word === '(' && ++depth > 32) invalidOffice();
    if (word === ')' && --depth < 0) invalidOffice();
    if (word === '!' && !sheetName.test(previous.replace(/^'|'$/g, ''))) invalidOffice();
    // An identifier abutting another identifier is interpreted differently by
    // spreadsheet producers. Allow neither a split name nor a bare intersection.
    if (/^[a-z$_'"\d.]/i.test(word) && /[a-z\d_'"$.]$/i.test(previous)) invalidOffice();
    previous = word;
  }
  if (depth !== 0) invalidOffice();
}

const blockedWord = new Set([
  'altchunk', 'attachedtemplate', 'control', 'databinding', 'drawing', 'ffdata', 'fldchar', 'fldsimple', 'instrtext',
  'delinstrtext', 'movie', 'object', 'objectembed', 'objectlink', 'pict', 'savethroughxslt', 'subdoc',
  'mailmerge', 'recipientdata', 'odso', 'smarttag', 'smarttagtype', 'customxml', 'frameset', 'frame', 'sourcefilename',
  'attachedschema', 'schemalibrary',
]);

const blockedSheet = new Set([
  'connections', 'connection', 'controls', 'control', 'customproperties', 'drawing', 'extlst', 'ext', 'externalreferences',
  'externalreference', 'externallink', 'legacydrawing', 'legacydrawinghf', 'oleobjects', 'oleobject', 'pivotcaches', 'pivotcache',
  'querytable', 'webpublishitems', 'webpublishitem', 'webpublishing',
]);

const allowedWordChildNamespaces = new Set([
  ...wordNamespaces,
  PROPERTIES_NS + 'math', STRICT_PROPERTIES_NS + 'math',
  'http://schemas.microsoft.com/office/word/2010/wordml',
  'http://schemas.microsoft.com/office/word/2012/wordml',
  'http://schemas.microsoft.com/office/word/2018/wordml',
  'urn:schemas-microsoft-com:office:office',
]);

const blockedAllParts = new Set(['hlinkclick', 'hlinkhover', 'hlinkmouseover', 'extlst', 'ext', 'script']);
const safeWebSettings = new Set(['allowPNG', 'doNotSaveAsSingleFile', 'optimizeForBrowser']);

function validateWebSettings(root: XmlElement) {
  if (root.text.trim()) invalidOffice();
  for (const setting of root.children) {
    if (!safeWebSettings.has(setting.name) || setting.ns !== root.ns || setting.children.length || setting.text.trim()) invalidOffice();
    for (const [key, value] of setting.attrs) {
      if (key !== `${root.ns}\0val` || !['true', 'false', 'on', 'off', '0', '1'].includes(value)) invalidOffice();
    }
  }
}

function inspectMarkup(node: XmlElement, word: boolean, links: Map<string, Relationship> | undefined, profile: PartProfile, checkBudget: () => void) {
  const isDocument = profile.namespaces.some(ns => (word ? wordNamespaces : sheetNamespaces).includes(ns));
  if (word && node.name === 'webSettings') validateWebSettings(node);
  const nodes = [node];
  let visited = 0;
  while (nodes.length > 0) {
    if (visited++ % 64 === 0) checkBudget();
    const element = nodes.pop()!;
    const name = element.name.toLowerCase();
    if (element.ns === MARKUP_COMPATIBILITY_NS || blockedAllParts.has(name) || (word ? blockedWord : blockedSheet).has(name)) invalidOffice();
    if (isDocument && (word ? !allowedWordChildNamespaces.has(element.ns) : element.ns !== node.ns)) invalidOffice();
    if (profile === theme && element.ns !== node.ns) invalidOffice();
    for (const [key, value] of element.attrs) {
      const [namespace, attribute] = key.split('\0');
      if ((namespace === XML_NS && attribute === 'base') ||
          (namespace === XML_SCHEMA_INSTANCE_NS && (attribute === 'schemaLocation' || attribute === 'noNamespaceSchemaLocation')) ||
          (namespace === MARKUP_COMPATIBILITY_NS && attribute !== 'Ignorable')) invalidOffice();
      if (namespace === DOCUMENT_REL_NS || namespace === STRICT_DOCUMENT_REL_NS) {
        if (attribute !== 'id' || !links?.has(value) || (name === 'sheet' && links.get(value)?.kind !== 'worksheet')) invalidOffice();
      }
    }
    if (name === 'hyperlink' && isDocument) {
      const location = word ? attr(element, 'anchor', element.ns) : attr(element, 'location');
      if (word ? !location || !/^[a-zA-Z0-9_ .-]{1,80}$/.test(location) : !location || /[\[\]:/\\%]/.test(location)) invalidOffice();
    }
    if (!word && isDocument && (name === 'f' || name === 'formularef' || name.includes('formula') || name === 'definedname')) {
      if (name === 'definedname') {
        allowedAttributes(element, ['name', 'localSheetId', 'hidden']);
        if (!localName.test(attr(element, 'name') ?? '') ||
            !/^(?:0|[1-9]\d{0,2})$/.test(attr(element, 'localSheetId') ?? '0') ||
            !['true', 'false', '1', '0'].includes(attr(element, 'hidden') ?? '0')) invalidOffice();
      }
      if (element.children.length ||
          (name === 'f' && ![undefined, 'normal', 'shared', 'array'].includes(attr(element, 't')))) invalidOffice();
      validateFormula(element.text, name === 'f' && attr(element, 't') === 'shared');
    }
    for (const child of element.children) nodes.push(child);
  }
}

const MAX_TAG_LENGTH = 8192;
const MAX_TAG_ATTRIBUTES = 96;
const MAX_XML_ATTRIBUTES = 100_000;
const MAX_SCOPE_NAMESPACES = 64;
const MAX_DEPTH = 64;

/** Bound source constructs that cost more when XML builds each element's inherited namespace map. */
function inspectXmlSource(xml: string, checkBudget: () => void) {
  const sumAttributes = { count: 0 };
  const namespaceCounts = [1]; // XML's implicit binding
  const tagToken = /[^<>'"=]+|"[^"<]*"|'[^'<]*'|=|>/y;
  for (let offset = 0; ; ) {
    checkBudget();
    const start = xml.indexOf('<', offset);
    if (start < 0) return;
    const comment = xml.startsWith('<!--', start);
    const cdata = xml.startsWith('<![CDATA[', start);
    if (comment || cdata) {
      const end = xml.indexOf(comment ? '-->' : ']]>', start + (comment ? 4 : 9));
      if (end < 0) invalidOffice();
      offset = end + 3;
      continue;
    }
    if (xml.startsWith('<?', start)) {
      // The common parser ignores processing instructions. Allow only the initial XML declaration.
      const end = xml.indexOf('?>', start + 2);
      if (start !== 0 || end < 0 || end > MAX_TAG_LENGTH || !/^<\?xml\s/.test(xml.slice(start, start + 7))) invalidOffice();
      offset = end + 2;
      continue;
    }
    if (xml.startsWith('<!', start)) invalidOffice();
    const tag = xml.slice(start + 1, start + 1 + MAX_TAG_LENGTH);
    tagToken.lastIndex = 0;
    let namespaces = namespaceCounts.at(-1)!;
    let attributes = 0;
    let beforeEquals = '';
    let token: RegExpExecArray | null;
    while ((token = tagToken.exec(tag)) && token[0] !== '>') {
      if (token[0] !== '=') { beforeEquals = token[0]; continue; }
      if (++attributes > MAX_TAG_ATTRIBUTES || ++sumAttributes.count > MAX_XML_ATTRIBUTES) invalidOffice();
      if (/(?:^|[\t\r\n ])xmlns(?::[^\t\r\n ]+)?[\t\r\n ]*$/.test(beforeEquals) && ++namespaces > MAX_SCOPE_NAMESPACES) invalidOffice();
    }
    if (!token) invalidOffice();
    if (tag.startsWith('/')) {
      if (namespaceCounts.length === 1) invalidOffice();
      namespaceCounts.pop();
    } else if (tag[tagToken.lastIndex - 2] !== '/') {
      if (namespaceCounts.length > MAX_DEPTH) invalidOffice();
      namespaceCounts.push(namespaces);
    }
    offset = start + 1 + tagToken.lastIndex;
  }
}

/** Accepts a deliberately bounded, passive Word/Excel profile without rewriting user data. */
export function validateOfficeDocument(bytes: Uint8Array, mediaType: OfficeMediaType, signal: AbortSignal): void {
  signal.throwIfAborted();
  const word = mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (!word && mediaType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') invalidOffice();
  const last = performance.now() + 1000;
  const checkBudget = () => { signal.throwIfAborted(); if (performance.now() > last) invalidOffice(); };
  try {
    const files = readOfficeZip(bytes, checkBudget);
    const documents = new Map<string, XmlElement>();
    const xmlBudget = { markup: 0 };
    for (const [name, bytes] of files) {
      if (name !== TYPES && !name.endsWith('.rels') && !partProfile(name, word)) invalidOffice();
      documents.set(name, parseXmlPart(bytes, checkBudget, xmlBudget, xml => inspectXmlSource(xml, checkBudget)));
    }
    const types = documents.get(TYPES);
    if (!types) invalidOffice();
    validateContentTypes(files, types, word);
    const main = word ? 'word/document.xml' : 'xl/workbook.xml';
    const relationships = readRelationships(documents, main, word);
    for (const [name, document] of documents) {
      const profile = partProfile(name, word);
      if (profile) {
        requireElement(document, profile.root, profile.namespaces);
        inspectMarkup(document, word, relationships.get(name), profile, checkBudget);
      }
    }
    checkBudget();
  } catch {
    signal.throwIfAborted();
    invalidOffice();
  }
}
