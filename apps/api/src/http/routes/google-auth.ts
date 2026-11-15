import crypto from 'node:crypto';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { normalizeNamePart, sessionActorSchema } from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import { getSessionCookieOptions, hashSessionToken, isLocalhost } from '../../adapters/session.ts';
import { GOOGLE_ISSUER, signInWithGoogle, type VerifiedGoogleProfile } from '../../adapters/google-identity.ts';
import { authMiddleware, SESSION_COOKIE_NAME } from '../middleware/auth.ts';
import { HttpError } from '../errors.ts';
import { sanitizeNextPath } from '../safe-next.ts';

const OAUTH_TTL_SECONDS = 600;
const ACCOUNT_SETTINGS = '/settings?tab=account';
const STATE = /^[0-9a-f]{48}$/;
const BASE64URL_256 = /^[A-Za-z0-9_-]{43}$/;

export const googleAuthRoutes = new Hono();

function resolveRedirectUri(c: Context): string {
  const envUri = (c.env as { GOOGLE_REDIRECT_URI?: string } | undefined)?.GOOGLE_REDIRECT_URI ||
    process.env['GOOGLE_REDIRECT_URI'];
  return envUri || new URL('/api/v1/auth/google/callback', c.req.url).href;
}

function cleanCredential(val?: string): string {
  if (!val) return '';
  let str = val.trim();
  // Strip markdown link artifacts e.g. "xxx.apps.googleusercontent.com](http://..."
  if (str.includes(']')) {
    str = str.split(']')[0]!.trim();
  }
  if (str.includes('(')) {
    str = str.split('(')[0]!.trim();
  }
  return str.replace(/^["']|["']$/g, '').trim();
}

function getGoogleConfig(c: Context) {
  const env = c.env as { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string } | undefined;
  return {
    clientId: cleanCredential(env?.GOOGLE_CLIENT_ID || process.env['GOOGLE_CLIENT_ID']),
    clientSecret: cleanCredential(env?.GOOGLE_CLIENT_SECRET || process.env['GOOGLE_CLIENT_SECRET']),
  };
}

function browserSession(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE_NAME) || getCookie(c, 'session');
}

function secureCookie(c: Context): boolean {
  return !isLocalhost(new URL(c.req.url).hostname);
}

function flowCookie(c: Context, link: boolean): string {
  const name = link ? 'flowboard_oauth_link' : 'flowboard_oauth_state';
  // The browser rejects __Host- cookies planted by a sibling subdomain.
  return secureCookie(c) ? `__Host-${name}` : name;
}

interface OAuthAttempt {
  state: string;
  verifier: string;
  expiresAt: number;
}

function linkProof(session: string, attempt: OAuthAttempt): string {
  return crypto.createHmac('sha256', session)
    .update(`google-link:${attempt.state}.${attempt.verifier}.${attempt.expiresAt}`)
    .digest('base64url');
}

function beginGoogleOAuth(c: Context, sessionToLink?: string): URL {
  const { clientId } = getGoogleConfig(c);
  if (!clientId) throw HttpError.internal('Google OAuth is not configured on this server. Missing GOOGLE_CLIENT_ID.');

  const attempt = {
    state: crypto.randomBytes(24).toString('hex'),
    verifier: crypto.randomBytes(32).toString('base64url'),
    expiresAt: Math.floor(Date.now() / 1000) + OAUTH_TTL_SECONDS,
  };
  const next = sanitizeNextPath(c.req.query('next'));
  const context = sessionToLink ? linkProof(sessionToLink, attempt) : Buffer.from(next ?? '').toString('base64url');
  setCookie(c, flowCookie(c, sessionToLink !== undefined),
    `${attempt.state}.${attempt.verifier}.${attempt.expiresAt}.${context}`, {
      path: '/', httpOnly: true, sameSite: 'Lax', secure: secureCookie(c), maxAge: OAUTH_TTL_SECONDS,
    });

  const url = new URL('/o/oauth2/v2/auth', GOOGLE_ISSUER);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', resolveRedirectUri(c));
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', attempt.state);
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', sessionToLink ? 'select_account consent' : 'select_account');
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', crypto.createHash('sha256').update(attempt.verifier).digest('base64url'));
  return url;
}

const startGoogleSignIn = (c: Context) => c.redirect(beginGoogleOAuth(c).href, 302);
googleAuthRoutes.get('/google', startGoogleSignIn);
googleAuthRoutes.get('/google/start', startGoogleSignIn);

googleAuthRoutes.post('/google/link', authMiddleware, (c) => {
  // Required even for clients without Fetch Metadata. The configured callback origin is
  // what the browser sees, including when a local reverse proxy rewrites Request.url.
  if (c.req.header('origin') !== new URL(resolveRedirectUri(c)).origin) {
    throw HttpError.forbidden('Start Google linking from your Flowboard account settings.');
  }
  const session = browserSession(c);
  if (!session || c.get('authType') !== 'session') throw HttpError.unauthorized();
  // The UI navigates after reading the URL, so the existing form-action CSP can stay same-origin.
  return c.json({ data: { authorizationUrl: beginGoogleOAuth(c, session).href } });
});

function readAttempt(c: Context, link: boolean) {
  const [state, verifier, rawExpiry, context, extra] = (getCookie(c, flowCookie(c, link)) ?? '').split('.');
  if (!state || !STATE.test(state) || state !== c.req.query('state') || !verifier || !BASE64URL_256.test(verifier) ||
      !rawExpiry || !/^\d{1,12}$/.test(rawExpiry) || context === undefined || extra !== undefined) return null;
  const expiresAt = Number(rawExpiry);
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt <= now || expiresAt > now + OAUTH_TTL_SECONDS) return null;
  return { state, verifier, expiresAt, context };
}

