# Flowboard backend research

Research date: 26 October 2026 (Asia/Kolkata). Scope: an Azure Boards-like collaborative Kanban app with workspaces, projects, configurable boards/columns, draggable cards, priority, due dates, assignees, card detail dialogs, comments, and mentions. This is an architecture proposal grounded in current official documentation; no service has been provisioned or deployed, and no throughput or end-to-end behavior has been tested.

## Recommendation

Start with a TypeScript Cloudflare Worker serving the API and frontend static assets, D1 for relational data, and a database outbox for durable background work. Add Queues when external notifications are enabled, R2 when attachments are in scope, and one Durable Object per board when live collaboration is required. Keep D1 as the authoritative store even after adding realtime.

This is the simplest fit for the stated Cloudflare hosting preference and an initial team-oriented Kanban product. It is not an unlimited-scale assertion: each D1 database processes queries serially and has a 10 GB paid-plan cap. Begin with one database per environment and explicit tenant keys, measure real query duration/queueing, and revisit the database boundary before customer scale or large imports make it expensive. D1 supports scaling across smaller per-tenant databases, but adding a database router and cross-workspace reporting at the beginning would create unnecessary operational work. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

Choose managed PostgreSQL with cache-disabled Hyperdrive from the beginning instead if requirements already include database-enforced tenant row policies, complex branching transactions, extensive portfolio reporting, high sustained write concurrency, or a likely database footprint above D1's cap. That still hosts the application on Cloudflare, while the origin database is another service with separate operation and billing responsibilities.

## Storage comparison

| Concern | Workers + D1 | Workers + PostgreSQL through Hyperdrive |
| --- | --- | --- |
| Hosting | Worker and database use Cloudflare services. | Worker uses Cloudflare; Hyperdrive connects to an origin PostgreSQL database. |
| Mutation semantics | Use atomic SQL statements and D1 `batch()`; a batch is transactional and rolls back if a statement fails. Avoid application read/await/write sequences as a concurrency guarantee. | Ordinary PostgreSQL transactions can read, branch, lock rows, update, and write an outbox in one transaction. |
| Contention | Each database executes one query at a time; query duration and request volume determine capacity. | Depends on the chosen origin database, indexes, workload, connection budget, and locks. There is no verified universal throughput figure. |
| Tenant enforcement | API authorization plus tenant-scoped queries, composite keys, foreign keys, and constraints. | The same application checks, with PostgreSQL row security as additional enforcement when correctly configured. |
| Freshness | Start with primary reads. Optional read replication requires the Sessions API and careful bookmark propagation. | Disable Hyperdrive query caching for permissions, sessions, board state, and reads after writes. |
| Portability | Relational concepts transfer, but SQLite SQL, migrations, triggers, and D1 bindings need a deliberate migration. | Broader PostgreSQL ecosystem; Hyperdrive remains an application connection integration. |

Sources: [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/), [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html).

Hyperdrive is a connection pool and optional query cache, not a replacement database. Its query cache is enabled by default, with a documented 60-second lifetime and 15-second stale-while-revalidate window; writes do not invalidate matching cached SELECT results. A collaborative board should use a cache-disabled configuration initially, retaining the connection pooling benefit. Create database clients inside request handlers rather than retaining a shared client across Worker requests. Hyperdrive uses transaction pooling, so tenant context must be transaction-local rather than session state assumed to survive between requests. [Query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/), [connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/), [connection pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/)

## Proposed ownership and schema

The workspace is the tenant boundary. Projects belong to one workspace; boards belong to one project; columns and cards belong to one board. Model membership explicitly rather than treating an assignee as permission to read a card.

Suggested relational entities:

- `users`, `identities`, `sessions`, `workspaces`, `workspace_memberships`, `invitations`.
- `projects`, optional `project_memberships`, `boards`, `board_columns`.
- `cards`, `card_assignees`, `labels`, `card_labels`.
- `comments`, structured `comment_mentions`, `notifications`.
- `activity_events`, `mutation_receipts`, `outbox_events`; `attachments` only when needed.

Every tenant-owned row carries `workspace_id`. Where appropriate, use composite foreign keys that also include workspace/project/board identity so an ordinary foreign key cannot accidentally connect a card in one workspace to a column in another. Index actual access paths, especially board/column/order, card comments by creation cursor, membership by user/workspace, and pending outbox rows. List endpoints use bounded cursor pagination.

Keep common fields normalized: title, description, priority enum, due date, card type, assignees, archived state, and row revision. A date-only deadline should remain a date-only product value; timed reminders additionally need a timezone policy. Use stable column IDs and configurable names/order/colors. Renaming a column must not rewrite card history. Model custom field definitions and typed values when that scope is accepted rather than putting every card property into an unvalidated JSON object.

These are design recommendations, not vendor guarantees. D1 charges for scanned rows and index updates, so query design and index selection affect both latency and cost. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)

