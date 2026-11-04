# Claude + Flowboard: quick setup on this Mac

This is the current local UAT setup, not a nontechnical-user installer or proof of a completed Claude connection. The helper only changes your local Claude configuration when you run it. It does not deploy code or change API authorization.

## 1. Quit Claude Desktop; build once in Terminal

Fully quit Claude Desktop first so it cannot overwrite configuration during setup. Keep Chrome open for the next step.

```sh
cd /Users/shubham/.codex/worktrees/mcp-uat-repair/Flowboard
npm run build --workspace @flowboard/mcp
```

## 2. Sign in and copy a project-scoped token

In Chrome open [Flowboard UAT](https://flowboard-app-uat.pages.dev), sign in, click Projects and open your project. Its URL should contain `/project?id=...`.

Open Chrome Developer Tools → Console. Run this reviewed snippet. It issues a credential through your signed-in session and copies it locally; it does not print the credential.

```js
(async () => {
  const projectId = new URL(location.href).searchParams.get('id');
  if (location.origin !== 'https://flowboard-app-uat.pages.dev' ||
      !/^\/project\/?$/.test(location.pathname) || !projectId)
    throw new Error('Open your project overview in Flowboard UAT first.');
  const response = await fetch('/api/v1/tokens', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Claude UAT', projectId, expiresInDays: 30,
      scopes: ['projects:read', 'boards:read', 'cards:read', 'cards:create'] })
  });
  if (!response.ok) throw new Error(`Token creation failed: HTTP ${response.status}`);
  const { data } = await response.json();
  copy(data.token);
  console.info('Token copied. Run the Terminal setup command next. Token ID:', data.tokenDetails.id);
})();
```

Do not copy anything else before the next command. Keep the credential out of chat, screenshots and Git. The displayed token ID is nonsecret and can identify it for later revocation. Repeatedly running this step creates additional tokens; it is not a retry-safe credential-issuance command.

## 3. Install the local Claude entry

```sh
python3 /Users/shubham/.codex/worktrees/mcp-uat-repair/Flowboard/outputs/mcp-setup/setup_claude.py
```

Run the saved file, not Python pasted through stdin. It reads the copied token, merges only `flowboard-uat`, preserves other settings, privately backs up an existing config, writes mode0600, and clears the token clipboard if unchanged. No secret is printed. It prints a nonsecret UUID you can save for a demo create/retry. It needs existing Node24.15+ within Node24 and macOS; it is specific to this retained checkout.

## 4. Reopen Claude Desktop and test

Ask: “Use Flowboard to list my projects and boards. Ask me which board and column to use before creating anything.”

Then ask it to create a synthetic card in your chosen destination, using the saved UUID as `operationId`. Repeating identical input with that credential/UUID should return the same card. Verify the card in the UAT board. The Mac must stay awake while using this local server; the hosted app stays online independently.

Current tools discover projects/boards/columns, search and create cards. Existing-card MCP updates are not implemented. For refusal/revocation/retry tests use [the full UAT guide](UAT_TESTING.md).

## Simpler colleague setup: proposed, not implemented

Recommended: host a remote MCP server with browser sign-in/consent. A colleague would add the connector URL in Claude, sign in to Flowboard, select permitted project/board access and approve. No repository, Terminal, Node, JSON editing or manually copied token. Existing API project/board permissions still apply to every request.

A smaller alternative is a packaged `.mcpb` Desktop extension plus a Flowboard token-management screen. Installation is simpler but remains tied to the desktop and manual credential management. Remote sign-in fits this cloud product better; browser sign-in tokens for humans remain separate from the company's planned machine-to-machine client-credentials flow.

References checked2026-11-04: [Claude remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [Claude local-server/extension help](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop), [MCP local setup](https://modelcontextprotocol.io/docs/develop/connect-local-servers). The local helper's five offline synthetic checks and independent atomic-failure review do not establish a real Claude connection; see [helper review](../outputs/mcp-setup/REVIEW.md).
