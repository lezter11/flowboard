import crypto from 'node:crypto';
import pg from 'pg';
import { createApp } from '/private/tmp/flowboard-pass2-36dfb3a/apps/api/src/http/app.ts';
import { runMigrations } from '/private/tmp/flowboard-pass2-36dfb3a/apps/api/src/adapters/migrations.ts';
import { createPool } from '/private/tmp/flowboard-pass2-36dfb3a/apps/api/src/adapters/postgres.ts';
import { createDevUserAndSession, createSession } from '/private/tmp/flowboard-pass2-36dfb3a/apps/api/src/adapters/session.ts';
import { MemoryStorageDriver } from '/private/tmp/flowboard-pass2-36dfb3a/apps/api/src/adapters/storage.ts';

const dbUrl = process.env.FLOWBOARD_AUDIT_DATABASE_URL;
if (!dbUrl || !new URL(dbUrl).pathname.endsWith('/flowboard_harness')) throw new Error('refusing non-disposable database');
const pool = createPool(dbUrl, 8);
const matrixPath = new URL('../route-authorization-matrix.json', import.meta.url);
const matrix = JSON.parse(await (await import('node:fs/promises')).readFile(matrixPath, 'utf8'));
const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
const roles = matrix.roles;
const actors = {};
const mk = async (label) => {
  const result = await createDevUserAndSession(`${label}.${suffix}@example.invalid`, `Audit ${label}`, pool);
  actors[label] = { id: result.user.id, cookie: `flowboard_session=${result.session.id}` };
};