type CallbackStage = 'browser-session' | 'token-exchange' | 'userinfo-request' | 'profile-validation' |
  'database-connection' | 'database-transaction' | 'session-response';

interface CallbackDiagnostic {
  stage: CallbackStage;
}

async function verifiedGoogleProfile(c: Context, code: string, verifier: string, diagnostic: CallbackDiagnostic): Promise<VerifiedGoogleProfile> {
  diagnostic.stage = 'token-exchange';
  const { clientId, clientSecret } = getGoogleConfig(c);
  if (!clientId || !clientSecret) throw HttpError.internal('Google OAuth client configuration incomplete.');

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    // Workers support manual redirects. The !ok check below rejects every 3xx
    // before the code, the client secret, or any returned credentials can be forwarded.
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: resolveRedirectUri(c),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) {
    // Never read or log a provider error body.
    await tokenResponse.body?.cancel();
    console.error(JSON.stringify({ event: 'google_token_exchange_failed', status: tokenResponse.status }));
    throw HttpError.badRequest('Failed to authenticate with Google identity provider.', 'TOKEN_EXCHANGE_FAILED');
  }

  const tokens = await tokenResponse.json() as { access_token?: unknown };
  if (typeof tokens?.access_token !== 'string' || !/^[!-~]{1,8192}$/.test(tokens.access_token)) {
    throw HttpError.badRequest('Invalid Google token response.', 'TOKEN_EXCHANGE_FAILED');
  }
  // Only this fixed Google TLS endpoint, authorized by the code exchange above, supplies the subject.
  diagnostic.stage = 'userinfo-request';
  const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    redirect: 'manual',
  });
  if (!userinfoResponse.ok) {
    await userinfoResponse.body?.cancel();
    throw HttpError.badRequest('Failed to fetch user profile from Google.', 'USERINFO_FAILED');
  }

  diagnostic.stage = 'profile-validation';
  const profile = await userinfoResponse.json() as Record<string, unknown> | null;
  const email = typeof profile?.['email'] === 'string' ? profile['email'].trim().toLowerCase() : '';
  if (email.length > 254 || !sessionActorSchema.shape.email.safeParse(email).success) {
    throw HttpError.badRequest('Google account must have an associated email address.', 'EMAIL_REQUIRED');
  }
  if (profile?.['email_verified'] !== true) {
    throw HttpError.forbidden('Google account email is not verified.', 'EMAIL_NOT_VERIFIED');
  }
  const subject = profile['sub'];
  if (typeof subject !== 'string' || !/^[!-~]{1,255}$/.test(subject)) {
    throw HttpError.forbidden('Google account identity is missing or invalid.', 'GOOGLE_SUBJECT_INVALID');
  }
  const name = typeof profile['name'] === 'string' ? profile['name'].trim().slice(0, 121) : '';
  const picture = sessionActorSchema.shape.avatarUrl.safeParse(profile['picture']);
  return {
    subject, email,
    displayName: name || email.split('@')[0]!.slice(0, 121),
    avatarUrl: picture.success ? picture.data : null,
    firstName: normalizeNamePart(typeof profile['given_name'] === 'string' ? profile['given_name'] : ''),
    lastName: normalizeNamePart(typeof profile['family_name'] === 'string' ? profile['family_name'] : ''),
  };
}

