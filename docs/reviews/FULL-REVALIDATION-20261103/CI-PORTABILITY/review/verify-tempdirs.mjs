import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const filenames = ['apps/api/test/image-admission-worker.test.ts','apps/api/test/image-integrity-worker.test.ts','apps/api/test/import-repair.test.ts','apps/api/test/import-worker-template.test.ts','apps/api/test/png-stream-worker.test.ts','apps/api/test/runtime-validation.test.ts','apps/api/test/support/lifecycle-fixture.ts'];
const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'flowboard-review-tmp-root-'));
const root = path.join(parent, 'selected temp with spaces');
await fs.mkdir(root, {mode: 0o700});
const initial = process.env.TMPDIR;
process.env.TMPDIR = root;
try {
  assert.equal(os.tmpdir(),root);
  for (const filename of filenames) {
    const source = await fs.readFile(filename, 'utf8');
    assert.doesNotMatch(source, /mkdtemp\(['"]\/private\/tmp/);
    const match = source.match(/mkdtemp\(path\.join\(os\.tmpdir\(\),\s*'([^']+)'\)\)/);
    assert.ok(match, filename + ': portable mkdtemp expression');
    const first = await fs.mkdtemp(path.join(os.tmpdir(),match[1]));
    const second = await fs.mkdtemp(path.join(os.tmpdir(),match[1]));
    assert.notEqual(first,second);
    for (const dir of [first,second]) {
      assert.equal(path.dirname(dir),root);
      assert.equal((await fs.stat(dir)).mode & 0o777,0o700);
      await fs.writeFile(path.join(dir,'wrangler.json'),JSON.stringify({name:'synthetic-review-probe'}));
      await fs.rm(dir,{recursive:true,force:true});
      await assert.rejects(fs.stat(dir),{code:'ENOENT'});
    }
    console.log(JSON.stringify({filename,prefix:match[1],selectedTemporaryRoot:true,unique:true,mode:'0700',cleanup:true}));
  }
} finally {
  if (initial === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = initial;
  await fs.rm(parent,{recursive:true,force:true});
}
console.log('PASS seven portable tempdir lifecycles; no Worker or database claim');
