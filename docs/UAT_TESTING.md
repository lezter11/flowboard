# Flowboard UAT testing

Current application candidate: `d1c81f42fe306c352c9cb10f04883e251ead58bd`. Linux CI run [41777804549](https://github.com/lezter11/flowboard/actions/runs/41777804549) passed all required commands. All98 Backend,74 required UI and98 local integration approvals apply to the current functional source. **Hosted acceptance must be recorded separately.** Deployment status and exact IDs: [release checkpoint](reviews/FULL-REVALIDATION-20261104/RELEASE-STATUS.json). Until that checkpoint confirms both uploads and smoke checks, this is a prepared test guide.

## Quick product test after deployment

Open [Flowboard UAT](https://flowboard-app-uat.pages.dev), refresh the page, and use synthetic demo data:

1. Sign in with Google. Open or create a disposable project and board; confirm you selected the intended project/board.
2. Create a card, assign it to yourself, change priority/due date, save, close and reopen it. Verify saved values and the saved-state message.
3. Move the card using drag/drop and the Move control; exercise Undo. Add a comment, mention a permitted teammate and verify their notification with that test actor.
4. Upload a reference image, open it and remove it. Use another test role to check private-image/board access; never use real private images for a demo.
5. Download the XLSX template, add synthetic rows, preview and commit once. Confirm exact text/assignees and absence of duplicate cards on the intended board. Test a maximum-length workbook separately; local CI is not a hosted resource benchmark.
6. Delete and restore the card. Verify activity history and role restrictions. A true24-hour expiration/durability check remains pending until observed; an injected local clock is separate evidence.

Use Owner/Project Manager for administration; Members/Viewers must not see the full People directory. A non-Owner needs project membership plus an explicit board grant. Owner inheritance is not a useful actor for testing grant removal.

## MCP from Claude Desktop

For first-time setup on this Mac, use the shorter [four-step quickstart](MCP_QUICKSTART.md). The longer checklist below covers acceptance and failure cases after connection.

This is a **local stdio MCP server**, not a remote connector URL. Claude starts Node on your Mac, and that process calls the hosted API. Your laptop must be awake while using this local integration; closing it after deployment does not stop the hosted app.

1. Follow the [complete credential/configuration guide](reviews/FULL-REVALIDATION-20261103/MCP-UAT-TESTING.md). Its old deployment-pending heading is historical; use the current checkpoint above for deployment status. Use active `packages/mcp`, not archived worktrees.
2. Build the local package from the active checkout with `npm run build --workspace @flowboard/mcp`. The server entry is `/Users/shubham/.codex/worktrees/mcp-uat-repair/Flowboard/packages/mcp/dist/index.js`. Configure an absolute Node executable path.
3. Sign in to UAT and issue a project-bound, finite-expiry personal access token via session-authenticated `POST /api/v1/tokens`. There is currently no token-management UI screen. Use scopes `projects:read`, `boards:read`, `cards:read`, `cards:create`; retain the nonsecret token ID for revocation. Keep the bearer only in protected local configuration, never chat/Git/screenshots. Exact request shape is in the complete guide.
4. Merge the server into local `mcpServers` configuration with API origin `https://flowboard-app-uat.pages.dev`; preserve other servers. Fully quit and reopen Claude Desktop. Check the five tools are connected. Manual local configuration is documented by the [MCP project](https://modelcontextprotocol.io/docs/develop/connect-local-servers); server status/log locations are described by [Claude Help](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop). Checked2026-11-04. This package is not a Desktop extension.
5. First ask: “List my permitted projects, boards and columns. Show their exact IDs and ask me which destination to use. Do not create a card yet.”
6. Generate and save one UUID using `uuidgen`. Then ask: “Create one synthetic card titled MCP demo [unique suffix] in boardId [exactID], column [exactcolumnID], priority medium, operationId [savedUUID]. Preserve this ID and input if the outcome is unknown.” Verify the returned card ID and details in the UAT board.
7. Repeat identical input with the same credential/operationID: expect the same card ID, not another card. Change the title with the same ID: expect `IDEMPOTENCY_CONFLICT`. Resolve uncertain creates before credential rotation; receipts last seven days within one credential namespace.
8. Verify wrong-project, missing-scope, removed board/project grant and revoked-token denial using disposable non-Owner actors. Use the complete guide for the full refusal/rotation matrix.

Current tools discover projects, boards and columns, search cards and create cards. Existing-card MCP updates, remote HTTP MCP and company client-credentials installations are future scope. A fleet company’s permanent compliance-incident deduplication needs a durable external-issue API, not seven-day retry receipts.

## Record actual acceptance

For each case record pass/fail/not-run, deployment IDs, timestamp, synthetic role/resource IDs, expected and actual result, and sanitized evidence. Do not record tokens/cookies/private payloads. Anonymous smoke checks do not establish Google sign-in, mail delivery, R2 durability, real schedules or Claude-hosted acceptance. The remaining task IDs are HOST-01–03 in [flowBoardTasks.md](../flowBoardTasks.md).
