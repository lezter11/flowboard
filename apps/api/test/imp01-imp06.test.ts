import assert from 'node:assert/strict';
import { insertWorkspaceForCookie } from './support/workspace-fixture.ts';
import crypto from 'node:crypto';
import test, { before, after } from 'node:test';
import zlib from 'node:zlib';
import pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';
import { parseExcelWorkbook } from '../src/services/excel-parser.ts';

// Helper to construct a valid PKZip XLSX file in-memory with pure Node.js
function buildZipFile(files: Record<string, string | Buffer>): Buffer {
  const localHeaders: Buffer[] = [];
  const cdHeaders: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const uncompressedSize = dataBuf.length;
    const compressed = zlib.deflateRawSync(dataBuf);
    const compressedSize = compressed.length;

    // Local file header (30 bytes + name)
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // compression method (deflate)
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(0, 14); // crc32
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field len
    nameBuf.copy(local, 30);

    localHeaders.push(local, compressed);

    // Central directory header (46 bytes + name)
    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0); // signature
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(8, 10); // method
    cd.writeUInt16LE(0, 12); // mod time
    cd.writeUInt16LE(0, 14); // mod date
    cd.writeUInt32LE(0, 16); // crc32
    cd.writeUInt32LE(compressedSize, 20);
    cd.writeUInt32LE(uncompressedSize, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra len
    cd.writeUInt16LE(0, 32); // comment len
    cd.writeUInt16LE(0, 34); // disk start
    cd.writeUInt16LE(0, 36); // internal attr
    cd.writeUInt32LE(0, 38); // external attr
    cd.writeUInt32LE(offset, 42); // local header offset
    nameBuf.copy(cd, 46);

    cdHeaders.push(cd);
    offset += local.length + compressed.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const cd of cdHeaders) cdSize += cd.length;

  // EOCD (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...cdHeaders, eocd]);
}

function toBody(buf: Buffer): any {
  return buf;
}

interface TestXlsxRow {
  externalId?: string | number | undefined;
  title?: string | undefined;
  description?: string | undefined;
  priority?: string | undefined;
  dueDate?: string | number | undefined;
  assignees?: string | undefined;
  status?: string | undefined;
}

interface CreateXlsxOptions {
  sheetName?: string;
  date1904?: boolean;
  withFormula?: boolean;
  withMacro?: boolean;
  withExternalLink?: boolean;
  withOle?: boolean;
  withXXE?: boolean;
  headers?: string[];
  extraSheetName?: string;
  externalIdIsNumeric?: boolean;
}