## Concurrency and drag ordering

Use optimistic UI for responsiveness, with authoritative server commands:

1. A card move submits `mutationId`, `expectedOrderRevision`, `cardId`, destination column ID, and neighboring card IDs. The server derives the rank and verifies that neighbors belong to the authorized destination board/column. A client-supplied array index is insufficient as an authoritative position.
2. Use a board ordering revision initially. The atomic mutation verifies membership, board/column state, and the expected revision, then updates the card, advances the revision, and inserts an activity event, mutation receipt, and outbox record together. A stale revision returns a conflict and the latest authorized state so the client can refresh/reapply the intent.
3. Store sparse bounded integer ranks for the first implementation; use the midpoint when a gap exists, and compact the affected column atomically when no gap remains. Use a deterministic secondary key when sorting. Column moves use the same pattern. Board-wide ordering revisions are conservative and can cause retries for unrelated moves; use per-column revisions later only if measured contention justifies the added cross-column protocol.
4. Ordinary card field edits use a card revision, and comments use independent IDs. Every mutation has a unique receipt scoped to actor/workspace and includes a request hash so retries cannot repeat side effects or reuse an ID with different content.

D1's serialization does not make two separate API calls atomic. A `batch()` does roll back on a failing statement, but a conditional UPDATE affecting zero rows is successful SQL and does **not** automatically abort later statements. The implementation must make a failed revision/authorization guard abort the batch (for example, a constraint-backed SQL guard), or gate every dependent write on a successful receipt. An unconditional audit/outbox insert after a zero-row CAS is a correctness bug. This protocol needs concurrent-move, duplicate-command, partial-failure, and membership-revocation tests before release. [D1 `batch()` contract](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)

For the PostgreSQL alternative, lock the relevant board ordering row inside a short transaction, validate the revision and membership, calculate rank, apply the mutation, and insert the outbox/receipt before commit. Acquire multiple board/column locks in a deterministic order. PostgreSQL documents that `SELECT ... FOR UPDATE` prevents competing modification until transaction end. [PostgreSQL row locks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS)

## Authentication and tenant authorization

Keep authentication provider-neutral until the intended audience is confirmed. A workforce-only app can use Cloudflare Access with the team's identity provider; an app for independent customer workspaces should use an appropriate managed OIDC identity service and an application session. Do not implement password storage as incidental Kanban work.

If using Access, the Worker must verify the Access JWT signature, issuer, and application audience using the account's rotating signing keys. The presence of `Cf-Access-Jwt-Assertion` or an email header alone is not proof of identity. Access identity still maps to an application user and workspace/project membership. [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

Proposed roles are workspace owner/admin/member/viewer, with project/board restrictions only where needed. Resolve identity from a validated session, authorize each object through its tenant relationship, and enforce write permissions in the same atomic mutation as the data change. Never trust a `workspace_id`, assignee ID, mention target, or attachment key merely because it arrived from the UI. Mention autocomplete only returns members visible to the actor; mentioning a person does not grant access.

