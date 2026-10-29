/**
 * Return path for sign-in (?next=). Pure and dependency-free so the Pages middleware and the client gate share it.
 * Only a known app route and, for routes that take one, a single id parameter survive; everything else is dropped.
 * The API validates the value again before it redirects anywhere (apps/api/src/http/safe-next.ts).
 */
export const APP_ROUTES = new Set([
  '/projects', '/project', '/board', '/activity', '/trash', '/people', '/inbox',
  '/my-tasks', '/settings', '/import', '/add-card', '/all-work',
]);

const ID_PARAM: Record<string, string> = { '/board': 'id', '/project': 'id', '/add-card': 'board' };
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** `/signin?next=<route[?id=..]>` for an app route, plain `/signin` for anything else. */
export function signinPathFor(pathname: string, search: string): string {
  if (!APP_ROUTES.has(pathname)) return '/signin';
  const name = ID_PARAM[pathname];
  const id = name ? new URLSearchParams(search).get(name) : null;
  const next = id && SAFE_ID.test(id) ? `${pathname}?${name}=${id}` : pathname;
  return `/signin?next=${encodeURIComponent(next)}`;
}

/** Landing page for a remembered location: the board when there is one, else the project. */
export function locationPath(last: { projectId: string; boardId: string | null } | null | undefined): string | null {
  if (!last) return null;
  return last.boardId ? `/board?id=${encodeURIComponent(last.boardId)}` : `/project?id=${encodeURIComponent(last.projectId)}`;
}
