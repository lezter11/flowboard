// Entry routing for every page request (owned by UI; deployed with the Pages project).
//
// The session cookie is HttpOnly, so only the server can say whether it is valid. This
// middleware asks the API (GET /api/v1/session) over the same service binding the /api proxy
// uses, then sends the visitor to the right place before any HTML is served:
//   signed out -> /signin          (never reveals whether a project or board id exists)
//   signed in  -> their landing page when they hit /, /signin, /sign or an unknown path
// Static files, /_next/*, /api/* and non-GET requests pass straight through with no API call.
// Redirects are Cache-Control: no-store. The client gate in components/shell/session-gate.tsx
// covers in-app navigation, where no page request reaches this file.

import { APP_ROUTES, signinPathFor } from '../src/lib/return-path';
import { chooseLanding } from '../src/lib/landing-rule';

interface ApiFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  API?: ApiFetcher;
  API_ORIGIN?: string;
}

/** The API accepts both names (apps/api/src/http/middleware/auth.ts). */
const SESSION_COOKIES = ['flowboard_session=', 'session='];

/** Legacy path-style links; the functions in projects/[id].ts and boards/[id].ts redirect them. */
const LEGACY = /^\/(projects|boards)\/[^/]+$/;
/** Pages that handle a signed-out visitor themselves (an invitation link must keep its token). */
const SELF_GUARDED = new Set(['/invitation', '/invitations/accept']);

const redirect = (path: string): Response =>
  new Response(null, {
    status: 302,
    headers: { Location: path, 'Cache-Control': 'no-store' },
  });

async function callApi(env: Env, request: Request, path: string, cookie: string): Promise<Response | null> {
  const url = new URL(path, request.url);
  const init: RequestInit = { method: 'GET', headers: { cookie, accept: 'application/json' }, redirect: 'manual' };
  try {
    if (env.API) return await env.API.fetch(new Request(url.toString(), init));
    if (env.API_ORIGIN) {
      const origin = new URL(env.API_ORIGIN);
      url.protocol = origin.protocol;
      url.host = origin.host;
      return await fetch(new Request(url.toString(), init));
    }
  } catch {
    return null;
  }
  return null;
}

interface SessionProject { id: string; isArchived?: boolean; isOwned?: boolean; role?: string }
interface LastLocation { projectId: string; boardId: string | null }

/** Where a valid session lands: its remembered location, else the projects hub on first run when it owns no project, else the only project/board it can open, else the projects hub (rule: src/lib/landing-rule.ts, shared with the client). */
async function landingPath(env: Env, request: Request, cookie: string, projects: SessionProject[], last: LastLocation | null): Promise<string> {
  const choice = chooseLanding(projects, last);
  if ('to' in choice) return choice.to;
  const projectId = choice.singleProject;
  const res = await callApi(env, request, `/api/v1/projects/${encodeURIComponent(projectId)}/boards`, cookie);
  if (res?.ok) {
    const body = (await res.json().catch(() => null)) as { data?: Array<{ id: string; isArchived?: boolean }> } | Array<{ id: string; isArchived?: boolean }> | null;
    const list = Array.isArray(body) ? body : body?.data;
    const boards = (list ?? []).filter((b) => !b.isArchived);
    if (boards.length === 1) return `/board?id=${encodeURIComponent(boards[0]!.id)}`;
  }
  return `/project?id=${encodeURIComponent(projectId)}`;
}

export const onRequest = async (context: { request: Request; env: Env; next: () => Promise<Response> }): Promise<Response> => {
  const { request, env } = context;
  const url = new URL(request.url);

  // Cheap exits first: nothing below may cost an API call for assets or API traffic.
  if (request.method !== 'GET' && request.method !== 'HEAD') return context.next();
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  const last = path.split('/').pop() ?? '';
  if (path.startsWith('/_') || path.startsWith('/api/') || last.includes('.') || request.headers.has('rsc')) return context.next();
  if (SELF_GUARDED.has(path)) return context.next();

  const isSignin = path === '/signin';
  const isApp = APP_ROUTES.has(path) || LEGACY.test(path);

  const cookie = request.headers.get('cookie') ?? '';
  const hasCookie = cookie.split(';').some((part) => SESSION_COOKIES.some((name) => part.trim().startsWith(name)));

  let projects: SessionProject[] | null = null;
  let lastLoc: LastLocation | null = null;
  if (hasCookie) {
    const res = await callApi(env, request, '/api/v1/session', cookie);
    if (res?.ok) {
      const body = (await res.json().catch(() => null)) as { data?: { accessibleProjects?: SessionProject[]; lastLocation?: LastLocation | null } } | null;
      projects = body?.data?.accessibleProjects ?? [];
      lastLoc = body?.data?.lastLocation ?? null;
    } else if (!res || res.status !== 401) {
      // The API is down or erroring. Do not guess: let the page load and show its own error state.
      return context.next();
    }
  }

  if (!projects) {
    // Signed out (no cookie, or the API said 401).
    if (isSignin) return context.next();
    // An app route keeps its path (and one id) as ?next=; legacy and unknown paths do not.
    return redirect(signinPathFor(path, url.search));
  }

  if (isApp) return context.next();
  return redirect(await landingPath(env, request, cookie, projects, lastLoc));
};
