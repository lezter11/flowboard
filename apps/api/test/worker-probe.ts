// Test entry point only; NOT imported by src or the normal Wrangler config.
import worker from '../src/runtime/worker.ts';
import type { WorkerBindings } from '../src/runtime/worker.ts';
import { createDatabase } from '../src/adapters/postgres.ts';
import { rollbackProbe } from './rollback-probe.ts';

const fetchOriginal = globalThis.fetch;
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const userinfoEndpoint = 'https://www.googleapis.com/oauth2/v3/userinfo';
const providerCode = /^(success|token-redirect|profile-redirect)-([a-f0-9]{32})$/;

// Only substitute the remote provider. Let workerd validate the actual RequestInit
// before the fake provider responds, so unsupported options fail in this test too.
globalThis.fetch = async (input, init) => {
  if (input !== tokenEndpoint && input !== userinfoEndpoint) return fetchOriginal(input, init);
  const request = new Request(input, init);
  if (request.redirect !== 'manual') throw new Error('Google requests must stop at redirects');
  if (input === tokenEndpoint) {
    const body = new URLSearchParams(await request.text());
    const code = body.get('code') ?? '';
    const attempt = providerCode.exec(code);
    if (!attempt || !/^[A-Za-z0-9_-]{43}$/.test(body.get('code_verifier') ?? '')) return new Response(null, { status: 400 });
    if (attempt[1] === 'token-redirect') return Response.redirect('https://unexpected-provider.example.test', 307);
    return Response.json({ access_token: code });
  }
  const attempt = providerCode.exec(request.headers.get('authorization')?.slice('Bearer '.length) ?? '');
  if (!attempt) return new Response(null, { status: 401 });
  if (attempt[1] === 'profile-redirect') return Response.redirect('https://unexpected-provider.example.test', 302);
  return Response.json({ sub: `synthetic-${attempt[2]}`, email: `worker-google-${attempt[2]}@flowboard.example`, email_verified: true });
};

export default {
  async fetch(request: Request, env: WorkerBindings) {
    if (new URL(request.url).pathname !== '/__test/rollback') return worker.fetch(request, env);
    const db = createDatabase(env.HYPERDRIVE.connectionString, 1);
    try { return Response.json(await rollbackProbe(db)); }
    finally { await db.destroy(); }
  },
};
