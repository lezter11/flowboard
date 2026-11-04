import type { HostedMcpAuthorizationView } from '@flowboard/contracts';

/** Only the short-lived handle may travel through the Flowboard consent URL. */
export function authorizationRequestId(search: string): string | null {
  return /^\?request=([A-Za-z0-9_-]{43})$/.exec(search)?.[1] ?? null;
}

export function connectReturnPath(raw: unknown): string | null {
  return typeof raw === 'string' && /^\/connect\?request=[A-Za-z0-9_-]{43}$/.test(raw) ? raw : null;
}

/** Defence in depth: navigate only to the backend's one supported callback, never query input. */
export function safeHostedMcpRedirect(raw: unknown, issuer: string): string | null {
  if (typeof raw !== 'string' || raw.length > 8192 || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.origin !== 'https://claude.ai' || url.pathname !== '/api/mcp/auth_callback'
    || url.username || url.password || url.port || url.hash) return null;
  const allowed = new Set(['code', 'error', 'state', 'iss']);
  for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) return null;
  if (url.searchParams.get('iss') !== issuer) return null;
  const code = url.searchParams.get('code');
  const denied = url.searchParams.get('error');
  if (url.searchParams.has('code') === url.searchParams.has('error')) return null;
  if (code !== null ? !/^[A-Za-z0-9_-]{43}$/.test(code) : denied !== 'access_denied') return null;
  return raw;
}

/** Every page rotates CSRF, so replace all canonical metadata while merging choices. */
export function mergeAuthorizationPage(current: HostedMcpAuthorizationView, incoming: HostedMcpAuthorizationView): HostedMcpAuthorizationView {
  if (current.requestId !== incoming.requestId || JSON.stringify(current.scopes) !== JSON.stringify(incoming.scopes)
    || current.offlineAccess !== incoming.offlineAccess) throw new Error('Connection request changed.');
  const projects = new Map(current.projects.map(project => [project.id, project]));
  for (const project of incoming.projects) projects.set(project.id, project);
  return { ...incoming, projects: [...projects.values()] };
}

export const CONNECTION_PERMISSIONS = {
  'projects:read': 'Read this project’s name',
  'boards:read': 'Read names and columns of boards you can open',
  'cards:read': 'Search and read cards you can open',
  'cards:create': 'Create cards where your role allows',
} as const;
