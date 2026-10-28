import crypto from 'node:crypto';
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { getPool } from '../../adapters/postgres.ts';
import {
  createSession,
  getSessionCookieOptions,
  isLocalhost,
} from '../../adapters/session.ts';
import { SESSION_COOKIE_NAME } from '../middleware/auth.ts';
import { HttpError } from '../errors.ts';

const OAUTH_STATE_COOKIE = 'flowboard_oauth_state';

export const googleAuthRoutes = new Hono();

interface GoogleTokens {
  access_token: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

function resolveRedirectUri(c: import('hono').Context): string {
  const envUri = (c.env as any)?.GOOGLE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI;
  if (envUri) return envUri;

  const url = new URL(c.req.url);
  // Default to relative callback route on same host
  return `${url.protocol}//${url.host}/api/v1/auth/google/callback`;
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
  // Strip surrounding quotes
  str = str.replace(/^["']|["']$/g, '').trim();
  return str;
}

function getGoogleConfig(c: import('hono').Context) {
  const rawId = (c.env as any)?.GOOGLE_CLIENT_ID || (typeof process !== 'undefined' ? process.env?.['GOOGLE_CLIENT_ID'] : undefined);
  const rawSecret = (c.env as any)?.GOOGLE_CLIENT_SECRET || (typeof process !== 'undefined' ? process.env?.['GOOGLE_CLIENT_SECRET'] : undefined);
  return {
    clientId: cleanCredential(rawId),
    clientSecret: cleanCredential(rawSecret),
  };
}

// 1. GET /api/v1/auth/google: Redirect user to Google OAuth consent
googleAuthRoutes.get('/google', (c) => {
  const { clientId } = getGoogleConfig(c);
  if (!clientId) {
    throw HttpError.internal('Google OAuth is not configured on this server. Missing GOOGLE_CLIENT_ID.');
  }

  const redirectUri = resolveRedirectUri(c);
  const state = crypto.randomBytes(24).toString('hex');
  const host = c.req.header('host') || new URL(c.req.url).hostname;
  const local = isLocalhost(host);

  setCookie(c, OAUTH_STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: !local,
    maxAge: 600, // 10 minutes
  });

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'online');
  authUrl.searchParams.set('prompt', 'select_account');

  return c.redirect(authUrl.toString(), 302);
});

// 2. GET /api/v1/auth/google/callback: Handle Google OAuth code callback
googleAuthRoutes.get('/google/callback', async (c) => {
  const query = c.req.query();
  if (query.error) {
    throw HttpError.badRequest(`Google sign-in was denied: ${query.error}`, 'OAUTH_ERROR');
  }

  const code = query.code;
  const state = query.state;
  if (!code || !state) {
    throw HttpError.badRequest('Missing authorization code or state parameter.', 'INVALID_CALLBACK');
  }

  const savedState = getCookie(c, OAUTH_STATE_COOKIE);
  if (!savedState || savedState !== state) {
    throw HttpError.forbidden('Invalid or expired OAuth state session.', 'CSRF_MISMATCH');
  }

  const host = c.req.header('host') || new URL(c.req.url).hostname;
  const local = isLocalhost(host);

  deleteCookie(c, OAUTH_STATE_COOKIE, {
    path: '/',
    secure: !local,
  });

  const { clientId, clientSecret } = getGoogleConfig(c);
  if (!clientId || !clientSecret) {
    throw HttpError.internal('Google OAuth client configuration incomplete.');
  }

  const redirectUri = resolveRedirectUri(c);

  // Exchange code for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text();
    console.error('Failed to exchange Google OAuth code:', errText);
    throw HttpError.badRequest('Failed to authenticate with Google identity provider.', 'TOKEN_EXCHANGE_FAILED');
  }

  const tokens = (await tokenResponse.json()) as GoogleTokens;

  // Retrieve user info
  const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userinfoResponse.ok) {
    throw HttpError.badRequest('Failed to fetch user profile from Google.', 'USERINFO_FAILED');
  }

  const profile = (await userinfoResponse.json()) as GoogleUserInfo;
  if (!profile.email) {
    throw HttpError.badRequest('Google account must have an associated email address.', 'EMAIL_REQUIRED');
  }

  if (profile.email_verified !== true) {
    throw HttpError.forbidden('Google account email is not verified.', 'EMAIL_NOT_VERIFIED');
  }

  const normalizedEmail = profile.email.trim().toLowerCase();
  const displayName = profile.name?.trim() || normalizedEmail.split('@')[0] || 'User';
  const avatarUrl = profile.picture || null;

  const pool = getPool(c);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userId = 'usr_' + crypto.randomUUID();

    // Upsert user
    const userRes = await client.query<{
      id: string;
      email: string;
      display_name: string;
      avatar_url: string | null;
    }>(
      `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (email)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
         updated_at = NOW()
       RETURNING id, email, display_name, avatar_url`,
      [userId, normalizedEmail, displayName, avatarUrl],
    );

    const user = userRes.rows[0]!;

    // Check if user owns at least one workspace; if not, create a personal workspace
    const wsCheck = await client.query<{ id: string }>(
      `SELECT id FROM workspaces WHERE owner_id = $1 LIMIT 1`,
      [user.id],
    );

    if (wsCheck.rows.length === 0) {
      const defaultWsId = 'ws_' + crypto.randomUUID();
      const wsName = `${user.display_name}'s Workspace`;
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ($1, $2, 'UTC', $3, 1, NOW(), NOW())`,
        [defaultWsId, wsName, user.id],
      );
    }

    // Create session
    const session = await createSession(user.id, 24 * 7, client);

    await client.query('COMMIT');

    // Set session cookie
    const cookieOpts = getSessionCookieOptions(host);
    setCookie(c, SESSION_COOKIE_NAME, session.id, {
      path: cookieOpts.path,
      httpOnly: cookieOpts.httpOnly,
      sameSite: cookieOpts.sameSite,
      secure: cookieOpts.secure,
      maxAge: cookieOpts.maxAge,
    });

    // Redirect to web application home
    const envObj = c.env as { FRONTEND_URL?: string } | undefined;
    const frontendUrl =
      envObj?.FRONTEND_URL ||
      (typeof process !== 'undefined' ? process.env?.['FRONTEND_URL'] : undefined);
    const redirectTarget = frontendUrl ? `${frontendUrl.replace(/\/$/, '')}/projects` : '/projects';
    return c.redirect(redirectTarget, 302);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});
