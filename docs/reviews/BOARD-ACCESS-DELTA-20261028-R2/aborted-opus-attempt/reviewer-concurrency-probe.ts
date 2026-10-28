// Round-2 reviewer probe: concurrent mounted-handler combinations on one board.
// Usage: NODE_ENV=test FLOWBOARD_ACCESS_TEST_DATABASE_URL=... node docs/reviews/BOARD-ACCESS-DELTA-20261028-R2/reviewer-concurrency-probe.ts [iterations]
// Runs in a throwaway schema of the disposable access-test database and drops it afterwards.
import crypto from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';

const url = process.env.FLOWBOARD_ACCESS_TEST_DATABASE_URL!;
const N = Number(process.argv[2] ?? 15);
const only = process.argv[3];
const schema = `r2_conc_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool = new pg.Pool({ connectionString: url, max: 20, options: `-c search_path=${schema}` });

async function deadlocks(): Promise<number> {
  await new Promise((r) => setTimeout(r, 1200));
  const c = await admin.connect();
  try {
    await c.query('SELECT pg_stat_clear_snapshot()');
    return Number((await c.query('SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()')).rows[0].deadlocks);
  } finally { c.release(); }
}

try {
  await runMigrations(pool);
  const mk = (e: string, n: string) => createDevUserAndSession(e, n, pool);
  const O = await mk('o@r2.invalid', 'Owner');
  const M = await mk('m@r2.invalid', 'Manager');
  const A = await mk('a@r2.invalid', 'MemberA');
  const B = await mk('b@r2.invalid', 'MemberB');
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','W','UTC',$1,NOW(),NOW())`, [O.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p','w','P',NOW(),NOW())`);
  const addMember = async (u: typeof M, role: string) => pool.query(
    `INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,created_at,updated_at)
     VALUES ($1,'p','w',$2,$3,'active',NOW(),NOW())
     ON CONFLICT (project_id,user_id) DO UPDATE SET status='active', role=EXCLUDED.role`, ['pm_' + crypto.randomUUID(), u.user.id, role]);
  await addMember(M, 'manager'); await addMember(A, 'member'); await addMember(B, 'member');
  const app = createApp(async () => {}, { pool });

  type Who = typeof O;
  const call = async (who: Who, method: string, path: string, body?: unknown, key?: string) => {
    const t0 = performance.now();
    const res = await app.request(path, {
      method,
      headers: { cookie: `flowboard_session=${who.session.id}`, 'content-type': 'application/json', 'Idempotency-Key': key ?? 'k-' + crypto.randomUUID() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, ms: Math.round(performance.now() - t0), text };
  };
  const json = (t: string) => JSON.parse(t);

  const newBoard = async () => {
    const r = await call(O, 'POST', '/api/v1/projects/p/boards', { name: 'B' + crypto.randomUUID().slice(0, 6) });
    const id = json(r.text).data.id as string;
    for (const u of [M, A, B]) {
      await pool.query(`INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by) VALUES ($1,'p','w',$2,$3)`, [id, u.user.id, O.user.id]);
    }
    const cols = (await pool.query('SELECT id FROM columns WHERE board_id=$1 ORDER BY position', [id])).rows.map((x) => x.id as string);
    return { id, cols };
  };
  const bv = async (boardId: string) => Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [boardId])).rows[0].structure_version);
  const ar = async (boardId: string) => String((await pool.query('SELECT access_revision FROM boards WHERE id=$1', [boardId])).rows[0].access_revision);
  const card = async (boardId: string, col: string, title = 'C') => {
    const r = await call(O, 'POST', `/api/v1/boards/${boardId}/cards`, { title, columnId: col, expectedBoardVersion: await bv(boardId) });
    if (r.status !== 201) throw new Error('setup create ' + r.status + r.text);
    const d = json(r.text).data; return { id: d.id as string, version: d.version as number };
  };
  const resetMembers = async () => { await addMember(M, 'manager'); await addMember(A, 'member'); await addMember(B, 'member'); await pool.query(`UPDATE projects SET archived=false WHERE id='p'`); };

  const scenarios: Record<string, () => Promise<{ label: string; status: number; ms: number; text: string }[]>> = {
    'S1 comment(X) vs edit(X)': async () => {
      const b = await newBoard(); const x = await card(b.id, b.cols[0]!);
      const rs = await Promise.all([
        call(A, 'POST', `/api/v1/cards/${x.id}/comments`, { body: 'hello' }),
        call(B, 'PATCH', `/api/v1/cards/${x.id}`, { title: 'edited', expectedVersion: x.version }),
      ]);
      return rs.map((r, i) => ({ label: ['comment', 'edit'][i]!, ...r }));
    },
    'S2 comment(X) vs move(Y into X column)': async () => {
      const b = await newBoard(); const x = await card(b.id, b.cols[0]!); const y = await card(b.id, b.cols[1]!);
      const v = await bv(b.id);
      const rs = await Promise.all([
        call(A, 'POST', `/api/v1/cards/${x.id}/comments`, { body: 'hello' }),
        call(B, 'POST', `/api/v1/cards/${y.id}/move`, { toColumnId: b.cols[0], previousCardId: x.id, nextCardId: null, expectedVersion: y.version, expectedBoardVersion: v }),
      ]);
      return rs.map((r, i) => ({ label: ['comment', 'move'][i]!, ...r }));
    },
    'S3 trash(X) vs move(Y into X column)': async () => {
      const b = await newBoard(); const x = await card(b.id, b.cols[0]!); const y = await card(b.id, b.cols[1]!);
      const v = await bv(b.id);
      const rs = await Promise.all([
        call(M, 'POST', `/api/v1/cards/${x.id}/delete`, { expectedVersion: x.version, expectedBoardVersion: v }),
        call(A, 'POST', `/api/v1/cards/${y.id}/move`, { toColumnId: b.cols[0], previousCardId: x.id, nextCardId: null, expectedVersion: y.version, expectedBoardVersion: v }),
      ]);
      return rs.map((r, i) => ({ label: ['trash', 'move'][i]!, ...r }));
    },
    'S4 trash(X) vs edit(X)': async () => {
      const b = await newBoard(); const x = await card(b.id, b.cols[0]!); const v = await bv(b.id);
      const rs = await Promise.all([
        call(M, 'POST', `/api/v1/cards/${x.id}/delete`, { expectedVersion: x.version, expectedBoardVersion: v }),
        call(A, 'PATCH', `/api/v1/cards/${x.id}`, { title: 'edited', expectedVersion: x.version }),
      ]);
      return rs.map((r, i) => ({ label: ['trash', 'edit'][i]!, ...r }));
    },
    'S5 board archive vs 3 creates': async () => {
      const b = await newBoard(); const v = await bv(b.id);
      const rs = await Promise.all([
        call(O, 'POST', `/api/v1/boards/${b.id}/archive`, {}),
        call(A, 'POST', `/api/v1/boards/${b.id}/cards`, { title: 'a', columnId: b.cols[0], expectedBoardVersion: v }),
        call(B, 'POST', `/api/v1/boards/${b.id}/cards`, { title: 'b', columnId: b.cols[0], expectedBoardVersion: v }),
        call(M, 'POST', `/api/v1/boards/${b.id}/cards`, { title: 'm', columnId: b.cols[0], expectedBoardVersion: v }),
      ]);
      return rs.map((r, i) => ({ label: ['archive', 'createA', 'createB', 'createM'][i]!, ...r }));
    },
    'S6 grant removal(A) vs A move + A create': async () => {
      const b = await newBoard(); const y = await card(b.id, b.cols[0]!); const v = await bv(b.id); const rev = await ar(b.id);
      const rs = await Promise.all([
        call(A, 'POST', `/api/v1/cards/${y.id}/move`, { toColumnId: b.cols[1], previousCardId: null, nextCardId: null, expectedVersion: y.version, expectedBoardVersion: v }),
        call(O, 'DELETE', `/api/v1/boards/${b.id}/grants/${A.user.id}`, { expectedAccessRevision: rev }),
        call(A, 'POST', `/api/v1/boards/${b.id}/cards`, { title: 'late', columnId: b.cols[0], expectedBoardVersion: v }),
      ]);
      const grantLeft = (await pool.query('SELECT 1 FROM board_grants WHERE board_id=$1 AND user_id=$2', [b.id, A.user.id])).rowCount;
      return rs.map((r, i) => ({ label: ['moveA', 'revokeA', 'createA'][i]! + (i === 1 ? `(grantLeft=${grantLeft})` : ''), ...r }));
    },
    'S7 member removal(A) vs A edit + A comment + B move': async () => {
      await resetMembers();
      const b = await newBoard(); const x = await card(b.id, b.cols[0]!); const y = await card(b.id, b.cols[1]!); const v = await bv(b.id);
      const rs = await Promise.all([
        call(A, 'PATCH', `/api/v1/cards/${x.id}`, { title: 'edited', expectedVersion: x.version }),
        call(O, 'DELETE', `/api/v1/projects/p/members/${A.user.id}`),
        call(A, 'POST', `/api/v1/cards/${x.id}/comments`, { body: 'c' }),
        call(B, 'POST', `/api/v1/cards/${y.id}/move`, { toColumnId: b.cols[0], previousCardId: x.id, nextCardId: null, expectedVersion: y.version, expectedBoardVersion: v }),
      ]);
      const res = rs.map((r, i) => ({ label: ['editA', 'removeA', 'commentA', 'moveB'][i]!, ...r }));
      await resetMembers();
      return res;
    },
    'S8 two project PATCH': async () => {
      await resetMembers();
      const ver = Number((await pool.query(`SELECT version FROM projects WHERE id='p'`)).rows[0].version);
      const rs = await Promise.all([
        call(O, 'PATCH', '/api/v1/projects/p', { name: 'P-' + crypto.randomUUID().slice(0, 4), expectedVersion: ver }),
        call(M, 'PATCH', '/api/v1/projects/p', { name: 'Q-' + crypto.randomUUID().slice(0, 4), expectedVersion: ver }),
      ]);
      return rs.map((r, i) => ({ label: ['patchO', 'patchM'][i]!, ...r }));
    },
    'S9 comment A + comment B + edit M + move O on X': async () => {
      const b = await newBoard(); const x = await card(b.id, b.cols[0]!); const v = await bv(b.id);
      const rs = await Promise.all([
        call(A, 'POST', `/api/v1/cards/${x.id}/comments`, { body: 'a' }),
        call(B, 'POST', `/api/v1/cards/${x.id}/comments`, { body: 'b' }),
        call(M, 'PATCH', `/api/v1/cards/${x.id}`, { title: 'edited', expectedVersion: x.version }),
        call(O, 'POST', `/api/v1/cards/${x.id}/move`, { toColumnId: b.cols[1], previousCardId: null, nextCardId: null, expectedVersion: x.version, expectedBoardVersion: v }),
      ]);
      return rs.map((r, i) => ({ label: ['commentA', 'commentB', 'editM', 'moveO'][i]!, ...r }));
    },
    'S10 column add(M) vs move(A) vs grant removal(M)': async () => {
      await resetMembers();
      const b = await newBoard(); const y = await card(b.id, b.cols[0]!); const v = await bv(b.id); const rev = await ar(b.id);
      const rs = await Promise.all([
        call(M, 'POST', `/api/v1/boards/${b.id}/columns`, { name: 'New', color: 'blue', category: 'todo', expectedBoardVersion: v }),
        call(A, 'POST', `/api/v1/cards/${y.id}/move`, { toColumnId: b.cols[1], previousCardId: null, nextCardId: null, expectedVersion: y.version, expectedBoardVersion: v }),
        call(O, 'DELETE', `/api/v1/boards/${b.id}/grants/${M.user.id}`, { expectedAccessRevision: rev }),
      ]);
      return rs.map((r, i) => ({ label: ['colAddM', 'moveA', 'revokeM'][i]!, ...r }));
    },
    'S11 project archive vs create + comment': async () => {
      await resetMembers();
      const b = await newBoard(); const x = await card(b.id, b.cols[0]!); const v = await bv(b.id);
      const rs = await Promise.all([
        call(A, 'POST', `/api/v1/boards/${b.id}/cards`, { title: 'a', columnId: b.cols[0], expectedBoardVersion: v }),
        call(O, 'POST', '/api/v1/projects/p/archive', {}),
        call(B, 'POST', `/api/v1/cards/${x.id}/comments`, { body: 'b' }),
      ]);
      await pool.query(`UPDATE projects SET archived=false WHERE id='p'`);
      return rs.map((r, i) => ({ label: ['createA', 'archiveP', 'commentB'][i]!, ...r }));
    },
    'S12 comment edit(A) vs edit card(B) same card': async () => {
      const b = await newBoard(); const x = await card(b.id, b.cols[0]!);
      const cm = await call(A, 'POST', `/api/v1/cards/${x.id}/comments`, { body: 'orig' });
      const cmd = json(cm.text).data;
      const xv = Number((await pool.query('SELECT version FROM cards WHERE id=$1', [x.id])).rows[0].version);
      const rs = await Promise.all([
        call(A, 'PATCH', `/api/v1/comments/${cmd.id}`, { body: 'changed', expectedVersion: cmd.version }),
        call(B, 'PATCH', `/api/v1/cards/${x.id}`, { title: 'edited', expectedVersion: xv }),
      ]);
      return rs.map((r, i) => ({ label: ['commentEditA', 'cardEditB'][i]!, ...r }));
    },
    'S13 same idempotency key x4 create': async () => {
      const b = await newBoard(); const v = await bv(b.id); const key = 'k-' + crypto.randomUUID();
      const rs = await Promise.all(Array.from({ length: 4 }, () => call(A, 'POST', `/api/v1/boards/${b.id}/cards`, { title: 'same', columnId: b.cols[0], expectedBoardVersion: v }, key)));
      const n = (await pool.query(`SELECT count(*)::int AS n FROM cards WHERE board_id=$1 AND title='same'`, [b.id])).rows[0].n;
      return rs.map((r) => ({ label: `create(cardsCreated=${n})`, ...r }));
    },
  };

  const summary: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(scenarios)) {
    if (only && !name.startsWith(only)) continue;
    const before = await deadlocks();
    const hist: Record<string, number> = {};
    let maxMs = 0; const samples: string[] = [];
    for (let i = 0; i < N; i++) {
      const rs = await fn();
      for (const r of rs) {
        const code = r.status >= 400 ? (() => { try { return JSON.parse(r.text).error?.code; } catch { return '?'; } })() : '';
        const k = `${r.label}:${r.status}${code ? ' ' + code : ''}`;
        hist[k] = (hist[k] ?? 0) + 1; maxMs = Math.max(maxMs, r.ms);
        if ((r.status >= 500) && samples.length < 2) samples.push(`${r.label} ${r.status} ${r.text.slice(0, 200)}`);
      }
    }
    const after = await deadlocks();
    summary[name] = { iterations: N, deadlocksDelta: after - before, maxMs, statuses: hist, serverErrorSamples: samples };
    console.log(name, JSON.stringify(summary[name]));
  }
} finally {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
