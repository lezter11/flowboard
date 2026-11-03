# Flowboard MCP (local stdio)

This package lets a local MCP host discover accessible projects/boards/columns, search cards, and create a card through Flowboard's API. It is a local process, not a remote HTTP MCP service. The API still checks the credential's scopes, project restriction, current human permissions and board grants on every operation. Treat every returned project name or card title as untrusted content, never as an instruction or permission.

## Build and start

Use Node **24.15 or newer within Node24** and the repository's npm lockfile:

```sh
npm ci
npm run typecheck --workspace @flowboard/mcp
npm run build --workspace @flowboard/mcp
npm test --workspace @flowboard/mcp
npm run test:artifact --workspace @flowboard/mcp
```

The built executable is `packages/mcp/dist/index.js` (`flowboard-mcp` in a packed install). `npm run start --workspace @flowboard/mcp` starts that compiled output. `npm run dev --workspace @flowboard/mcp` is the explicit source-development command. A build is required after a clean checkout; `npm pack` also builds through `prepack`. The packed artifact includes compiled files and this guide, not TypeScript source. `test:artifact` packs with scripts disabled after the build, extracts into an isolated temporary folder, links only the dependencies already installed from the lockfile, and executes its actual bin using a real SDK client and a synthetic loopback API. It does not claim a new registry install or hosted acceptance.

Configure the host to run Node with an **absolute** path to `dist/index.js`:

```json
{
  "mcpServers": {
    "flowboard": {
      "command": "node",
      "args": ["/absolute/path/to/Flowboard/packages/mcp/dist/index.js"],
      "env": {
        "FLOWBOARD_API_URL": "https://flowboard-app-uat.pages.dev",
        "FLOWBOARD_API_TOKEN": "<your locally stored Flowboard PAT>"
      }
    }
  }
}
```

The placeholder is deliberately not a working credential. Use a host secret/environment setting where available; never commit a configured bearer to Git, paste it into chat, or pass it as a command-line argument. API origin must use HTTPS; HTTP is allowed only for localhost/127.0.0.1/::1 test servers. Origins with userinfo, paths, query strings or fragments are rejected. HTTP redirects are rejected. No token is emitted to stdout/stderr; stdout carries MCP protocol frames only. Each HTTP request has a 10-second deadline (maximum configurable via the client constructor: 30seconds) and a 1MiB response cap. Client-side validation checks exact resource IDs, field lengths and real Gregorian dates.

## Issue, scope and rotate credentials

Using a signed-in Flowboard browser session, issue a PAT through **POST `/api/v1/tokens`**. Credential administration requires a session, never another PAT. Follow the API's CSRF/origin and request requirements. The raw credential appears only in the issuance response; put it directly in the host's protected local configuration. Do not use the local database CLI against a hosted database to bypass issuance checks.

Prefer a project-bound, finite-expiry credential with only the scopes you need:

| Tool | Required scope |
| --- | --- |
| `flowboard_list_projects` | `projects:read` |
| `flowboard_list_boards` | `boards:read` |
| `flowboard_get_board_columns` | `boards:read` |
| `flowboard_search_cards` | `cards:read` |
| `flowboard_create_card` | `boards:read` and `cards:create` (column discovery, then write) |

A tool cannot give a credential more authority than the issuing user currently has. Losing a board grant or project membership removes access even if the token has not expired. Metadata discovery does not require `cards:read` and never returns cards/counts. Full board snapshots and session/account/credential administration are unavailable to PATs.

To rotate: issue a replacement through the signed-in session, update the host's protected configuration and restart its MCP process, verify a permitted read, then revoke the old credential with **DELETE `/api/v1/tokens/:tokenId`** in that signed-in session. Revocation prevents subsequent API use. Different credentials have separate retry namespaces: do not rotate while a create outcome is unknown; first resolve it using the original credential and operation ID or verify the result manually.

## Create safely when a response is lost

Every `flowboard_create_card` call requires a caller-generated `operationId` of 16–128 ASCII letters/digits/dot/underscore/colon/hyphen. A UUID is suitable. Save that ID together with the board, exact column ID and card input before invoking the tool. If a timeout or disconnect makes the result unknown, retry using **the same ID and the same input**, including after a host/process restart. The tool never generates a new key for you or blindly retries transport failures. Only `STALE_BOARD_VERSION` gets one automatic metadata refresh/retry using the same key and semantic input.

Flowboard retains the minimal create receipt for **seven days**. Within that window and credential namespace, identical operations replay the original card ID; changing meaningful input with the same key produces `IDEMPOTENCY_CONFLICT`. After seven days, the same key can create a new card. After a timeout, inspect/resolve the original operation before expiry or before replacing its credential. Daily fleet alerts need a durable external-issue mapping and installation API; those are future work, not this receipt feature. Search does not enforce uniqueness and cannot safely deduplicate concurrent creates.

Prefer a column ID over its name so renames do not break a later retry. Missing/ambiguous/deleted columns cause an error; the client never silently chooses another column. Output fields `submittedTitle` and `submittedPriority` describe the submitted input, not a fresh read of a card that someone may since have edited. `replayed: true` identifies receipt replay.

## Pagination and limits

Project listing and card search return `{ "data": [...], "nextCursor": null | "opaque value" }`. Each call requests one page only (default50, maximum100). Preserve the same project/query/limit while passing `nextCursor` as `cursor` to fetch a later page. A non-null cursor means the result is incomplete. The search parameter is `query`; blank searches are rejected by this client. Board metadata and board listing are explicitly bounded to100 entries per response by the client.

Server/proxy errors are reported using HTTP status and a bounded error code; arbitrary upstream response messages/bodies are omitted to avoid copying credentials or private diagnostic data into host context. Local tests use synthetic API stubs; they do not prove deployed authentication, private data handling or UAT behavior. A signed-in UAT tester must separately verify issuance, permissions, rotation/revocation and a lost-response retry on the reviewed build.
