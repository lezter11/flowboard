// Validates the ?next= return path used after Google sign-in.
//
// Why strict: a sign-in link that redirects to any URL is an open redirect (a phishing
// tool). We accept only a same-app path from a short allowlist, and drop everything else
// silently. The allowlist, the character sets and the length cap are all fixed here.

const MAX_NEXT_LENGTH = 300;

// Every entry is a route the web app serves. A path matches an entry exactly or as a parent
// of a deeper path (/board/abc matches /board, but /boardx does not).
const APP_ROUTES = [
  '/projects',
  '/project',
  '/board',
  '/activity',
  '/trash',
  '/people',
  '/inbox',
  '/my-tasks',
  '/settings',
  '/import',
  '/add-card',
  '/all-work',
  '/invitation',
  '/invitations/accept',
] as const;

// Path: a leading slash, then letters, digits, "_", "-" and "/". No dot (so no "/.." walks),
// no "%" (so no encoded bytes), no backslash, no colon, no whitespace.
const SAFE_PATH = /^\/[A-Za-z0-9_/-]*$/;
// Query: the only characters the app's own links use.
const SAFE_QUERY = /^[A-Za-z0-9_=&.-]*$/;
// Any ASCII control character, including CR and LF.
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/** Returns the input when it is a safe app path, otherwise null. Never throws, never echoes input. */
export function sanitizeNextPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return null;
  if (CONTROL_CHARS.test(raw) || raw.includes('\\')) return null;
  // "//host" is a scheme-relative URL that leaves the site.
  if (raw.startsWith('//')) return null;

  const queryAt = raw.indexOf('?');
  const path = queryAt === -1 ? raw : raw.slice(0, queryAt);
  const query = queryAt === -1 ? '' : raw.slice(queryAt + 1);

  if (!SAFE_PATH.test(path)) return null;
  if (!SAFE_QUERY.test(query)) return null;
  const allowed = APP_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
  return allowed ? raw : null;
}
