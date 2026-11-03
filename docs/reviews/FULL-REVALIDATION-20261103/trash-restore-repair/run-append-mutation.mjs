import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const source = 'apps/api/src/adapters/trash.ts';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const held = await fs.readFile(source, 'utf8');
const scratch = await fs.mkdtemp('/private/tmp/flowboard-restore-mutation-');
let status = 0;
try {
  await fs.mkdir(path.join(scratch, 'apps/api/test/support'), { recursive: true });
  await fs.mkdir(path.join(scratch, 'database'), { recursive: true });
  await fs.cp('apps/api/src', path.join(scratch, 'apps/api/src'), { recursive: true });
  for (const name of ['lifecycle-fixture.ts', 'import-database.ts']) await fs.copyFile(`apps/api/test/support/${name}`, path.join(scratch, 'apps/api/test/support', name));
  await fs.copyFile('apps/api/test/trash-restore-placement.test.ts', path.join(scratch, 'apps/api/test/trash-restore-placement.test.ts'));
  await fs.cp('database/migrations', path.join(scratch, 'database/migrations'), { recursive: true });
  await fs.symlink(path.join(root, 'node_modules'), path.join(scratch, 'node_modules'), 'dir');
  await fs.writeFile(path.join(scratch, 'package.json'), '{"type":"module"}\n');
  const needle = '    newPosition = rankAtGap();\n  }';
  assert.equal(held.split(needle).length, 2, 'Mutation must target only the post-compaction fallback');
  const mutated = held.replace(needle, '    newPosition = (destCards.length + 1) * 1000;\n  }');
  await fs.writeFile(path.join(scratch, source), mutated);
  console.log(JSON.stringify({ kind: 'Isolated mutation reintroduces append fallback after compaction; corrected numeric-order assertions must catch it', sourceSHA256: sha(held), mutationSHA256: sha(mutated), productionSourceEdited: false }));
  status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', '--test-name-pattern=nearest surviving gap|head insertion', path.join(scratch, 'apps/api/test/trash-restore-placement.test.ts')], { cwd: scratch, env: process.env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => resolve(code ?? 1));
  });
  assert.equal(status, 1, 'Append fallback must be rejected by both behavior regressions');
} finally {
  assert.equal(sha(await fs.readFile(source)), sha(held), 'Held product source must stay unchanged');
  await fs.rm(scratch, { recursive: true, force: true });
}
console.log(`MUTATED_TEST_EXIT:${status}; EXPECTED:1; HARNESS_EXIT:0`);
