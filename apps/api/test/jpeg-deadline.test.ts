import assert from 'node:assert/strict';
import test from 'node:test';
import { validateJpegEntropy } from '../src/services/jpeg-entropy.ts';
import { imageFixture } from './support/image-fixtures.ts';

test('JPEG shared deadline accepts complete pixels after3s while the8s preflight budget remains', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const work = validateJpegEntropy(imageFixture('jpeg').bytes);
  // Real scan parsing resumes after a scheduler pause. No real sleep or CPU claim.
  t.mock.timers.tick(3501);
  const metrics = await work;
  assert.ok(metrics.scans > 0);
  assert.ok(metrics.elapsedMs >= 3501);
});

test('JPEG shared deadline refuses an already expired preflight deadline before parsing', async () => {
  await assert.rejects(validateJpegEntropy(imageFixture('jpeg').bytes, undefined, Date.now() - 1), (error: any) => error.status === 503);
});

test('JPEG shared deadline cannot restart its budget after an earlier preflight phase', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const deadlineAt = Date.now() + 8000;
  t.mock.timers.tick(7900);
  const work = validateJpegEntropy(imageFixture('jpeg').bytes, undefined, deadlineAt);
  t.mock.timers.tick(101);
  await assert.rejects(work, (error: any) => error.status === 503);
});

test('JPEG shared deadline cannot extend the canonical8s ceiling through its optional argument', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const work = validateJpegEntropy(imageFixture('jpeg').bytes, undefined, Date.now() + 60000);
  t.mock.timers.tick(8001);
  await assert.rejects(work, (error: any) => error.status === 503);
});

for (const deadline of [NaN, Infinity, -Infinity]) test('JPEG shared deadline refuses a nonfinite deadline: ' + deadline, async () => {
  await assert.rejects(validateJpegEntropy(imageFixture('jpeg').bytes, undefined, deadline), (error: any) => error.status === 503);
});
