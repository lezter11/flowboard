# UAT test guide draft — deployment and acceptance not yet claimed

Prepared 3 November 2026 from the current source. Root must fill in the final reviewed commit, passing review paths, deployment IDs, migration ledger and actual hosted results before this becomes a release record. This document does not claim a UAT push or any hosted test passed.

## Before testing

Use only the UAT site, [flowboard-app-uat.pages.dev](https://flowboard-app-uat.pages.dev). Root must first confirm that it serves the reviewed candidate and that its Pages Function targets `flowboard-api-uat`, with the intended UAT database and private storage bindings. Production is excluded.

Create a clearly named synthetic test project and boards after signing in. Use your own controlled test accounts for Owner, Project Manager, Member and Viewer; have an unrelated second project/account available. Invitations send real email only when you deliberately choose a controlled recipient. Record IDs, statuses and expected results, never cookies, raw PATs, invitation links or email bodies. Do not export a raw network archive containing credentials.

A **role** determines what a person may do. A **board grant** determines which board a non-Owner may enter. Inviting a Member to a project must not silently grant its boards. The Owner separately grants a board; a Manager who creates a board receives access to that new board.

## Hosted acceptance checklist

These are test instructions, not completed boxes. The detailed [98-feature evidence map](evidence-map.json) retains each acceptance statement and its source/test navigation. A grouped scenario does not automatically close every associated feature.

| Test | What to do | Expected result / feature IDs |
|---|---|---|
| UAT-01 | Sign in through Google, refresh, sign out, then revisit a private card URL. Repeat login in the same account. | Real Google identity works; private reads require a current session; logout revokes it; no duplicate personal workspace. ACC-01/02/04. |
| UAT-02 | Try a crafted external `next` destination and an unsupported/failed callback. | No external redirect or session issuance from an invalid callback. ACC-01, FND-04. |
| UAT-03 | Create two projects, switch between owned and invited projects, and navigate with Back/Forward. | Only authorized projects appear; context stays explicit; unrelated private names/counts do not leak. ACC-06, PRJ-01/02, RBAC-01/02. |
| UAT-04 | Set workspace name/timezone as Owner. Try as Member. Put a due date near your current calendar day and view it as an invitee. | Owner change persists; Member denied; selected calendar date stays unchanged; My Tasks uses the workspace date/timezone. ACC-05, CRD-05, QRY-03. |
| UAT-05 | Invite each allowed role. As Manager attempt to invite/promote a Manager or modify the Owner/peer Manager. Open People as Member/Viewer and try its API directly. | Only permitted role changes succeed. Full People directory and emails are Owner/Manager only; authorized pickers still work. INV-01/06, PRJ-05, RBAC-04/05. |
| UAT-06 | Accept a matching invitation; try the link signed in as a different controlled email, then revoke/resend and retry the old link. Inspect visible delivery state after a configured provider failure. | Only matching verified identity accepts an active single-use invite; rotation/revocation invalidates the old link; failure is honest and retryable. INV-02/03/04/05. Provider/log privacy requires an operator check too. |
| UAT-07 | Create a board as Manager. Before and after an Owner grants a separate board, try its direct URL. Remove the grant while the Member has Projects, a card and an image lightbox open. | Creator gets only the new board; grants are separate; current server reads fail after revocation; previously shown private board/card/image content is cleared when loss is learned. INV-07/08, RBAC-03/05, BRD-01/02, ATT-04, UX-04. |
| UAT-08 | Add, rename and reorder columns through pointer and click/keyboard controls. Try duplicate names, final-column removal, an active-card column and a restorable-card column. | Atomic versioned updates; invalid or unsafe removal denied with clear errors; no silent card deletion/move. BRD-04/05/06, UX-02. |
| UAT-09 | Create cards using quick add and full form. Save fields, assign yourself, change due date/priority, close/reopen. After definite full-form success choose **Create another card** and create a second card. | Exactly two intended creations; fields persist; Save pending/dirty state resolves; failed/unknown results retain the original command and edits. CRD-01/02/03/04/05/06/11. |
| UAT-10 | Move within/across columns, use Move first/last/before/after, and undo. Change filters and use Move again. Open two tabs and attempt a stale edit/move. | Canonical order and counts; keyboard/click alternative works; Undo succeeds once or clearly conflicts; stale versions return 409 without partial changes. CRD-07/08/09/10/12, BRD-03/07. |
| UAT-11 | Type unsaved card/settings text, navigate Back/Forward, trigger a confirmation inside an invitation dialog and press Escape once. Lose access in another tab. | Drafts survive deliberate return; one Escape closes only the top dialog; focus returns correctly. After refusal, retain only own unsent edits/uncertain command, not untouched private snapshots. CRD-11, UX-01/02/04. |
| UAT-12 | Post, edit and delete comments. Mention another controlled Member using the picker, then type a literal at-name without selecting a mention. Page through comments. | Comment Save is independent of field Save; one post per logical command; only selected valid mentions notify; edits do not resend notifications; deletion hides bodies. COM-01–06, NTF-01/02. |
| UAT-13 | Upload PNG/JPEG/WebP, cancel a staged upload, reopen the card, preview and remove a saved image. Try SVG/HTML, MIME-spoofed and truncated images. Fetch the image anonymously. | Genuine supported bytes complete through real R2/Images; malformed/disallowed files fail safely; anonymous/private-grant failures reveal no bytes. ATT-01–05. Maximum dimensions/body/runtime budget must be checked on the deployed plan. |
| UAT-14 | Fill the downloaded seven-column Excel template. Leave Assignees blank on one row, set an unknown Status on another, and preserve External ID `0001`. Map the status explicitly, preview, confirm, retry the same import, open created links and download the report. | Blank Assignees does not swallow Status; invalid rows never silently guess; explicit mapping works; date-only/eligible assignees remain correct; no duplicates on retry; report is safe literal data. IMP-01–09/11. |
| UAT-15 | Cancel a preview; let a separate preview expire naturally; inspect a committed receipt after its temporary content is cleaned. | No cards from cancelled/expired preview; once committed show actual receipt; uploader/committer remain persisted facts, not the current reader. IMP-10/11. Scheduled cleanup is an operator check. |
| UAT-16 | As Owner/Manager trash and restore a card containing comments/images. Try editing the trashed card as Member. Inspect server cutoff fields. | Active counts/search immediately exclude it; same ID/content returns before cutoff; no writes to trashed data. Exact 24-hour boundary and purge races use controlled synthetic fixtures plus natural hosted observation, not a changed live clock. DEL-01–08, ATT-07. |
| UAT-17 | Archive/reopen board/project with current versions and repeat a stale request. Remove access/leave while archived; attempt ordinary edits/imports. | Content is read-only while archived; safe access removal remains possible; stale revisions conflict; trash deadlines continue. PRJ-04, BRD-08, INV-07/08. |
| UAT-18 | Open card/project/workspace activity with role changes, filters and pagination. Search and combine board filters. Page selected-project My Tasks with another project containing a sentinel assignment. | Correct historical actor/action/time; Owner-only workspace audit; no sibling content; stable pagination and accurate filtered counts; My Tasks stays inside the selected project. AUD-01–06, QRY-01–03. |
| UAT-19 | Test keyboard focus, nested dialogs, Move controls, narrow viewport/zoom, long titles and multiple assignees. Hide/focus the tab and reconnect after a dropped request. | Essential actions remain usable; focus is trapped/restored properly; hidden polling pauses; fresh state cannot overwrite retained edits or duplicate commands. UX-01–04. |
| UAT-20 | Operator checks configured Hyperdrive/database identity, private R2 policy, Images binding, safe errors/logs, email terminal outbox redaction, scheduled cleanup and representative first/warm performance. | Exact reviewed deployment is used; no secret/body/recipient retention after send; jobs retry safely; recorded hosted timings and resource limits, without treating local wall time as Free Worker CPU. FND-01–04, INV-02, ATT-06, DEL-06/07, NTF-03, UX-05. |

Use fresh explicit commands for a new intended action. A transport timeout means the result may already have committed: retry the same original command/key and payload, or inspect its receipt; do not create a new command merely because the response was lost.

## Connect the current MCP from Claude

Flowboard currently implements a **local stdio MCP server**: Claude launches a program on your Mac, and that program calls the UAT HTTPS API. There is no Flowboard remote HTTP MCP URL to add to a web connector. The five tools are list projects, list boards, get columns, search cards and create card. Current [package instructions](../../../packages/mcp/README.md) describe its contract; [source](../../../packages/mcp/src/index.ts) mounts the tools.

The desktop configuration below follows the official [MCP local-server guide](https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers). Claude Code also supports local stdio configuration; see its current [MCP reference](https://code.claude.com/docs/en/mcp). Host UI/CLI behavior can change; these instructions do not claim that an actual Claude session was tested.

1. Use Node 24.15 or newer within Node 24 and a clean checkout of the exact approved release. Root will supply that commit. From that checkout run:

   ```sh
   npm ci
   npm run build --workspace @flowboard/mcp
   npm test --workspace @flowboard/mcp
   npm run test:artifact --workspace @flowboard/mcp
   command -v node
   ```

   The executable is `packages/mcp/dist/index.js`. Keep this checkout/path available while Claude uses it.

2. Sign in to the UAT browser and create a finite, project-bound PAT through `POST /api/v1/tokens`. Current source has the API; do not assume a token-management UI exists. Use the trusted signed-in session and the API contract. Suggested test input:

   ```json
   {
     "name": "Claude UAT controlled test",
     "projectId": "REPLACE_WITH_TEST_PROJECT_ID",
     "expiresInDays": 1,
     "scopes": ["projects:read", "boards:read", "cards:read", "cards:create"]
   }
   ```

   A PAT is a secret credential. Its four allowed scopes above permit the tested discovery/create tools; it cannot administer sessions, invitations or other credentials. The raw value appears only at issuance. Put it directly in your protected local host configuration, never in this chat or Git. Record the safe token ID for revocation. Do not blindly repeat issuance after an unknown response; first inspect `GET /api/v1/tokens` in the signed-in session.

3. In Claude Desktop, open **Settings → Developer → Edit Config**. Merge this entry with existing `mcpServers`; replace the two absolute paths and placeholder locally. Use the actual absolute Node path from step 1 because GUI apps may not inherit your shell PATH. Quit and reopen Claude Desktop after saving. The config lives outside the repo; protect it as a credential file.

   ```json
   {
     "mcpServers": {
       "flowboard-uat": {
         "command": "/ABSOLUTE/PATH/TO/node",
         "args": ["/ABSOLUTE/PATH/TO/Flowboard/packages/mcp/dist/index.js"],
         "env": {
           "FLOWBOARD_API_URL": "https://flowboard-app-uat.pages.dev",
           "FLOWBOARD_API_TOKEN": "REPLACE_LOCALLY_WITH_YOUR_PAT"
         }
       }
     }
   }
   ```

   The API URL is the origin only, with no `/api/v1` suffix. Do not publish this JSON once a real token is inserted. For Claude Code, use its local stdio/server configuration with the same Node command, script argument and two environment variables; choose user/local scope, not a committed project secret.

4. In a new Claude chat confirm these five `flowboard_*` tools are available. First ask: “List one page of my Flowboard projects. Then list boards in test project `<ID>` and get columns for board `<ID>`. Do not create anything yet.” Compare IDs/names with the UAT UI. If a page has `nextCursor`, the listing is incomplete; request the next page with identical scope/limit.

5. Generate and save one UUID locally, together with the exact intended payload. Ask Claude to call `flowboard_create_card` once using that `operationId`, exact board ID and column ID, title `UAT MCP synthetic card`, priority `medium`, a plain description and an optional date-only `YYYY-MM-DD` deadline. Approve only this intended test write. Check the card in UAT and its activity; then search the title through `flowboard_search_cards` with the exact project ID.

6. Repeat the identical create tool input with the **same operationId and same PAT**. Expect the same card ID with `replayed: true` and only one card. Restart Claude/MCP and repeat to prove the ID survives host restarts. Change the title with the same operationId: expect `IDEMPOTENCY_CONFLICT`, without a second card. A fresh UUID represents a new intended create and can create another card.

7. With a controlled Member PAT, remove its board grant in the Owner browser, then repeat a permitted read/create/replay attempt. Expect refusal and no private payload or new card. A project-bound token must not read/write a second project. A metadata-only token must not retrieve full cards. Use only controlled test accounts/projects.

8. Revoke the test PAT through signed-in `DELETE /api/v1/tokens/<safe-token-id>`, then retry its MCP read. Expect unauthorized. Remove the local credential and restart the MCP process. Clean up synthetic cards using the normal authorized UI and 24-hour trash rules.

Seven-day receipts protect create retries only in their credential namespace. Do not rotate credentials while a create result is unknown; resolve with the original PAT/key first. After seven days the same key can create a new card. Fleet-company automatic compliance ingestion needs a separate durable external-issue mapping and installation identity; neither is implemented by these MCP tools.

## Record the result

For each scenario record the reviewed commit and actual deployment ID, tester role, synthetic resource IDs, steps, expected/observed status, pass/fail/not-covered, a sanitized screenshot if useful and a safe failure code. An empty checkbox or successful screenshot alone is not acceptance evidence. Root must preserve failures, repair/retest them and bind the final feature handoffs to actual results.