Use secure HttpOnly session cookies and an explicit CSRF/origin policy for cookie-authenticated writes; keep tokens out of browser persistent storage where possible. Logout and membership removal need fresh server-side enforcement. With PostgreSQL RLS, the runtime role must not own the tables or have `BYPASSRLS`, and identity/workspace settings must be set inside each transaction under Hyperdrive pooling. Table owners and bypass roles normally escape PostgreSQL policies. [PostgreSQL row security behavior](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

## Comments, mentions, and durable background work

Store comment content in a validated format with structured mention IDs, author, timestamps, and an edit revision. Render through a controlled Markdown/rich-text pipeline. A comment edit computes added/removed mentions server-side; notifications reference the real comment and recipient rather than reparsing display names.

The comment, mention rows, in-app notifications, activity event, and outbox entry commit together. An outbox dispatcher publishes event IDs to Queues and retries unprocessed rows. A crash after publish but before marking dispatched can publish twice, so consumers deduplicate by event ID and side-effect recipient. Recheck current visibility before sending sensitive notification content. For providers that support it, use the same stable idempotency key for external email delivery.

Queues is at-least-once and does not preserve publication order. It should carry notification/integration work, not establish board order. Use bounded retries, a dead-letter queue, and an operator-visible replay path; keep database outbox state as recovery evidence. [Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), [ordering behavior](https://developers.cloudflare.com/queues/reference/how-queues-works/)

## Realtime and attachments

For the first backend, short conditional polling by board revision is sufficient if live collaboration is not part of the accepted release. When it is, add a board-scoped Durable Object with hibernating WebSockets to fan out committed event/version hints and presence. Cloudflare documents that hibernation preserves client connections while the object sleeps, but in-memory state resets on wake. Persist necessary connection metadata and reconstruct state. [Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

Authorize WebSocket upgrades against the current board membership; expiring identity, removal, and permission changes need a disconnect/revalidation policy. Events carry board version and event ID; a reconnect or detected gap triggers an authorized snapshot fetch. A WebSocket broadcast failure must not undo a committed card move. D1 remains authoritative; a Durable Object is not a distributed transaction across D1 and a socket. Avoid separate conflicting order authorities in SQL and object memory.

R2 is appropriate for private attachments and avatars, with metadata in D1 and object keys namespaced by tenant. The Worker authorizes reads/uploads; short-lived presigned URLs can support direct object transfer and are bearer capabilities. Confirm upload size/type, retain a pending/finalized attachment state, and clean abandoned uploads. Do not put file bodies into D1 rows or expose a public bucket for private board files. [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)

## Migrations, environment isolation, and GitHub

Use local emulated resources for development and separate remote dev/UAT/production Worker deployments, databases, buckets, queues, secrets, and identity applications. Preview builds must use isolated synthetic data and notification sinks. Wrangler bindings and environment variables are non-inheritable and must be declared for each environment; distinct environment names alone do not isolate resources if they bind the same database. [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/), [D1 environment bindings](https://developers.cloudflare.com/d1/configuration/environments/)

Keep versioned SQL migrations in GitHub. Apply each migration locally, then dev, then UAT, then production with an explicit target database/environment. Use additive expand/backfill/contract migrations so old and new deployed Worker versions can coexist; batch large backfills. D1 tracks SQL migrations in a migrations table. [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)

Keep development secrets in ignored local files and deployed secrets in environment-specific Worker secret bindings. CI needs a narrowly scoped deploy credential and protected production environment. Do not commit populated tokens or deploy against an inferred account. Source-controlled code, migration state, deployed version, and smoke-test result should each be recorded. Rollback of Worker code does not undo a schema migration; destructive restoration requires a separate data recovery decision. D1 currently documents Time Travel retention of 7 days on free and 30 days on paid; practice restore/export recovery with synthetic data. [D1 recovery limits](https://developers.cloudflare.com/d1/platform/limits/)

## Verified pricing and limits

USD list pricing retrieved on the research date; account plans, future changes, tax, domain, identity/email providers, origin PostgreSQL, and other services can add costs. These are service units, not a forecast for Flowboard.

| Service | Published allowances/rates relevant to planning | Source |
| --- | --- | --- |
| Workers Standard | $5 monthly subscription; 10 million requests and 30 million CPU ms included monthly; excess $0.30/million requests and $0.02/million CPU ms. Direct static-asset requests are free/unlimited. | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| D1 free | 5 million rows read/day, 100,000 written/day; 5 GB account storage, but 500 MB per database. Hitting daily limits blocks queries until reset. | [Pricing](https://developers.cloudflare.com/d1/platform/pricing/), [limits](https://developers.cloudflare.com/d1/platform/limits/) |
| D1 paid | 25 billion rows read/month and 50 million written/month included; excess $0.001/million read and $1/million written; 5 GB storage included then $0.75/GB-month. 10 GB maximum per database. | [Pricing](https://developers.cloudflare.com/d1/platform/pricing/), [limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Hyperdrive | Free: 100,000 statements/day; paid: unlimited Hyperdrive statements with pooling/cache included. Origin database charges remain separate. | [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/) |
| Queues | Free: 10,000 operations/day; paid: 1 million operations/month included, then $0.40/million. Usually three operations per delivered small message; retries add reads. | [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) |
| R2 Standard | 10 GB-month, 1 million Class A and 10 million Class B operations monthly free; excess $0.015/GB-month, $4.50/million Class A, $0.36/million Class B; internet egress free. | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Durable Objects | Additional request, active-duration, and storage billing; hibernation reduces idle active-duration billing. Budget only after measuring concurrent sessions and message rates. | [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |

D1 also documents a 30-second query limit, 100 bound parameters/query, and 2 MB maximum row/string/blob. These affect bulk APIs and long comments even when total database size is small. Index updates count toward written rows. Read replicas can help read latency/throughput but do not add independent write capacity; Sessions API/bookmarks are needed for sequential consistency when using replicas. Keep authorization and post-mutation reads fresh. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)

## Decisions and release evidence still needed

- Confirm whether Flowboard is workforce-only or customer-facing; choose the identity provider and invite/account lifecycle accordingly.
- Confirm visibility rules, custom fields, attachment/email scope, and whether simultaneous live updates are required in release one.
- Before claiming production readiness, prove tenant isolation, forged IDs, removed membership, parallel card/column moves, retry idempotency, outbox replay, reconnect recovery, and schema upgrade compatibility with synthetic fixtures.
- Measure realistic board sizes, indexed query duration, rows scanned/written, conflict rate, and notification volume. Establish product-specific latency and capacity thresholds before deciding that D1 needs sharding or PostgreSQL.

No current Cloudflare account, GitHub repository, quota allocation, identity provider, billing subscription, or deployed database was inspected by this research task.
