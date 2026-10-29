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

interface ApiFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  API?: ApiFetcher;
  API_ORIGIN?: string;
}

const SESSION_COOKIE = 'flowboard_session';

/** Pages that need a session. Everything else that is not /signin or a pass-through is treated as unknown. */
const APP_ROUTES = new Set([
  '/projects', '/project', '/board', '/activity', '/trash', '/people', '/inbox',
  '/my-tasks', '/settings', '/import', '/add-card', '/all-work',
]);
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

interface SessionProject { id: string; isArchived?: boolean }

/** Where a valid session lands: the only project/board it can open, else the projects hub. */
async function landingPath(env: Env, request: Request, cookie: string, projects: SessionProject[]): Promise<string> {
  const open = projects.filter((p) => !p.isArchived);
  if (open.length !== 1) return '/projects';
  const projectId = open[0]!.id;
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
  const hasCookie = cookie.split(';').some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`));

  let projects: SessionProject[] | null = null;
  if (hasCookie) {
    const res = await callApi(env, request, '/api/v1/session', cookie);
    if (res?.ok) {
      const body = (await res.json().catch(() => null)) as { data?: { accessibleProjects?: SessionProject[] } } | null;
      projects = body?.data?.accessibleProjects ?? [];
    } else if (!res || res.status !== 401) {
      // The API is down or erroring. Do not guess: let the page load and show its own error state.
      return context.next();
    }
  }

  if (!projects) {
    // Signed out (no cookie, or the API said 401).
    if (isSignin) return context.next();
    return redirect('/signin');
  }

  if (isApp) return context.next();
  return redirect(await landingPath(env, request, cookie, projects));
};
