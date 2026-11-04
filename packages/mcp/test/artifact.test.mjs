import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const exec = promisify(execFile);
const packageDir = fileURLToPath(new URL('../', import.meta.url));
const repoDir = path.resolve(packageDir, '../..');
const token = `flw_pat_${'b'.repeat(64)}`;

// This command intentionally does not build. CI must first build from its clean
// checkout, then test the exact artifact it intends to distribute.
test('packed executable completes a real SDK handshake and calls metadata/search/create tools', { timeout: 30000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'flowboard-mcp-artifact-'));
  let server;
  let client;
  let transport;
  let stderr = '';
  try {
    const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
    const builtEntry = path.join(packageDir, manifest.bin['flowboard-mcp']);
    assert.match(await readFile(builtEntry, 'utf8'), /^#!\/usr\/bin\/env node\n/);
    assert.ok((await stat(builtEntry)).mode & 0o111, 'advertised bin must be executable');
    const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
    const userConfig = path.join(temp, 'empty-user.npmrc');
    const globalConfig = path.join(temp, 'empty-global.npmrc');
    await writeFile(userConfig, '');
    await writeFile(globalConfig, '');
    const packed = await exec(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--offline', '--pack-destination', temp], {
      cwd: packageDir,
      env: {
        PATH: process.env.PATH,
        HOME: temp,
        TMPDIR: temp,
        NPM_CONFIG_CACHE: path.join(temp, 'npm-cache'),
        NPM_CONFIG_USERCONFIG: userConfig,
        NPM_CONFIG_GLOBALCONFIG: globalConfig,
        NPM_CONFIG_AUDIT: 'false',
        NPM_CONFIG_FUND: 'false',
      },
      timeout: 10000,
    });
    const [details] = JSON.parse(packed.stdout);
    const names = details.files.map((file) => file.path);
    assert.ok(names.includes('dist/index.js'));
    assert.ok(names.includes('dist/client.js'));
    assert.ok(names.includes('dist/server.js'));
    assert.ok(names.includes('dist/server.d.ts'));
    assert.ok(names.includes('dist/schemas.js'));
    assert.ok(names.includes('README.md'));
    assert.equal(names.some((name) => name.startsWith('src/')), false);
    await exec('tar', ['-xzf', path.join(temp, details.filename), '-C', temp], { timeout: 5000 });
    const packedDir = path.join(temp, 'package');
    const installedManifest = JSON.parse(await readFile(path.join(packedDir, 'package.json'), 'utf8'));
    const entry = path.resolve(packedDir, installedManifest.bin['flowboard-mcp']);
    assert.equal(entry, path.join(packedDir, 'dist/index.js'));
    assert.ok((await stat(entry)).mode & 0o111);
    // Reuse only dependencies installed by the repository's npm ci/lockfile.
    // This is an offline tarball/bin smoke, not a fresh registry-install claim.
    await mkdir(path.join(packedDir, 'node_modules'));
    await symlink(path.join(repoDir, 'node_modules/zod'), path.join(packedDir, 'node_modules/zod'));
    await mkdir(path.join(packedDir, 'node_modules/@modelcontextprotocol'));
    await symlink(path.join(repoDir, 'node_modules/@modelcontextprotocol/sdk'), path.join(packedDir, 'node_modules/@modelcontextprotocol/sdk'));

    const requests = [];
    const operationKeys = [];
    server = createServer(async (req, res) => {
      try {
        assert.equal(req.headers.authorization, `Bearer ${token}`);
        const url = new URL(req.url, 'http://localhost');
        requests.push(`${req.method} ${url.pathname}`);
        res.setHeader('Content-Type', 'application/json');
        if (url.pathname === '/api/v1/projects') {
          res.end(JSON.stringify({ data: [{ id: 'proj_test', name: 'Synthetic project', description: null }], nextCursor: 'next-page' }));
        } else if (url.pathname === '/api/v1/projects/proj_test/boards') {
          res.end(JSON.stringify({ data: [{ id: 'brd_test', name: 'Synthetic board', structureVersion: 1 }] }));
        } else if (url.pathname === '/api/v1/boards/brd_test/metadata') {
          res.end(JSON.stringify({ data: { id: 'brd_test', name: 'Synthetic board', structureVersion: 1,
            columns: [{ id: 'col_test', name: 'Not started', category: 'todo', position: 0, cards: [{ title: 'must not escape' }] }] } }));
        } else if (url.pathname === '/api/v1/projects/proj_test/cards/search') {
          assert.equal(url.searchParams.get('query'), 'needle');
          assert.equal(url.searchParams.has('q'), false);
          res.end(JSON.stringify({ data: [{ id: 'crd_test', title: 'needle', boardId: 'brd_test', columnId: 'col_test', description: 'omitted' }], nextCursor: null }));
        } else if (req.method === 'POST' && url.pathname === '/api/v1/boards/brd_test/cards') {
          let text = '';
          for await (const chunk of req) text += chunk;
          assert.equal(JSON.parse(text).title, 'Synthetic card');
          operationKeys.push(req.headers['idempotency-key']);
          res.statusCode = 201;
          res.end(JSON.stringify({ data: { id: 'crd_created' }, replayed: operationKeys.length > 1 }));
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: { code: 'NOT_FOUND' } }));
        }
      } catch {
        // Never echo assertions containing request headers or tokens.
        res.statusCode = 500;
        res.end(JSON.stringify({ error: { code: 'STUB_ASSERTION_FAILED' } }));
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    // Invoke the advertised bin directly, so both shebang and executable mode
    // are exercised rather than bypassed with `node src/index.ts`.
    transport = new StdioClientTransport({
      command: entry,
      args: [],
      cwd: temp,
      env: { HOME: temp, FLOWBOARD_API_URL: `http://127.0.0.1:${port}`, FLOWBOARD_API_TOKEN: token },
      stderr: 'pipe',
    });
    transport.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    client = new Client({ name: 'flowboard-offline-artifact-test', version: '1.0.0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 5);
    const create = tools.find((tool) => tool.name === 'flowboard_create_card');
    assert.ok(create.inputSchema.required.includes('operationId'));
    assert.equal(create.annotations.idempotentHint, true);
    assert.equal(create.annotations.readOnlyHint, false);
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true, `tool failed: ${name}`);
      assert.equal(result.content[0].type, 'text');
      return JSON.parse(result.content[0].text);
    };
    assert.equal((await call('flowboard_list_projects', { limit: 1 })).nextCursor, 'next-page');
    assert.equal((await call('flowboard_list_boards', { projectId: 'proj_test' }))[0].id, 'brd_test');
    const columns = await call('flowboard_get_board_columns', { boardId: 'brd_test' });
    assert.doesNotMatch(JSON.stringify(columns), /must not escape|cards/);
    assert.equal((await call('flowboard_search_cards', { projectId: 'proj_test', query: 'needle' })).data.length, 1);
    const args = { operationId: '11111111-2222-3333-4444-555555555555', boardId: 'brd_test', column: 'col_test', title: 'Synthetic card' };
    assert.equal((await call('flowboard_create_card', args)).replayed, false);
    assert.equal((await call('flowboard_create_card', args)).replayed, true);
    assert.deepEqual(operationKeys, [args.operationId, args.operationId]);
    assert.equal(requests.some((request) => request === 'GET /api/v1/boards/brd_test'), false);
    const before = requests.length;
    const invalid = await client.callTool({ name: 'flowboard_create_card', arguments: { ...args, operationId: '' } });
    assert.equal(invalid.isError, true);
    assert.equal(requests.length, before, 'invalid tool input cannot reach API');
    assert.match(stderr, /running on stdio/);
    assert.doesNotMatch(stderr, /flw_pat_/);
  } finally {
    await client?.close();
    if (!client) await transport?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await rm(temp, { recursive: true, force: true });
  }
});
