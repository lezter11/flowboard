# Claude Desktop MCP test guide — after UAT promotion

Deployment is currently held by the full-product closure gate. These steps are prepared for the reviewed build after it reaches UAT; they are not a claim that UAT already runs it.

This Flowboard package is a local stdio server: Claude Desktop starts a Node process on your Mac, and that process calls the Flowboard HTTPS API. It is not a remote MCP URL for Claude's web connector screen. Official local-server setup: https://modelcontextprotocol.io/docs/develop/connect-local-servers and https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop .

1. Build the reviewed package using Node24.15–24.x:

   ```sh
   cd /Users/shubham/.codex/worktrees/mcp-uat-repair/Flowboard
   npm run build --workspace @flowboard/mcp
   command -v node
   ```

2. Sign in to UAT as an Owner. Create a synthetic test project and board. Obtain that exact project ID. Credential management has an API but no screen in this repair: POST `/api/v1/tokens` through your authenticated same-origin browser session, with this body:

   ```json
   {
     "name": "Claude UAT test",
     "projectId": "REPLACE_WITH_TEST_PROJECT_ID",
     "scopes": ["projects:read", "boards:read", "cards:read", "cards:create"],
     "expiresInDays": 30
   }
   ```

   Save the once-returned bearer directly into your protected local host configuration. Do not paste it into chat, Git, screenshots or recorded request headers. Do not use the local database PAT CLI for UAT. No real credential is included in this guide.

3. Open Claude Desktop's local-server configuration (`claude_desktop_config.json`; on macOS normally under `~/Library/Application Support/Claude/`). Depending on app version, local servers are under Settings → Developer or the local MCP/Extensions settings. Merge this entry into existing `mcpServers`; preserve your other servers. Replace the Node path with the absolute result from step1, and the bearer placeholder with your locally saved value:

   ```json
   {
     "mcpServers": {
       "flowboard-uat": {
         "command": "/ABSOLUTE/PATH/TO/node",
         "args": ["/Users/shubham/.codex/worktrees/mcp-uat-repair/Flowboard/packages/mcp/dist/index.js"],
         "env": {
           "FLOWBOARD_API_URL": "https://flowboard-app-uat.pages.dev",
           "FLOWBOARD_API_TOKEN": "REPLACE_LOCALLY_WITH_YOUR_PAT"
         }
       }
     }
   }
   ```

4. Fully quit and reopen Claude Desktop. Confirm the Flowboard server connects and exposes five tools: list projects, list boards, get board columns, search cards and create card. If startup fails, check the absolute Node path/version and compiled file first; then inspect local MCP logs without sharing bearer values.

5. In a new Claude chat, ask: “Use Flowboard tools to list my permitted projects, then the boards and column IDs in my test project. Do not create anything yet.” The project-bound credential should show only its permitted project and current granted boards.

6. Generate one UUID locally (`uuidgen`) and retain it. Ask: “Create one card titled MCP UAT smoke test in board ID [ID], column ID [ID], priority medium. Use operationId [UUID]. Do not generate a replacement operation ID on retry.” Confirm exactly one card appears in Flowboard. Repeat the same operation ID and exact input: it must replay the same card ID, with one creation event. Changing the title while retaining the operation ID must conflict. Search for the unique title and confirm unrelated cards are excluded.

7. Confirm negative cases: the token cannot access another project, full board snapshots, profile/session operations or credential administration. Owner revokes the credential using session-authenticated DELETE `/api/v1/tokens/:tokenId`; subsequent tool calls must fail401. Keep only synthetic card IDs, result/status, timestamp and deployed source/version in evidence.

An operation ID is a retry receipt number: repeating one intended operation reuses its receipt instead of making another card. Protection lasts seven days within the same credential. It does not deduplicate daily fleet alerts forever or survive credential rotation; that needs the future external-issue/installation API.
