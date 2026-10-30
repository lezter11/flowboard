import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import zlib from 'node:zlib';
import type pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { getPool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { createCardImport } from '../src/adapters/imports.ts';
import { MAX_EXPANDED_BYTES, parseExcelWorkbook } from '../src/services/excel-parser.ts';

// FB-AUD-02 regression. Real PostgreSQL for the authorization order; the ZIP cases are pure.

/** Builds a one-entry-per-item ZIP. `declared` overrides the central-directory size fields. */
function zipEntries(entries: Array<{ name: string; data: Buffer; method?: 0 | 8; declaredSize?: number; raw?: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const method = e.method ?? 8;
    const body = e.raw ?? (method === 8 ? zlib.deflateRawSync(e.data) : e.data);
    const declared = e.declaredSize ?? e.data.length;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, body);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** Spies on inflateRawSync so tests can see the output cap every call receives. */
async function spyInflate<T>(run: (calls: Array<{ maxOutputLength: number | undefined; threw: string | null }>) => Promise<T> | T): Promise<T> {
  const original = zlib.inflateRawSync;
  const calls: Array<{ maxOutputLength: number | undefined; threw: string | null }> = [];
  (zlib as { inflateRawSync: typeof zlib.inflateRawSync }).inflateRawSync = ((input: Buffer, options?: zlib.ZlibOptions) => {
    try {
      const out = original(input, options);
      calls.push({ maxOutputLength: options?.maxOutputLength, threw: null });
      return out;
    } catch (err) {
      calls.push({ maxOutputLength: options?.maxOutputLength, threw: (err as NodeJS.ErrnoException).code ?? 'ERR' });
      throw err;
    }
  }) as typeof zlib.inflateRawSync;
  try {
    return await run(calls);
  } finally {
    (zlib as { inflateRawSync: typeof zlib.inflateRawSync }).inflateRawSync = original;
  }
}

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code ?? 'UNKNOWN';
  }
  return 'NO_ERROR';
}

const MiB = 1024 * 1024;

test('B-7 XLSX: a bomb is stopped by the decompressor cap, not after allocation', async () => {
  // Lying declared size: the central directory says 100 bytes, the member really holds 21 MiB.
  const bomb = zipEntries([
    { name: 'xl/workbook.xml', data: Buffer.alloc(MAX_EXPANDED_BYTES + MiB, 0x41), declaredSize: 100 },
  ]);
  await spyInflate((calls) => {
    assert.equal(errorCode(() => parseExcelWorkbook(bomb)), 'PAYLOAD_TOO_LARGE');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.maxOutputLength, MAX_EXPANDED_BYTES, 'first entry gets the full budget as hard cap');
    assert.equal(calls[0]!.threw, 'ERR_BUFFER_TOO_LARGE', 'inflation stopped at the cap');
  });
});

test('B-7 XLSX: an honest declared size over the remaining budget is refused before inflation', async () => {
  const big = zipEntries([
    { name: 'xl/sharedStrings.xml', data: Buffer.alloc(12 * MiB, 0x42) },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(12 * MiB, 0x43) },
  ]);
  await spyInflate((calls) => {
    assert.equal(errorCode(() => parseExcelWorkbook(big)), 'PAYLOAD_TOO_LARGE');
    // The first 12 MiB member inflates within budget; the second is refused on its declared size
    // (12 MiB > 8 MiB left), so it is never handed to the decompressor.
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.threw, null);
    assert.equal(calls[1], undefined);
  });
});

test('B-7 XLSX: a garbage payload with an oversize declared size reports the size, not a decode error', async () => {
  const garbage = zipEntries([
    { name: 'xl/workbook.xml', data: Buffer.alloc(0), declaredSize: MAX_EXPANDED_BYTES + 1, raw: Buffer.from('not deflate') },
  ]);
  await spyInflate((calls) => {
    assert.equal(errorCode(() => parseExcelWorkbook(garbage)), 'PAYLOAD_TOO_LARGE');
    assert.equal(calls.length, 0, 'the decompressor is never called');
  });
});

test('B-7 XLSX: a stored (uncompressed) member is capped by the same budget', () => {
  const stored = zipEntries([
    { name: 'xl/workbook.xml', data: Buffer.alloc(MAX_EXPANDED_BYTES + 1, 0x44), method: 0 },
  ]);
  assert.equal(errorCode(() => parseExcelWorkbook(stored)), 'PAYLOAD_TOO_LARGE');
});

test('B-7 XLSX: a corrupt deflate stream still reports DECOMPRESSION_FAILED', () => {
  const corrupt = zipEntries([
    { name: 'xl/workbook.xml', data: Buffer.alloc(10), raw: Buffer.from('definitely not deflate data') , declaredSize: 10 },
  ]);
  assert.equal(errorCode(() => parseExcelWorkbook(corrupt)), 'DECOMPRESSION_FAILED');
});

// ---- Board existence and actor grant come before parsing (createCardImport). ----