async function completeGoogleSignIn(c: Context, code: string, verifier: string, linkingSessionHash: string | null, landing: string, diagnostic: CallbackDiagnostic) {
  const profile = await verifiedGoogleProfile(c, code, verifier, diagnostic);
  diagnostic.stage = 'database-connection';
  const pool = getPool(c);
  const client = await pool.connect();

  try {
    diagnostic.stage = 'database-transaction';
    await client.query('BEGIN');
    const session = await signInWithGoogle(client, profile, linkingSessionHash);
    await client.query('COMMIT');

    diagnostic.stage = 'session-response';
    setCookie(c, SESSION_COOKIE_NAME, session.id, getSessionCookieOptions(new URL(c.req.url).hostname));
    return c.redirect(`${frontendOrigin(c)}${landing}`, 302);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const SIGNIN_STATE_BY_CODE: Record<string, string> = {
  OAUTH_ERROR: 'denied',
  CSRF_MISMATCH: 'expired',
  EMAIL_NOT_VERIFIED: 'email_unverified',
  EMAIL_REQUIRED: 'email_missing',
  GOOGLE_RECOVERY_REQUIRED: 'google_recovery',
};

function frontendOrigin(c: Context): string {
  const env = c.env as { FRONTEND_URL?: string } | undefined;
  return (env?.FRONTEND_URL || process.env['FRONTEND_URL'] || '').replace(/\/$/, '');
}

googleAuthRoutes.get('/google/callback', async (c) => {
  const link = readAttempt(c, true);
  const signIn = readAttempt(c, false);
  const attempt = link ?? signIn;
  const consentNext = signIn && /^[A-Za-z0-9_-]{1,400}$/.test(signIn.context)
    ? sanitizeNextPath(Buffer.from(signIn.context, 'base64url').toString('utf8'))
    : null;
  // Clear only the matching flow, so a malformed callback cannot cancel a different pending attempt.
  if (attempt) deleteCookie(c, flowCookie(c, link !== null), { path: '/', secure: secureCookie(c) });

  const diagnostic: CallbackDiagnostic = { stage: 'browser-session' };
  try {
    if (c.req.query('error')) throw HttpError.badRequest('Google sign-in was denied.', 'OAUTH_ERROR');
    const code = c.req.query('code');
    if (!code || !c.req.query('state')) throw HttpError.badRequest('Missing authorization code or state.', 'INVALID_CALLBACK');
    if (!attempt) throw HttpError.forbidden('Invalid or expired OAuth state session.', 'CSRF_MISMATCH');

    let sessionHash: string | null = null;
    if (link) {
      const token = browserSession(c);
      if (!token || !BASE64URL_256.test(link.context) ||
          !crypto.timingSafeEqual(Buffer.from(link.context), Buffer.from(linkProof(token, link)))) {
        throw HttpError.forbidden('Invalid or expired OAuth state session.', 'CSRF_MISMATCH');
      }
      sessionHash = hashSessionToken(token);
    }
    const landing = link ? `${ACCOUNT_SETTINGS}&google=linked` : (consentNext ?? '/projects');
    return await completeGoogleSignIn(c, code, attempt.verifier, sessionHash, landing, diagnostic);
  } catch (err) {
    const codeText = err instanceof HttpError ? err.code : 'UNEXPECTED';
    const dbError = err as { code?: unknown; severity?: unknown } | null;
    const database = diagnostic.stage === 'database-connection' || diagnostic.stage === 'database-transaction';
    const sqlState = database && typeof dbError?.severity === 'string' && typeof dbError.code === 'string' &&
      /^[0-9A-Z]{5}$/.test(dbError.code) ? dbError.code : undefined;
    const category = err instanceof TypeError ? 'type' : err instanceof SyntaxError ? 'syntax' :
      err instanceof RangeError ? 'range' : err instanceof HttpError ? 'http' : 'other';
    console.error(JSON.stringify({ event: 'google_callback_failed', code: codeText, stage: diagnostic.stage, category, sqlState }));
    if (link) return c.redirect(`${frontendOrigin(c)}${ACCOUNT_SETTINGS}&google=failed`, 302);

    const state = SIGNIN_STATE_BY_CODE[codeText] ?? 'failed';
    const resume = consentNext && /^\/connect\?request=[A-Za-z0-9_-]{43}$/.test(consentNext)
      ? `&next=${encodeURIComponent(consentNext)}` : '';
    return c.redirect(`${frontendOrigin(c)}/signin?state=${state}${resume}`, 302);
  }
});
