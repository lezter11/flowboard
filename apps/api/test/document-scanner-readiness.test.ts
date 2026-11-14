import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hasFreshDefinitions, scannerReadiness } from '../src/runtime/document-scanner/readiness.ts';

const present = Date.parse('2026-11-14T12:00:00Z');
const version = (date: string) => 'ClamAV 1.4.6/29820/' + date + '\0';
const fresh = version('Sat Nov 14 08:00:00 2026');
const stale = version('Thu Nov 12 11:59:59 2026');

test('scanner accepts freshness from the running ClamAV engine, with an inclusive 48-hour cutoff', () => {
  assert.equal(hasFreshDefinitions(fresh, present), true);
  assert.equal(hasFreshDefinitions(stale, present), false);
  assert.equal(hasFreshDefinitions(version('Thu Nov 12 12:00:00 2026'), present), true);
  assert.equal(hasFreshDefinitions(version('Sat Nov 14 12:05:01 2026'), present), false);
  assert.equal(hasFreshDefinitions('ClamAV 1.4.6\0', present), false);
  assert.equal(hasFreshDefinitions(fresh + 'extra', present), false);
  assert.equal(hasFreshDefinitions('ClamAV 1.4.6/0/Sat Nov 14 08:00:00 2026\0', present), false);
  assert.equal(hasFreshDefinitions(version('Fri Nov 14 08:00:00 2026'), present), false);
  assert.equal(hasFreshDefinitions(version('Wed Sep 31 08:00:00 2026'), Date.parse('2026-10-01T12:00:00Z')), false);
});

test('scanner readiness uses the live engine and requires clean and detected canaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fb-scanner-'));
  const socket = join(directory, 'clamd.sock');
  let versionReply = fresh;
  let positive = 'stream: StandardTest FOUND\0';
  let clock = present;
  let versions = 0;
  let scans = 0;
  const server = createServer(conn => {
    let pending = Buffer.alloc(0);
    conn.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.equals(Buffer.from('zVERSION\0'))) {
        versions++;
        conn.end(versionReply);
      } else if (pending.length >= 18 && pending.length === 18 + pending.readUInt32BE(10)) {
        assert.equal(pending.subarray(0, 10).toString(), 'zINSTREAM\0');
        assert.equal(pending.readUInt32BE(pending.length - 4), 0);
        scans++;
        const isClean = pending.subarray(14, -4).toString().startsWith('Flowboard');
        conn.end(isClean ? 'stream: OK\0' : positive);
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => server.listen(socket, resolve).once('error', reject));
    const ready = scannerReadiness(socket, () => clock);
    assert.deepEqual(await Promise.all([ready(), ready()]), [true, true]);
    assert.equal(versions, 1);
    assert.equal(scans, 2);
    assert.equal(await ready(), true);
    assert.equal(versions, 2);
    assert.equal(scans, 2);
    versionReply = stale;
    assert.equal(await ready(), false);
    assert.equal(scans, 2);
    versionReply = fresh;
    positive = 'stream: OK\0';
    // A failure invalidates the previous cached successful canary even before expiry.
    assert.equal(await ready(), false);
    assert.equal(scans, 4);
    positive = 'stream: StandardTest FOUND\0';
    assert.equal(await ready(), true);
    assert.equal(scans, 6);
    clock += 61_000;
    positive = 'stream: OK\0';
    assert.equal(await ready(), false);
    assert.equal(scans, 8);
    assert.equal(await scannerReadiness(join(directory, 'missing.sock'))(), false);
  } finally {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