const pool = getPool();
const sfx = () => crypto.randomBytes(4).toString('hex');
const NOT_A_WORKBOOK = Buffer.from('this is not a zip file at all, so parsing would fail');

async function setup(p: pg.Pool) {
  await runMigrations(p);
  const s = sfx();
  const mk = async (label: string) => {
    const { user } = await createDevUserAndSession(`${label}.${s}@flowboard.example`, label, p);
    return user.id as string;
  };
  const owner = await mk('owner');
  const manager = await mk('manager');
  const member = await mk('member');
  const viewer = await mk('viewer');
  const noGrant = await mk('nogrant');
  const ws = `ws_${s}`;
  const project = `p_${s}`;
  const board = `b_${s}`;
  const col = `c_${s}`;
  await p.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,now(),now())`, [ws, owner]);
  await p.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,'P',now(),now())`, [project, ws]);
  await p.query(`INSERT INTO boards (id,workspace_id,project_id,name,created_at,updated_at) VALUES ($1,$2,$3,'B',now(),now())`, [board, ws, project]);
  await p.query(
    `INSERT INTO columns (id,workspace_id,project_id,board_id,name,color,category,position,version,created_at,updated_at)
     VALUES ($1,$2,$3,$4,'To do','#000000','todo',0,1,now(),now())`,
    [col, ws, project, board],
  );
  const membership = (label: string, userId: string, role: string) =>
    p.query(
      `INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'active',now(),now())`,
      [`pm_${label}_${s}`, project, ws, userId, role],
    );
  await membership('manager', manager, 'manager');
  await membership('member', member, 'member');
  await membership('viewer', viewer, 'viewer');
  await membership('nogrant', noGrant, 'manager');
  await p.query(
    `INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by)
     SELECT $1,$2,$3,u,$4 FROM unnest($5::text[]) AS u`,
    [board, project, ws, owner, [manager, member, viewer]],
  );
  return { board, col, manager, member, viewer, noGrant, owner };
}

async function importAs(p: pg.Pool, boardId: string, columnId: string, actorId: string, fileBuffer: Buffer) {
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    try {
      return await createCardImport(client, { boardId, fileBuffer, defaultColumnId: columnId, actorId });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
    }
  } finally {
    client.release();
  }
}

test('B-7 XLSX import: callers without an import right never reach the parser', async (t) => {
  const fx = await setup(pool);

  await t.test('no grant gets 404 before any parsing (the bytes are not a workbook)', async () => {
    await assert.rejects(importAs(pool, fx.board, fx.col, fx.noGrant, NOT_A_WORKBOOK), (err: any) => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'NOT_FOUND');
      return true;
    });
  });

  await t.test('a viewer with a grant gets 403 before any parsing', async () => {
    await assert.rejects(importAs(pool, fx.board, fx.col, fx.viewer, NOT_A_WORKBOOK), (err: any) => {
      assert.equal(err.status, 403);
      assert.equal(err.code, 'FORBIDDEN');
      return true;
    });
  });

  await t.test('a member with a grant gets 403 before any parsing', async () => {
    await assert.rejects(importAs(pool, fx.board, fx.col, fx.member, NOT_A_WORKBOOK), (err: any) => {
      assert.equal(err.status, 403);
      return true;
    });
  });

  await t.test('an unknown board gets 404 before any parsing', async () => {
    await assert.rejects(importAs(pool, `missing_${sfx()}`, fx.col, fx.manager, NOT_A_WORKBOOK), (err: any) => {
      assert.equal(err.status, 404);
      return true;
    });
  });

  await t.test('a no-grant caller sending a bomb never inflates it', async () => {
    const bomb = zipEntries([{ name: 'xl/workbook.xml', data: Buffer.alloc(MAX_EXPANDED_BYTES + MiB, 0x41) }]);
    await spyInflate((calls) => {
      return importAs(pool, fx.board, fx.col, fx.noGrant, bomb).then(
        () => assert.fail('expected rejection'),
        (err: any) => {
          assert.equal(err.code, 'NOT_FOUND');
          assert.equal(calls.length, 0);
        },
      );
    });
  });

  await t.test('an authorised manager sending a bomb is stopped by the parser cap', async () => {
    const bomb = zipEntries([{ name: 'xl/workbook.xml', data: Buffer.alloc(MAX_EXPANDED_BYTES + MiB, 0x41), declaredSize: 100 }]);
    await assert.rejects(importAs(pool, fx.board, fx.col, fx.manager, bomb), (err: any) => {
      assert.equal(err.status, 413);
      assert.equal(err.code, 'PAYLOAD_TOO_LARGE');
      return true;
    });
  });

  await t.test('an authorised manager with a non-workbook reaches the parser and gets its error', async () => {
    await assert.rejects(importAs(pool, fx.board, fx.col, fx.manager, NOT_A_WORKBOOK), (err: any) => {
      assert.equal(err.status, 422);
      assert.equal(err.code, 'INVALID_WORKBOOK');
      return true;
    });
  });
});