try {
  await runMigrations(pool);
  for (const label of ['owner','manager','member','viewer','no_grant','revoked','stranger','other_project','foreign']) await mk(label);
  const ws = `au_ws_${suffix}`, project = `au_prj_${suffix}`, sibling = `au_sib_${suffix}`;
  const board = `au_board_${suffix}`, siblingBoard = `au_board2_${suffix}`, column = `au_col_${suffix}`, card = `au_card_${suffix}`;
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES($1,'Audit WS','UTC',$2,now(),now())`, [ws, actors.owner.id]);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES($1,$3,'Audit project',now(),now()),($2,$3,'Audit sibling',now(),now())`, [project,sibling,ws]);
  await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at) VALUES($1,$3,$4,'Audit board',now(),now()),($2,$3,$5,'Sibling board',now(),now())`, [board,siblingBoard,ws,project,sibling]);
  const memberships = [
    ['manager','manager','active'], ['member','member','active'], ['viewer','viewer','active'],
    ['no_grant','member','active'], ['revoked','member','removed'],
    ['other_project','member','active'], ['foreign','manager','active'],
  ];
  for (const [label,role,status] of memberships) {
    const targetProject = label === 'other_project' || label === 'foreign' ? sibling : project;
    await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,now(),now())`, [`au_pm_${label}_${suffix}`,targetProject,ws,actors[label].id,role,status]);
  }
  await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by) SELECT $1,$2,$3,u,$4 FROM unnest($5::text[]) u`, [board,project,ws,actors.owner.id,[actors.manager.id,actors.member.id,actors.viewer.id]]);
  await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,version,created_at,updated_at) VALUES($1,$2,$3,$4,'Todo','#64748b','todo',0,1,now(),now())`, [column,ws,project,board]);
  await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'Audit card','medium',1000,'active',1,now(),now())`, [card,ws,project,board,column]);

  const app = createApp(async () => {}, {
    pool,
    storage: new MemoryStorageDriver(),
    rateLimiter: () => ({ limit: async () => ({ success: true }) }),
    windowCounter: () => ({ consume: async () => ({ count: 1, retryAfterSeconds: 60 }) }),
  });
  const ids = { boardId: board, cardId: card, projectId: project, workspaceId: ws, columnId: column,
    userId: actors.member.id, id: 'audit-missing-id', importId: 'audit-missing-import',
    commentId: 'audit-missing-comment', uploadId: 'audit-missing-upload', imageId: 'audit-missing-image',
    invitationId: 'audit-missing-invitation' };
  const pathFor = (path) => path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_, key) => encodeURIComponent(ids[key] ?? `audit-missing-${key}`));
  const expectedRoles = roles.filter((role) => role !== 'unauthenticated');
  const actorFor = (role) => ({
    owner: actors.owner, manager: actors.manager, member: actors.member, viewer: actors.viewer,
    same_project_no_board_grant: actors.no_grant, revoked_member: actors.revoked,
    stranger: actors.stranger, other_project_member: actors.other_project,
    foreign_or_guessed_id: actors.foreign,
  })[role];
  const cells = [];
  for (const route of matrix.routes) {
    for (const role of roles) {
      const actor = actorFor(role);
      const headers = new Headers({ 'cf-connecting-ip': `192.0.2.${(cells.length % 250) + 1}`, 'x-request-id': `audit-${cells.length}` });
      if (actor) {
        let cookie = actor.cookie;
        if (route.path === '/api/v1/session/logout') {
          const fresh = await createSession(actor.id, 24, pool);
          cookie = `flowboard_session=${fresh.id}`;
        }
        headers.set('cookie', cookie);
      }
      if (['POST','PUT','PATCH','DELETE'].includes(route.method)) {
        headers.set('origin','http://localhost');
        headers.set('content-type', route.method === 'PUT' && route.path.includes('/content') ? 'application/octet-stream' : 'application/json');
      }
      let body;
      if (route.method === 'POST' || route.method === 'PATCH' || route.method === 'PUT') {
        body = route.path === '/api/v1/invitations/accept' ? JSON.stringify({token:'invalid-audit-token'})
          : route.path.includes('/content') ? new Uint8Array([0]) : JSON.stringify({});
      }
      let response;
      let transportError = null;
      try {
        response = await app.request(`http://localhost${pathFor(route.path)}`, { method: route.method, headers, ...(body === undefined ? {} : {body}) });
      } catch (error) { transportError = error?.name ?? 'Error'; }
      let dataKind = 'none', itemCount = null, errorCode = null;
      if (response) {
        const text = await response.text();
        try {
          const parsed = JSON.parse(text);
          errorCode = parsed?.error?.code ?? null;
          if (Object.hasOwn(parsed ?? {}, 'data')) {
            const data = parsed.data;
            dataKind = Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data;
            itemCount = Array.isArray(data) ? data.length : data && typeof data === 'object' ? Object.keys(data).length : null;
          }
        } catch { dataKind = text.length ? 'non-json' : 'empty'; }
        cells.push({ method: route.method, path: route.path, role, status: response.status, dataKind, itemCount, errorCode, bytes: text.length, transportError });
      } else cells.push({ method: route.method, path: route.path, role, status: null, dataKind, itemCount, errorCode, bytes: null, transportError });
      // Restore known mutable actor state after self-leave and revoke style calls.
      if (route.path === `/api/v1/projects/${project}/leave` && actor) {
        const row = memberships.find((item) => actors[item[0]].id === actor.id);
        if (row && row[0] !== 'revoked') await pool.query(`UPDATE project_memberships SET status='active' WHERE project_id=$1 AND user_id=$2`, [project,actor.id]);
      }
    }
  }
  const emptyData = (c) => ['none','empty'].includes(c.dataKind)
    || ((c.dataKind === 'array' || c.dataKind === 'object') && c.itemCount === 0);
  const non401403404NoData = cells.filter((c) => ![401,403,404].includes(c.status) && emptyData(c));
  const non401403404WithData = cells.filter((c) => ![401,403,404].includes(c.status) && !emptyData(c));
  const output = { commit:'36dfb3a4172ca5cc910c6c6503b4efd641031e35', routeCount:matrix.routes.length, roleCount:roles.length, cellCount:cells.length,
    countsByStatus:Object.fromEntries([...new Set(cells.map(c=>c.status))].sort((a,b)=>a-b).map(s=>[String(s),cells.filter(c=>c.status===s).length])),
    cells, non401403404NoData, non401403404WithData };
  const out = new URL('../route-authorization-matrix-pass2-execution.json', import.meta.url);
  await (await import('node:fs/promises')).writeFile(out, JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({routeCount:output.routeCount,roleCount:output.roleCount,cellCount:output.cellCount,countsByStatus:output.countsByStatus,non401403404NoData:non401403404NoData.length,non401403404WithData:non401403404WithData.length,outputFile:out.pathname}));
} finally { await pool.end(); }