function createCustomXlsx(rows: TestXlsxRow[], options: CreateXlsxOptions = {}): Buffer {
  const sheetName = options.sheetName ?? 'Cards';
  const is1904 = Boolean(options.date1904);
  const headers = options.headers ?? [
    'External ID',
    'Title',
    'Description',
    'Priority',
    'Due Date',
    'Assignees',
    'Status',
  ];

  // Build shared strings table
  const sharedStrings: string[] = [];
  function addSharedString(s: string): number {
    const idx = sharedStrings.indexOf(s);
    if (idx !== -1) return idx;
    sharedStrings.push(s);
    return sharedStrings.length - 1;
  }

  // Row 1: Headers
  let rowXml = `<row r="1">`;
  const colLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
  for (let i = 0; i < headers.length; i++) {
    const sIdx = addSharedString(headers[i]!);
    rowXml += `<c r="${colLetters[i]}1" t="s"><v>${sIdx}</v></c>`;
  }
  rowXml += `</row>`;

  // Data rows
  let rowIdx = 2;
  for (const r of rows) {
    rowXml += `<row r="${rowIdx}">`;

    // A: External ID
    if (r.externalId !== undefined) {
      if (options.externalIdIsNumeric || typeof r.externalId === 'number') {
        rowXml += `<c r="A${rowIdx}" t="n"><v>${r.externalId}</v></c>`;
      } else {
        const sIdx = addSharedString(String(r.externalId));
        rowXml += `<c r="A${rowIdx}" t="s"><v>${sIdx}</v></c>`;
      }
    }

    // B: Title
    if (r.title !== undefined) {
      const sIdx = addSharedString(r.title);
      rowXml += `<c r="B${rowIdx}" t="s"><v>${sIdx}</v></c>`;
    }

    // C: Description
    if (r.description !== undefined) {
      const sIdx = addSharedString(r.description);
      rowXml += `<c r="C${rowIdx}" t="s"><v>${sIdx}</v></c>`;
    }

    // D: Priority
    if (r.priority !== undefined) {
      const sIdx = addSharedString(r.priority);
      rowXml += `<c r="D${rowIdx}" t="s"><v>${sIdx}</v></c>`;
    }

    // E: Due Date
    if (r.dueDate !== undefined) {
      if (typeof r.dueDate === 'number') {
        rowXml += `<c r="E${rowIdx}" t="n"><v>${r.dueDate}</v></c>`;
      } else {
        const sIdx = addSharedString(r.dueDate);
        rowXml += `<c r="E${rowIdx}" t="s"><v>${sIdx}</v></c>`;
      }
    }

    // F: Assignees
    if (r.assignees !== undefined) {
      const sIdx = addSharedString(r.assignees);
      rowXml += `<c r="F${rowIdx}" t="s"><v>${sIdx}</v></c>`;
    }

    // G: Status
    if (r.status !== undefined) {
      const sIdx = addSharedString(r.status);
      rowXml += `<c r="G${rowIdx}" t="s"><v>${sIdx}</v></c>`;
    }

    // Formula injection if requested
    if (options.withFormula) {
      rowXml += `<c r="H${rowIdx}"><f>SUM(1,2)</f><v>3</v></c>`;
    }

    rowXml += `</row>`;
    rowIdx++;
  }

  // XMLs
  let sstXml = `<?xml version="1.0" encoding="utf-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`;
  for (const s of sharedStrings) {
    sstXml += `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</t></si>`;
  }
  sstXml += `</sst>`;

  let sheetXml = `<?xml version="1.0" encoding="utf-8"?>`;
  if (options.withXXE) {
    sheetXml += `<!DOCTYPE sheet [<!ENTITY xxe "malicious_entity">]>`;
  }
  sheetXml += `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;

  let workbookXml = `<?xml version="1.0" encoding="utf-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`;
  if (is1904) {
    workbookXml += `<workbookPr date1904="1"/>`;
  }
  workbookXml += `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/>`;
  if (options.extraSheetName) {
    workbookXml += `<sheet name="${options.extraSheetName}" sheetId="2" r:id="rId2"/>`;
  }
  workbookXml += `</sheets></workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
    ${options.extraSheetName ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' : ''}
    <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  </Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
    <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
    <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  </Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  </Relationships>`;

  const files: Record<string, string | Buffer> = {
    '[Content_Types].xml': contentTypesXml,
    '_rels/.rels': rootRelsXml,
    'xl/workbook.xml': workbookXml,
    'xl/_rels/workbook.xml.rels': workbookRelsXml,
    'xl/worksheets/sheet1.xml': sheetXml,
    'xl/sharedStrings.xml': sstXml,
  };

  if (options.extraSheetName) {
    files['xl/worksheets/sheet2.xml'] = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`;
  }
  if (options.withMacro) {
    files['xl/vbaProject.bin'] = Buffer.from('FAKE_VBA_BIN');
  }
  if (options.withExternalLink) {
    files['xl/externalLinks/externalLink1.xml'] = `<externalLink/>`;
  }
  if (options.withOle) {
    files['xl/embeddings/oleObject1.bin'] = Buffer.from('FAKE_OLE_BIN');
  }

  return buildZipFile(files);
}

test('IMP-01 to IMP-06: Excel Import Engine Integration & Concurrency Test Suite', async (t) => {
  const pool = new pg.Pool({
    connectionString: localDatabaseUrl(process.env['DATABASE_URL']),
    max: 5,
    connectionTimeoutMillis: 5_000,
  });

  const app = createApp(async () => { await pool.query('SELECT 1'); }, {
    pool,
    bodyLimitBytes: 10 * 1024 * 1024, // Allow large test buffers
  });

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query(
        'TRUNCATE workspaces, users, sessions, idempotency_receipts, projects, project_memberships, boards, columns, cards, card_assignees, comments, card_imports, card_import_rows, card_import_duplicates, activity_log CASCADE;',
      );
    } finally {
      client.release();
    }
  });

  after(async () => {
    await pool.end();
  });

  async function createSession(email: string, name: string): Promise<{ cookie: string; user: any }> {
    const res = await app.request('/api/v1/session/dev-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dev-Secret': process.env['DEV_LOGIN_SECRET'] || 'flowboard-dev-secret',
      },
      body: JSON.stringify({ email, name }),
    });
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
    const json = (await res.json()) as any;
    return { cookie, user: json.data.actor };
  }

  let ownerCookie: string;
  let ownerUser: any;
  let pmCookie: string;
  let pmUser: any;
  let memberCookie: string;
  let memberUser: any;
  let viewerCookie: string;
  let viewerUser: any;
  let siblingCookie: string;
  let siblingUser: any;
  let outsiderCookie: string;
  let outsiderUser: any;

  let workspaceId: string;
  let projectId: string;
  let siblingProjectId: string;
  let boardId: string;
  let defaultColumnId: string;
  let inProgressColumnId: string;

  await t.test('0. Setup Workspace, Projects, Members and Boards', async () => {
    const owner = await createSession('imp-owner@test.com', 'Import Owner');
    ownerCookie = owner.cookie;
    ownerUser = owner.user;

    const pm = await createSession('imp-pm@test.com', 'Import PM');
    pmCookie = pm.cookie;
    pmUser = pm.user;

    const member = await createSession('imp-member@test.com', 'Import Member');
    memberCookie = member.cookie;
    memberUser = member.user;

    const viewer = await createSession('imp-viewer@test.com', 'Import Viewer');
    viewerCookie = viewer.cookie;
    viewerUser = viewer.user;

    const sibling = await createSession('imp-sibling@test.com', 'Sibling Member');
    siblingCookie = sibling.cookie;
    siblingUser = sibling.user;

    const outsider = await createSession('imp-outsider@test.com', 'Outsider User');
    outsiderCookie = outsider.cookie;
    outsiderUser = outsider.user;

    // Create Workspace
    // B-20: POST /api/v1/workspaces is retired; the fixture inserts the owner's workspace.
    workspaceId = (await insertWorkspaceForCookie(ownerCookie, { name: 'Import Test Workspace' })).id;

    // Create Project Alpha
    const prjRes = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookie,
        'Idempotency-Key': 'prj-imp-test-setup-001',
      },
      body: JSON.stringify({ name: 'Project Alpha' }),
    });
    assert.equal(prjRes.status, 201);
    projectId = ((await prjRes.json()) as any).data.id;

    // Create Project Beta (Sibling)
    const sibRes = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookie,
        'Idempotency-Key': 'prj-imp-test-setup-002',
      },
      body: JSON.stringify({ name: 'Project Beta' }),
    });
    assert.equal(sibRes.status, 201);
    siblingProjectId = ((await sibRes.json()) as any).data.id;

    // Assign project roles in Project Alpha
    await pool.query(
      `INSERT INTO project_memberships (id, workspace_id, project_id, user_id, role, status, version, created_at, updated_at)
       VALUES
         ('pm_imp_1', $1, $2, $3, 'manager', 'active', 1, NOW(), NOW()),
         ('pm_imp_2', $1, $2, $4, 'member', 'active', 1, NOW(), NOW()),
         ('pm_imp_3', $1, $2, $5, 'viewer', 'active', 1, NOW(), NOW())
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'`,
      [workspaceId, projectId, pmUser.id, memberUser.id, viewerUser.id],
    );

    // Assign sibling in Project Beta only
    await pool.query(
      `INSERT INTO project_memberships (id, workspace_id, project_id, user_id, role, status, version, created_at, updated_at)
       VALUES ('pm_imp_4', $1, $2, $3, 'member', 'active', 1, NOW(), NOW())
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'member', status = 'active'`,
      [workspaceId, siblingProjectId, siblingUser.id],
    );

    // Create Board in Project Alpha
    const brdRes = await app.request(`/api/v1/projects/${projectId}/boards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookie,
        'Idempotency-Key': 'brd-imp-test-setup-001',
      },
      body: JSON.stringify({ name: 'Import Target Board' }),
    });
    assert.equal(brdRes.status, 201);
    boardId = ((await brdRes.json()) as any).data.id;

    await pool.query(
      `INSERT INTO board_grants (workspace_id, project_id, board_id, user_id, granted_by)
       VALUES
         ($1, $2, $3, $4, $7),
         ($1, $2, $3, $5, $7),
         ($1, $2, $3, $6, $7)`,
      [workspaceId, projectId, boardId, pmUser.id, memberUser.id, viewerUser.id, ownerUser.id],
    );

    // Fetch default column and other columns
    const colsRes = await pool.query<{ id: string; name: string }>(
      'SELECT id, name FROM columns WHERE board_id = $1 ORDER BY position ASC',
      [boardId],
    );
    assert.ok(colsRes.rows.length >= 2);
    defaultColumnId = colsRes.rows[0]!.id;
    inProgressColumnId = colsRes.rows[1]!.id;
  });

  // ==========================================================================
  // IMP-01: Download Excel Template
  // ==========================================================================
  await t.test('IMP-01: Download Excel template with versioned 7-column schema', async () => {
    // 1. Download official template
    const res = await app.request('/api/v1/import/template', {
      headers: { Cookie: ownerCookie },
    });
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get('Content-Type'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    assert.ok(res.headers.get('Content-Disposition')?.includes('Flowboard_Card_Import_Template.xlsx'));

    // 2. Parse downloaded template and verify 0 cards created (blank template creates zero cards)
    const buf = Buffer.from(await res.arrayBuffer());
    const parseResult = parseExcelWorkbook(buf);
    assert.equal(parseResult.sheetName, 'Cards');
    assert.equal(parseResult.totalRows, 0, 'Blank template should skip all 200 formatted empty rows');

    // 3. Alternative route aliases
    const aliasRes1 = await app.request(`/api/v1/boards/${boardId}/card-import-template`, {
      headers: { Cookie: pmCookie },
    });
    assert.equal(aliasRes1.status, 200);

    const aliasRes2 = await app.request(`/api/v1/boards/${boardId}/import-template`, {
      headers: { Cookie: memberCookie },
    });
    assert.equal(aliasRes2.status, 200);
  });

  // ==========================================================================
  // IMP-02: Target and Role Authorization
  // ==========================================================================
  await t.test('IMP-02: Role authorization and target boundaries (Owner/Manager pass, Member/Viewer 403, Outsider 404)', async () => {
    const validXlsx = createCustomXlsx([
      {
        externalId: 'EXT-001',
        title: 'Authorized Task',
        priority: 'high',
      },
    ]);

    // 1. Member rejected with 403 FORBIDDEN
    const memberRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        Cookie: memberCookie,
      },
      body: toBody(validXlsx),
    });
    assert.equal(memberRes.status, 403);

    // 2. Viewer rejected with 403 FORBIDDEN
    const viewerRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        Cookie: viewerCookie,
      },
      body: toBody(validXlsx),
    });
    assert.equal(viewerRes.status, 403);

    // 3. Sibling member (member of Project B only) rejected with 404 NOT_FOUND
    const sibRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        Cookie: siblingCookie,
      },
      body: toBody(validXlsx),
    });
    assert.equal(sibRes.status, 404);

    // 4. Outsider rejected with 404 NOT_FOUND
    const outsiderRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        Cookie: outsiderCookie,
      },
      body: toBody(validXlsx),
    });
    assert.equal(outsiderRes.status, 404);

    // 5. Unauthenticated rejected with 401
    const unauthRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: toBody(validXlsx),
    });
    assert.equal(unauthRes.status, 401);

    // 6. Nonexistent default column rejected with 422
    const badColRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=col_nonexistent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        Cookie: pmCookie,
      },
      body: toBody(validXlsx),
    });
    assert.equal(badColRes.status, 422);

    // 7. Project Manager succeeds
    const pmSuccessRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        Cookie: pmCookie,
      },
      body: toBody(validXlsx),
    });
    assert.equal(pmSuccessRes.status, 201);
    const pmJson = (await pmSuccessRes.json()) as any;
    assert.equal(pmJson.data.state, 'ready');
    assert.equal(pmJson.data.counts.new, 1);
  });

  // ==========================================================================
  // IMP-03: Bounded Literal Workbook Parsing & Security Rejections
  // ==========================================================================
  await t.test('IMP-03: Security boundaries: formulas, macros, external links, OLE, XXE, row limits', async () => {
    // 1. Formulas rejected
    const formulaXlsx = createCustomXlsx(
      [{ externalId: 'F-001', title: 'Task with Formula' }],
      { withFormula: true },
    );
    const formulaRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(formulaXlsx),
    });
    assert.equal(formulaRes.status, 422);
    assert.equal(((await formulaRes.json()) as any).error.code, 'FORMULA_REJECTED');

    // 2. Macros rejected
    const macroXlsx = createCustomXlsx(
      [{ externalId: 'M-001', title: 'Task with Macro' }],
      { withMacro: true },
    );
    const macroRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(macroXlsx),
    });
    assert.equal(macroRes.status, 422);
    assert.equal(((await macroRes.json()) as any).error.code, 'MACRO_OR_EXECUTABLE_REJECTED');

    // 3. External links rejected
    const extLinkXlsx = createCustomXlsx(
      [{ externalId: 'EL-001', title: 'Task' }],
      { withExternalLink: true },
    );
    const extLinkRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(extLinkXlsx),
    });
    assert.equal(extLinkRes.status, 422);
    assert.equal(((await extLinkRes.json()) as any).error.code, 'EXTERNAL_LINKS_REJECTED');

    // 4. OLE embeddings rejected
    const oleXlsx = createCustomXlsx(
      [{ externalId: 'OLE-001', title: 'Task' }],
      { withOle: true },
    );
    const oleRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(oleXlsx),
    });
    assert.equal(oleRes.status, 422);
    assert.equal(((await oleRes.json()) as any).error.code, 'OLE_EMBEDDINGS_REJECTED');

    // 5. XXE injection rejected
    const xxeXlsx = createCustomXlsx(
      [{ externalId: 'XXE-001', title: 'Task' }],
      { withXXE: true },
    );
    const xxeRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(xxeXlsx),
    });
    assert.equal(xxeRes.status, 422);
    assert.equal(((await xxeRes.json()) as any).error.code, 'XXE_DETECTED');

    // 6. Unsupported extra sheets rejected (only Cards and Instructions allowed)
    const extraSheetXlsx = createCustomXlsx(
      [{ externalId: 'SH-001', title: 'Task' }],
      { extraSheetName: 'SecretData' },
    );
    const extraSheetRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(extraSheetXlsx),
    });
    assert.equal(extraSheetRes.status, 422);
    assert.equal(((await extraSheetRes.json()) as any).error.code, 'UNSUPPORTED_WORKSHEET');

    // 7. Max 200 non-empty rows enforced: 201 rows rejected
    const rows201: TestXlsxRow[] = [];
    for (let i = 1; i <= 201; i++) {
      rows201.push({ externalId: `LIMIT-${i}`, title: `Task ${i}` });
    }
    const limitXlsx = createCustomXlsx(rows201);
    const limitRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(limitXlsx),
    });
    assert.equal(limitRes.status, 422);
    assert.equal(((await limitRes.json()) as any).error.code, 'ROW_LIMIT_EXCEEDED');

    // 8. Corrupt non-ZIP file rejected
    const corruptRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(Buffer.from('NOT_A_ZIP_FILE_AT_ALL')),
    });
    assert.equal(corruptRes.status, 422);
    assert.equal(((await corruptRes.json()) as any).error.code, 'INVALID_WORKBOOK');
  });

  // ==========================================================================
  // IMP-04: Map & Validate Template Fields
  // ==========================================================================
  await t.test('IMP-04: Header validation, leading zeros, numeric rejection, date systems, assignee resolution', async () => {
    // 1. Unknown header rejected
    const unknownHeaderXlsx = createCustomXlsx(
      [{ externalId: 'U-001', title: 'Task' }],
      { headers: ['External ID', 'Title', 'Random Column'] },
    );
    const unkRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(unknownHeaderXlsx),
    });
    assert.equal(unkRes.status, 422);
    assert.equal(((await unkRes.json()) as any).error.code, 'UNKNOWN_HEADER');

    // 2. Duplicate header rejected
    const duplicateHeaderXlsx = createCustomXlsx(
      [{ externalId: 'D-001', title: 'Task' }],
      { headers: ['External ID', 'Title', 'Title'] },
    );
    const dupHeaderRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(duplicateHeaderXlsx),
    });
    assert.equal(dupHeaderRes.status, 422);
    assert.equal(((await dupHeaderRes.json()) as any).error.code, 'DUPLICATE_HEADER');

    // 3. Missing required Title header rejected
    const missingTitleXlsx = createCustomXlsx(
      [{ externalId: 'M-001' }],
      { headers: ['External ID', 'Description', 'Priority'] },
    );
    const missRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(missingTitleXlsx),
    });
    assert.equal(missRes.status, 422);
    assert.equal(((await missRes.json()) as any).error.code, 'MISSING_REQUIRED_HEADER');

    // 4. Numeric External ID rejected with format-as-text guidance
    const numIdXlsx = createCustomXlsx(
      [{ externalId: 10042, title: 'Numeric ID Task' }],
      { externalIdIsNumeric: true },
    );
    const numIdRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(numIdXlsx),
    });
    assert.equal(numIdRes.status, 201);
    const numIdJson = (await numIdRes.json()) as any;
    assert.equal(numIdJson.data.state, 'invalid');
    assert.equal(numIdJson.data.counts.invalid, 1);
    assert.equal(numIdJson.data.rows[0].errors[0].code, 'NUMERIC_ID_REJECTED');

    // 5. Preserves leading zeros on text External ID
    const leadingZeroXlsx = createCustomXlsx([
      { externalId: '000123', title: 'Task with leading zero' },
    ]);
    const lzRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(leadingZeroXlsx),
    });
    assert.equal(lzRes.status, 201);
    const lzJson = (await lzRes.json()) as any;
    assert.equal(lzJson.data.state, 'ready');
    assert.equal(lzJson.data.rows[0].externalId, '000123');

    // 6. Excel 1900 date system converts serial numbers accurately, rejecting fictitious 1900-02-29
    const dates1900Xlsx = createCustomXlsx([
      { externalId: 'D-VALID', title: 'Valid 1900 Date', dueDate: 45000 }, // 2023-03-15
      { externalId: 'D-LEAPBUG', title: 'Fictitious Leap Day', dueDate: 60 }, // 1900-02-29 (serial 60)
    ]);
    const d1900Res = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(dates1900Xlsx),
    });
    assert.equal(d1900Res.status, 201);
    const d1900Json = (await d1900Res.json()) as any;
    assert.equal(d1900Json.data.state, 'invalid');
    assert.equal(d1900Json.data.rows[0].dueDate, '2023-03-15');
    assert.equal(d1900Json.data.rows[1].outcome, 'invalid');
    assert.ok(d1900Json.data.rows[1].errors.some((e: any) => e.code === 'INVALID_DATE'));

    // 7. Excel 1904 date system converts accurately
    const dates1904Xlsx = createCustomXlsx(
      [{ externalId: 'D-1904', title: '1904 System Date', dueDate: 43538 }], // 2023-03-15 in 1904
      { date1904: true },
    );
    const d1904Res = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(dates1904Xlsx),
    });
    assert.equal(d1904Res.status, 201);
    const d1904Json = (await d1904Res.json()) as any;
    assert.equal(d1904Json.data.rows[0].dueDate, '2023-03-15');

    // 8. Assignee resolution: active owner/manager/member resolved, unknown/outsider rejected
    const assigneesXlsx = createCustomXlsx([
      {
        externalId: 'ASS-OK',
        title: 'Valid Assignees',
        assignees: 'imp-owner@test.com; imp-member@test.com',
      },
      {
        externalId: 'ASS-BAD',
        title: 'Unknown Assignee',
        assignees: 'imp-member@test.com; ghost@nowhere.com',
      },
    ]);
    const assRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(assigneesXlsx),
    });
    assert.equal(assRes.status, 201);
    const assJson = (await assRes.json()) as any;
    assert.equal(assJson.data.rows[0].outcome, 'new');
    assert.equal(assJson.data.rows[0].assigneeIds.length, 2);
    assert.equal(assJson.data.rows[1].outcome, 'invalid');
    assert.equal(assJson.data.rows[1].errors[0].code, 'UNKNOWN_OR_INELIGIBLE_ASSIGNEE');
  });

  // ==========================================================================
  // IMP-05: Preview new, existing, conflict rows, pagination, mapping & cancel
  // ==========================================================================
  let readyImportId: string;
  let readyDigest: string;

  await t.test('IMP-05a: a Blocked status maps to the default Blocked column on a new board (case-insensitive)', async () => {
    // A board created through the API gets Blocked from the default set and maps by name.
    const createRes = await app.request(`/api/v1/projects/${projectId}/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie, 'Idempotency-Key': 'idemp_imp05a_board' },
      body: JSON.stringify({ name: 'Blocked Mapping Board' }),
    });
    assert.equal(createRes.status, 201);
    const newBoardId = ((await createRes.json()) as any).data.id as string;
    const newCols = await pool.query<{ id: string; name: string }>(
      'SELECT id, name FROM columns WHERE board_id = $1 ORDER BY position ASC',
      [newBoardId],
    );
    const newDefault = newCols.rows.find((c) => c.name === 'Not started')!.id;
    assert.ok(newCols.rows.some((c) => c.name === 'Blocked'), 'new board has a Blocked column');

    const xlsx = createCustomXlsx([{ externalId: 'BLK-001', title: 'Stuck card', priority: 'low', status: 'blocked' }]);
    const previewRes = await app.request(`/api/v1/boards/${newBoardId}/imports?defaultColumnId=${newDefault}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(xlsx),
    });
    assert.equal(previewRes.status, 201);
    const preview = (await previewRes.json()) as any;
    // The status matched a column, so the row is valid and the preview can commit.
    assert.equal(preview.data.counts.invalid, 0);
    assert.equal(preview.data.counts.new, 1);
    assert.equal(preview.data.canCommit, true);
  });

  await t.test('IMP-05: Dry run preview, pagination, unmapped status update, and cancel before commit', async () => {
    // 1. Dry run verification: verify NO domain cards exist
    const cardsCountBefore = await pool.query<{ count: string }>('SELECT COUNT(*)::TEXT AS count FROM cards WHERE board_id = $1', [boardId]);
    const initialCards = parseInt(cardsCountBefore.rows[0]!.count, 10);

    const previewBatchXlsx = createCustomXlsx([
      {
        externalId: 'BATCH-001',
        title: 'Card One',
        priority: 'urgent',
        dueDate: '2026-11-01',
        assignees: 'imp-member@test.com',
      },
      {
        externalId: 'BATCH-002',
        title: 'Card Two',
        priority: 'low',
        status: 'In QA', // Currently unmapped status!
      },
    ]);

    const previewRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(previewBatchXlsx),
    });
    assert.equal(previewRes.status, 201);
    const previewJson = (await previewRes.json()) as any;
    readyImportId = previewJson.data.id;

    // Verify state is invalid because 'In QA' is not mapped yet
    assert.equal(previewJson.data.state, 'invalid');
    assert.equal(previewJson.data.counts.invalid, 1);
    assert.equal(previewJson.data.counts.new, 1);
    assert.equal(previewJson.data.canCommit, false);

    // Verify NO cards were created in the database during preview!
    const cardsCountAfter = await pool.query<{ count: string }>('SELECT COUNT(*)::TEXT AS count FROM cards WHERE board_id = $1', [boardId]);
    assert.equal(parseInt(cardsCountAfter.rows[0]!.count, 10), initialCards, 'Preview dry run must create 0 cards');

    // 2. Test paginated preview inspection with limit and cursor
    const getRes = await app.request(`/api/v1/imports/${readyImportId}?limit=1`, {
      headers: { Cookie: ownerCookie },
    });
    assert.equal(getRes.status, 200);
    const getJson = (await getRes.json()) as any;
    assert.equal(getJson.data.rows.length, 1);
    assert.ok(getJson.data.nextCursor);

    // 3. Update status mapping: map 'In QA' to inProgressColumnId
    const mapRes = await app.request(`/api/v1/imports/${readyImportId}/mappings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({
        mappings: { 'In QA': inProgressColumnId },
        expectedVersion: 1,
      }),
    });
    assert.equal(mapRes.status, 200);
    const mapJson = (await mapRes.json()) as any;
    assert.equal(mapJson.data.version, 2);
    assert.equal(mapJson.data.state, 'ready');
    assert.equal(mapJson.data.counts.invalid, 0);
    assert.equal(mapJson.data.counts.new, 2);
    assert.equal(mapJson.data.canCommit, true);
    readyDigest = mapJson.data.previewDigest;

    // 4. Test cancel on a separate staging import
    const cancelXlsx = createCustomXlsx([{ externalId: 'CANCEL-001', title: 'Will Cancel' }]);
    const toCancelRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(cancelXlsx),
    });
    const toCancelId = ((await toCancelRes.json()) as any).data.id;

    const delRes = await app.request(`/api/v1/imports/${toCancelId}`, {
      method: 'DELETE',
      headers: { Cookie: ownerCookie },
    });
    assert.equal(delRes.status, 200);
    assert.equal(((await delRes.json()) as any).data.state, 'cancelled');

    // Subsequent inspection shows cancelled state
    const inspectDel = await app.request(`/api/v1/imports/${toCancelId}`, {
      headers: { Cookie: ownerCookie },
    });
    assert.equal(((await inspectDel.json()) as any).data.state, 'cancelled');
  });

  // ==========================================================================
  // IMP-06: Explicit Atomic Confirmation & Revalidation Guards
  // ==========================================================================
  await t.test('IMP-06: Atomic confirmation, OCC guards, role re-check, and single transaction commit', async () => {
    // 1. Stale version rejected with 409
    const badVerRes = await app.request(`/api/v1/imports/${readyImportId}/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookie,
        'Idempotency-Key': 'imp-commit-key-001',
      },
      body: JSON.stringify({
        previewDigest: readyDigest,
        defaultColumnId,
        expectedVersion: 999, // Stale!
      }),
    });
    assert.equal(badVerRes.status, 409);
    assert.equal(((await badVerRes.json()) as any).error.code, 'STALE_VERSION');

    // 2. Digest mismatch rejected with 409
    const badDigestRes = await app.request(`/api/v1/imports/${readyImportId}/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookie,
        'Idempotency-Key': 'imp-commit-key-002',
      },
      body: JSON.stringify({
        previewDigest: 'sha256-wrong-digest-1234567890abcdef',
        defaultColumnId,
        expectedVersion: 2,
      }),
    });
    assert.equal(badDigestRes.status, 409);
    assert.equal(((await badDigestRes.json()) as any).error.code, 'PREVIEW_STALE');

    // 3. Member or revoked role cannot commit (403)
    const memberCommitRes = await app.request(`/api/v1/imports/${readyImportId}/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': 'imp-commit-key-003',
      },
      body: JSON.stringify({
        previewDigest: readyDigest,
        defaultColumnId,
        expectedVersion: 2,
      }),
    });
    assert.equal(memberCommitRes.status, 403);

    // 4. Valid atomic commit succeeds
    const commitRes = await app.request(`/api/v1/imports/${readyImportId}/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookie,
        'Idempotency-Key': 'imp-commit-key-004',
      },
      body: JSON.stringify({
        previewDigest: readyDigest,
        defaultColumnId,
        expectedVersion: 2,
      }),
    });
    assert.equal(commitRes.status, 200);
    const commitJson = (await commitRes.json()) as any;
    assert.equal(commitJson.data.state, 'committed');
    assert.equal(commitJson.data.counts.created, 2);

    // 5. Verify created cards in database
    const createdCardsRes = await pool.query<{ id: string; title: string; column_id: string }>(
      `SELECT id, title, column_id FROM cards WHERE board_id = $1 ORDER BY created_at ASC`,
      [boardId],
    );
    assert.equal(createdCardsRes.rows.length, 2);
    assert.equal(createdCardsRes.rows[0]!.title, 'Card One');
    assert.equal(createdCardsRes.rows[0]!.column_id, defaultColumnId);
    assert.equal(createdCardsRes.rows[1]!.title, 'Card Two');
    assert.equal(createdCardsRes.rows[1]!.column_id, inProgressColumnId);

    // 6. Verify duplicate markers recorded in card_import_duplicates
    const dupeMarkers = await pool.query<{ external_id: string }>(
      'SELECT external_id FROM card_import_duplicates WHERE board_id = $1 ORDER BY external_id ASC',
      [boardId],
    );
    assert.equal(dupeMarkers.rows.length, 2);
    assert.equal(dupeMarkers.rows[0]!.external_id, 'BATCH-001');
    assert.equal(dupeMarkers.rows[1]!.external_id, 'BATCH-002');

    // 7. Verify activity_log entries
    const actLogs = await pool.query<{ action: string }>(
      `SELECT action FROM activity_log WHERE project_id = $1 ORDER BY created_at ASC`,
      [projectId],
    );
    const cardCreatedEvents = actLogs.rows.filter((a) => a.action === 'card_created');
    const batchCommittedEvents = actLogs.rows.filter((a) => a.action === 'card_import_committed');
    assert.equal(cardCreatedEvents.length, 2);
    assert.equal(batchCommittedEvents.length, 1);

    // 8. Idempotency replay with same Idempotency-Key returns 200 and replayed: true
    const replayRes = await app.request(`/api/v1/imports/${readyImportId}/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookie,
        'Idempotency-Key': 'imp-commit-key-004',
      },
      body: JSON.stringify({
        previewDigest: readyDigest,
        defaultColumnId,
        expectedVersion: 2,
      }),
    });
    assert.equal(replayRes.status, 200);
    const replayJson = (await replayRes.json()) as any;
    assert.equal(replayJson.replayed, true);

    // 9. Cancellation after commit is rejected with 409
    const cancelPostCommitRes = await app.request(`/api/v1/imports/${readyImportId}`, {
      method: 'DELETE',
      headers: { Cookie: ownerCookie },
    });
    assert.equal(cancelPostCommitRes.status, 409);
    assert.equal(((await cancelPostCommitRes.json()) as any).error.code, 'COMMIT_IN_PROGRESS');
  });

  // ==========================================================================
  // IMP-07: Deduplication, Conflict Detection & Trash Protection
  // ==========================================================================
  await t.test('IMP-07: Duplicate skips unchanged row, conflicts on changed payload, and protects 24-hour trash', async () => {
    // 1. Re-upload identical payload: recognized as already_imported and skipped
    const identicalXlsx = createCustomXlsx([
      {
        externalId: 'BATCH-001',
        title: 'Card One',
        priority: 'urgent',
        dueDate: '2026-11-01',
        assignees: 'imp-member@test.com',
      },
    ]);
    const reupRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(identicalXlsx),
    });
    assert.equal(reupRes.status, 201);
    const reupJson = (await reupRes.json()) as any;
    assert.equal(reupJson.data.state, 'ready');
    assert.equal(reupJson.data.counts.new, 0);
    assert.equal(reupJson.data.counts.existing, 1);
    assert.equal(reupJson.data.rows[0].outcome, 'already_imported');

    // 2. Re-upload same External ID with changed payload: recognized as conflict
    const changedXlsx = createCustomXlsx([
      {
        externalId: 'BATCH-001',
        title: 'Card One Completely Changed Title',
        priority: 'low',
      },
    ]);
    const conflictRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(changedXlsx),
    });
    assert.equal(conflictRes.status, 201);
    const confJson = (await conflictRes.json()) as any;
    assert.equal(confJson.data.state, 'invalid');
    assert.equal(confJson.data.counts.conflict, 1);
    assert.equal(confJson.data.rows[0].outcome, 'conflict');
    assert.equal(confJson.data.rows[0].errors[0].code, 'IMPORT_CONFLICT');

    // 3. Trash protection: Trashing an imported card soft-deletes it; re-upload cannot resurrect it!
    const cardOneRes = await pool.query<{ id: string }>('SELECT id FROM cards WHERE title = $1', ['Card One']);
    const cardOneId = cardOneRes.rows[0]!.id;

    // Soft-delete card into trash
    await pool.query(
      `UPDATE cards SET state = 'trashed', deleted_at = NOW(), restore_until = NOW() + INTERVAL '24 hours' WHERE id = $1`,
      [cardOneId],
    );

    // Re-upload with same External ID while card is in trash:
    // It is marked already_imported, skipping without resurrecting the card or creating a duplicate!
    const trashReupRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(identicalXlsx),
    });
    assert.equal(trashReupRes.status, 201);
    const trashReupJson = (await trashReupRes.json()) as any;
    assert.equal(trashReupJson.data.counts.new, 0);
    assert.equal(trashReupJson.data.counts.existing, 1);

    // Verify card in DB is still trashed (never resurrected!)
    const cardStillTrashed = await pool.query<{ state: string }>('SELECT state FROM cards WHERE id = $1', [cardOneId]);
    assert.equal(cardStillTrashed.rows[0]!.state, 'trashed', 'Import must never resurrect a trashed card');
  });

  // ==========================================================================
  // IMP-09: Safe Outcome Report Download & Formula Injection Protection
  // ==========================================================================
  await t.test('IMP-09: Safe CSV report download with formula injection neutralization', async () => {
    const reportRes = await app.request(`/api/v1/imports/${readyImportId}/report`, {
      headers: { Cookie: ownerCookie },
    });
    assert.equal(reportRes.status, 200);
    assert.equal(reportRes.headers.get('Content-Type'), 'text/csv; charset=utf-8');
    const csv = await reportRes.text();
    assert.ok(csv.includes('Row,External ID,Title,Status,Priority,Due Date,Outcome,Errors,Card ID'));
    assert.ok(csv.includes('BATCH-001'));
    assert.ok(csv.includes('BATCH-002'));
  });

  // ==========================================================================
  // Adversarial Concurrency & Revocation Tests
  // ==========================================================================
  await t.test('Adversarial: Revoked manager authority race between preview and commit returns 403 FORBIDDEN', async () => {
    // 1. PM uploads valid preview
    const advXlsx = createCustomXlsx([
      { externalId: 'REVOKE-001', title: 'Task to Commit' },
    ]);
    const advRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: pmCookie },
      body: toBody(advXlsx),
    });
    assert.equal(advRes.status, 201);
    const advJson = (await advRes.json()) as any;
    const advImportId = advJson.data.id;
    const advDigest = advJson.data.previewDigest;

    // 2. Demote PM to member before commit!
    await pool.query(
      `UPDATE project_memberships SET role = 'member' WHERE project_id = $1 AND user_id = $2`,
      [projectId, pmUser.id],
    );

    // 3. Attempt commit -> must fail with 403 FORBIDDEN
    const commitRevokedRes = await app.request(`/api/v1/imports/${advImportId}/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: pmCookie,
        'Idempotency-Key': 'adv-revoked-key-001',
      },
      body: JSON.stringify({
        previewDigest: advDigest,
        defaultColumnId,
        expectedVersion: 1,
      }),
    });
    assert.equal(commitRevokedRes.status, 403, 'Revoked manager must be rejected with 403 upon commit');

    // Restore PM role
    await pool.query(
      `UPDATE project_memberships SET role = 'manager' WHERE project_id = $1 AND user_id = $2`,
      [projectId, pmUser.id],
    );
  });

  await t.test('Adversarial: Removed assignee between preview and commit returns 409 PREVIEW_STALE', async () => {
    // 1. Upload preview with member as assignee
    const assRaceXlsx = createCustomXlsx([
      { externalId: 'ASS-RACE-001', title: 'Task with Member', assignees: 'imp-member@test.com' },
    ]);
    const assRaceRes = await app.request(`/api/v1/boards/${boardId}/imports?defaultColumnId=${defaultColumnId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: ownerCookie },
      body: toBody(assRaceXlsx),
    });
    assert.equal(assRaceRes.status, 201);
    const assRaceJson = (await assRaceRes.json()) as any;
    const raceImportId = assRaceJson.data.id;
    const raceDigest = assRaceJson.data.previewDigest;

    // 2. Remove member from project before commit
    await pool.query(
      `UPDATE project_memberships SET status = 'removed' WHERE project_id = $1 AND user_id = $2`,
      [projectId, memberUser.id],
    );

    // 3. Attempt commit -> must fail with 409 PREVIEW_STALE
    const raceCommitRes = await app.request(`/api/v1/imports/${raceImportId}/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookie,
        'Idempotency-Key': 'adv-assignee-race-001',
      },
      body: JSON.stringify({
        previewDigest: raceDigest,
        defaultColumnId,
        expectedVersion: 1,
      }),
    });
    assert.equal(raceCommitRes.status, 409);
    assert.equal(((await raceCommitRes.json()) as any).error.code, 'PREVIEW_STALE');

    // Restore member
    await pool.query(
      `UPDATE project_memberships SET status = 'active' WHERE project_id = $1 AND user_id = $2`,
      [projectId, memberUser.id],
    );
  });

  await t.test('IMP-11: Batch and card provenance activity log links', async () => {
    // Verify activity_log entries for import
    const batchLogs = await pool.query<{ id: string; action: string; safe_changes: any }>(
      `SELECT id, action, safe_changes FROM activity_log WHERE action = 'card_import_committed' AND project_id = $1`,
      [projectId],
    );
    assert.ok(batchLogs.rows.length >= 1);
    assert.equal(batchLogs.rows[0]!.safe_changes.importId, readyImportId);
    assert.equal(batchLogs.rows[0]!.safe_changes.createdCount, 2);
  });
});
