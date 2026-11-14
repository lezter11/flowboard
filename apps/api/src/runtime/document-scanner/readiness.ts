import { createConnection } from 'node:net';
import { scanClamdStream } from '../../services/document-processor-node.ts';

const MAX_DEFINITION_AGE = 48 * 60 * 60 * 1000;
const CLOCK_SKEW = 5 * 60 * 1000;
const PROBE_INTERVAL = 60_000;
const versionReply = /^ClamAV \d+\.\d+\.\d+(?:[-.][a-zA-Z0-9.]+)?\/[1-9]\d{0,9}\/((?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?: [1-9]|[12]\d|3[01]) (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d \d{4})\0$/;

export function hasFreshDefinitions(reply: string, now: number): boolean {
  const date = versionReply.exec(reply)?.[1];
  if (!date) return false;
  const parsed = new Date(date + ' UTC');
  const weekdayAndDate = parsed.toUTCString().replace(/^(\w{3}), (\d\d) (\w{3}) (\d{4}) (\S+) GMT$/, (_match, day, number, mon, year, time) =>
    day + ' ' + mon + ' ' + String(Number(number)).padStart(2, ' ') + ' ' + time + ' ' + year);
  if (weekdayAndDate !== date) return false;
  const age = now - parsed.getTime();
  return Number.isFinite(age) && age >= -CLOCK_SKEW && age <= MAX_DEFINITION_AGE;
}

async function loadedVersion(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path, signal: AbortSignal.timeout(800) });
    let response = '';
    socket.setEncoding('latin1');
    socket.once('connect', () => socket.write('zVERSION\0'));
    socket.on('data', (chunk: string) => {
      response += chunk;
      if (response.length > 256) socket.destroy(new Error('Unexpected ClamAV reply.'));
    });
    socket.once('error', reject);
    socket.once('end', () => resolve(response));
    socket.once('close', () => reject(new Error('ClamAV connection closed.')));
  });
}

// EICAR is a standardized benign anti-malware test file. Keep it encoded in source.
const testSignature = Buffer.from('WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=', 'base64');

/** Check the loaded engine, not a database file's modtime or an updater log. */
export function scannerReadiness(socket: string, now: () => number = Date.now) {
  let checked: { version: string; expires: number } | undefined;
  let pending: Promise<boolean> | undefined;

  async function check(): Promise<boolean> {
    try {
      const version = await loadedVersion(socket);
      if (!hasFreshDefinitions(version, now())) {
        checked = undefined;
        return false;
      }
      if (version === checked?.version && now() < checked.expires) return true;
      const signal = AbortSignal.timeout(2_000);
      const clean = await scanClamdStream(socket, Buffer.from('Flowboard scanner readiness canary'), signal);
      const detected = await scanClamdStream(socket, testSignature, signal);
      if (clean !== 'clean' || detected !== 'rejected') return false;
      checked = { version, expires: now() + PROBE_INTERVAL };
      return true;
    } catch {
      checked = undefined;
      return false;
    }
  }

  return () => {
    pending ??= check().finally(() => { pending = undefined; });
    return pending;
  };
}
