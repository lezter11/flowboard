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
  const days = getArg('--days') ? parseInt(getArg('--days')!, 10) : 90;

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

  const dbUrl = process.env['DATABASE_URL'] || localDatabaseUrl();
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

    if (projectId) {
      const projRes = await pool.query<{ id: string }>(
        'SELECT id FROM projects WHERE id = $1',
        [projectId],
      );
      if (projRes.rows.length === 0) {
        console.error(`Error: Project "${projectId}" not found.`);
        process.exit(1);
      }
    }

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
  console.error('Fatal error:', err);
  process.exit(1);
});
