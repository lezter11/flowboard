import crypto from 'node:crypto';
import pg from 'pg';
import { createPersonalAccessToken } from '../apps/api/src/adapters/tokens.ts';
import { localDatabaseUrl } from '../apps/api/src/runtime/local-config.ts';
import { TOKEN_SCOPES, type TokenScope } from '@flowboard/contracts';

// CLI script to mint a scoped Personal Access Token for Flowboard
// Usage: node scripts/create_pat.ts --email user@example.com --name "Claude MCP Token" --scopes "cards:create,boards:read,projects:read"

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

async function main() {
  const email = getArg('--email');
  const name = getArg('--name') || 'Claude MCP Token';
  const rawScopes = getArg('--scopes') || 'cards:create,boards:read,projects:read';
  const projectId = getArg('--project');
  const days = getArg('--days') ? Number(getArg('--days')) : 30;

  if (!email) {
    console.error('Error: --email <user_email> is required.');
    console.error('Example: node scripts/create_pat.ts --email owner@flowboard.test --name "Claude Desktop" --scopes cards:create,boards:read,projects:read');
    process.exit(1);
  }

  const requestedScopes = rawScopes.split(',').map((s) => s.trim()) as TokenScope[];
  for (const s of requestedScopes) {
    if (!TOKEN_SCOPES.includes(s)) {
      console.error(`Error: Invalid scope "${s}". Allowed scopes: ${TOKEN_SCOPES.join(', ')}`);
      process.exit(1);
    }
  }

  // This administrative CLI is local-only. Hosted users issue credentials through their signed-in session.
  const dbUrl = localDatabaseUrl(process.env['DATABASE_URL']);
  const target = new URL(dbUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
      || target.pathname !== '/flowboard_harness' || target.username !== 'flowboard_harness' || target.search) {
    throw new Error('This credential-minting CLI is limited to the disposable local harness.');
  }
  const pool = new pg.Pool({ connectionString: dbUrl });

  try {
    const userRes = await pool.query<{ id: string; email: string; display_name: string }>(
      'SELECT id, email, display_name FROM users WHERE email = $1',
      [email.toLowerCase().trim()],
    );

    if (userRes.rows.length === 0) {
      console.error(`Error: User with email "${email}" not found.`);
      process.exit(1);
    }

    const user = userRes.rows[0]!;

    // The same adapter as POST /tokens checks actual Owner inheritance/current membership and the cap.
    const result = await createPersonalAccessToken(pool, {
      userId: user.id,
      name,
      scopes: requestedScopes,
      projectId,
      expiresInDays: days,
    });

    console.log('\n======================================================');
    console.log('  FLOWBOARD PERSONAL ACCESS TOKEN GENERATED');
    console.log('======================================================');
    console.log(`User:         ${user.display_name} (${user.email})`);
    console.log(`Token ID:     ${result.tokenDetails.id}`);
    console.log(`Name:         ${result.tokenDetails.name}`);
    console.log(`Scopes:       ${result.tokenDetails.scopes.join(', ')}`);
    console.log(`Project:      ${result.tokenDetails.projectId || '(All accessible projects)'}`);
    console.log(`Expires At:   ${result.tokenDetails.expiresAt || 'Never'}`);
    console.log('------------------------------------------------------');
    console.log('RAW TOKEN (save now - will NOT be displayed again):');
    console.log(`\n  ${result.token}\n`);
    console.log('======================================================\n');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Token creation failed. Check local account/project access, input and active-token limit.',
    typeof err?.code === 'string' ? err.code : 'INVALID_INPUT');
  process.exit(1);
});
