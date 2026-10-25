# Flowboard stack comparison and portable baseline

Research date: 26 October 2026, Asia/Kolkata. Status: recommendation for review; no application, account, deployment or benchmark was created for this research.
The existing Workers/D1 architecture and SQLite migration are proposals, not a deployed system or an accepted database constraint.
This recommendation reflects the newer priorities: performance first, a free pilot, scalable design, and a credible move from Cloudflare to AWS or Azure.

## Recommended baseline

Use **TypeScript, React + Vite, Hono, Kysely + node-postgres (`pg`), and PostgreSQL**.
Host the pilot's static frontend and API on Cloudflare Workers; connect to **Neon PostgreSQL through Hyperdrive with query caching disabled**.
Use **Better Auth with PostgreSQL-backed sessions and OAuth login**, foreground polling initially, and a transactional PostgreSQL outbox.
Keep a working **Hono Node adapter** and local PostgreSQL development path from the first vertical slice; package the Node entry point as a container before calling the application portable.
Defer attachments, dedicated queues, presence and WebSockets until the core board is correct and measured.

This is one practical starting stack, not a claim that edge compute or PostgreSQL is universally fastest.
PostgreSQL is selected for normal interactive transactions, concurrent writes, query control and migration continuity.
Workers is selected for a low-cost pilot deployment; its location, CPU ceiling and origin database round trips must pass the benchmark below.
If those measurements fail, move the same Hono services to Node near PostgreSQL before adding platform-specific optimizations.

## Assumed workload and unknowns

- Initial pilot assumption: a few teams, 5–25 concurrently active people, usually hundreds of cards per board, modest comments and short text fields.
- Larger synthetic cases: 2,000–10,000 cards per board, many archived cards and growing activity history; bounded lists must still avoid loading everything.
- Users' geography, sustained write rate, maximum tenants, residency, uptime needs and budget after the pilot remain unconfirmed.
- There are no measured latency, throughput, memory or cost results. Documentation limits are evidence; the workload and budgets here are proposals.
- Do not translate a provider's router benchmark, SQL execution time or advertised scale into Flowboard end-to-end performance.

## Database comparison

| Choice | Strength for Flowboard | Cost or limitation | Decision |
| --- | --- | --- | --- |
| D1 / SQLite | Integrated Workers binding, inexpensive small relational app, atomic SQL batches. | Cloudflare-specific API; SQLite-to-PostgreSQL migration; each DB serializes queries; batch is not an interactive branching transaction. | Valid prototype option, weaker baseline for the revised portability objective. |
| Neon PostgreSQL | Standard PostgreSQL connection, relational transactions, small independent database service. | Separate provider, connection planning, free compute suspension and quotas. | Recommended pilot database. |
| Supabase PostgreSQL | PostgreSQL plus integrated Auth, Storage and Realtime. | More service coupling if clients consume these directly; Free pauses and project limits. | Good integrated alternative if managed product services outweigh provider independence. |
| Self-managed PostgreSQL | Control over server, extensions and operation. | Backups, upgrades, recovery, monitoring and security become our work. | Local development only initially. |

D1 currently permits **500 MB per database on Free**, **10 GB per database on Paid**, and that paid per-database limit cannot be increased.
Each individual primary or replica processes queries serially; read replicas do not remove primary write contention.
These are constraints, not evidence that the pilot would exceed capacity. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

The existing D1 proposal needs constraint-backed guards because a conditional UPDATE affecting zero rows does not itself abort an atomic batch.
PostgreSQL lets the service read, validate, lock, branch, update and insert its outbox in one short transaction.
The transaction must use one checked-out connection throughout; running BEGIN and subsequent statements through unrelated pooled queries is incorrect. [pg transactions](https://node-postgres.com/features/transactions)

Preserve the existing useful concepts: tenant keys, composite foreign keys, optimistic versions, idempotency receipts and event/outbox atomicity.
Rewrite the proposed schema deliberately for PostgreSQL: date/timestamp types, booleans, JSONB, constraints, indexes, generated IDs and migration tooling need review.
Use normalized common card fields; use JSONB only for validated flexible data, with explicit indexing after actual query needs emerge.
PostgreSQL row-level security can add defense in depth, but needs a non-bypass role and tested transaction-local tenant context; application authorization remains necessary.

## Free-tier reality

| Service | Current documented allowance or behavior | Implication |
| --- | --- | --- |
| Workers Free | 100,000 requests/day; 10 ms CPU per HTTP request; 128 MB memory. | Authentication, validation and response serialization must fit; network wait is distinct from CPU time. |
| Hyperdrive Free | 100,000 database statements/day; excess operations fail. | One API request can consume several statements, including transaction control and auth queries. |
| Neon Free | 100 CU-hours/project/month; 1 GB/project, 20 GB account total; 5 GB public transfer/project; suspension after 5 minutes inactive. | A free pilot can sleep and can exhaust compute or transfer before storage. CU-hours are not request counts. |
| Supabase Free | 500 MB database; 1 GB file storage; 5 GB egress plus 5 GB cached egress; 2 active projects; pauses after 1 week inactive. | Local/dev/UAT/prod cannot all be independent free hosted projects under this allowance. |
| D1 Free | 5 million rows read/day; 100,000 rows written/day; 5 GB total storage, subject to the per-DB cap above. | Scanned rows and index work matter; these are different units from Hyperdrive statements. |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/), [Neon plans](https://neon.com/docs/introduction/plans), [Neon pricing](https://neon.com/pricing), [Supabase pricing](https://supabase.com/pricing), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

Neon's currently retrieved documentation says 1 GB/project; do not copy older 0.5 GB limits into the implementation plan.
Free eligibility, available regions, account-specific quotas and billing controls still need checking in the chosen accounts before provisioning.
An indefinitely free, always-warm production service is not established by these allowances.
For illustration, 10 foreground clients polling every 30 seconds for 8 hours generate 9,600 polls/day; at 3 SQL statements each that is 28,800 statements before other traffic.
Polling can also keep database compute awake. Pause it in hidden tabs, use jitter/backoff and fetch only a revision until state changes.
A performance requirement may justify paid non-suspending compute before any scaling requirement does; do not hide that conflict with keepalive requests.

## Runtime, API and frontend choices

**Hono over a Workers-only router:** Hono uses Web Request/Response APIs and has a documented Node adapter.
Keep route handlers thin and share use-case services between entry points; request metadata, database lifecycle and scheduling stay in each runtime's composition layer. [Hono Node adapter](https://hono.dev/docs/getting-started/nodejs)

**Workers initially, Node/container as a real second target:** Workers' Node compatibility is a supported subset, not a full long-running Node process.
Do not assume filesystem access, sockets, native dependencies, process lifecycle or background execution behave identically. [Workers Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
Node colocated with PostgreSQL is a serious performance comparison because multi-statement transactions incur origin round trips; neither deployment has been measured here.
Fastify is a sensible Node-first alternative, with validation/plugins and documented serverless deployment patterns, but offers less reason to select it for a Workers-first pilot. [Fastify deployment guide](https://fastify.dev/docs/latest/Guides/Serverless/)
Do not select Hono, Fastify, Bun or another runtime based on synthetic hello-world requests/second.

**React + Vite over an SSR-first stack:** an authenticated drag-and-drop board primarily needs client interaction and server mutations; SSR/SEO is not an established requirement.
Use route-level lazy loading, a query cache, optimistic commands with rollback/rebase, and bounded rendering of long columns.
Vite leaves routing, data loading, error handling and accessibility to the application; React explicitly documents that tradeoff. [React from scratch](https://react.dev/learn/build-a-react-app-from-scratch)
React Router and TanStack Query are reasonable focused additions; evaluate drag-and-drop keyboard and screen-reader behavior before choosing its library.
Choose a fullstack framework if public indexable pages, SSR, server components or consolidated server routing become accepted needs; do not add that deployment complexity preemptively.

**Kysely + pg over a database-neutral ORM promise:** Kysely keeps joins, locking, SQL expressions and transaction boundaries visible while providing TypeScript query checking.
Its transaction callback rolls back when an error is thrown. SQL migrations remain reviewed source, and the database remains PostgreSQL. [Kysely transactions](https://kysely.dev/docs/examples/transactions/simple-transaction)
Plain parameterized `pg` SQL is a learning-friendly alternative with fewer abstractions; it requires more careful result typing and repeated query plumbing.
Drizzle is also reasonable if schema-as-TypeScript is preferred, but its D1 support explicitly embraces dialect-specific APIs; selecting it does not make SQLite and PostgreSQL interchangeable. [Drizzle D1](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1)
Do not add two query builders or a generic repository abstraction for every table. Share domain commands and isolate runtime connections, not SQL dialect differences we do not actually need.

## Connection and transaction design

Use `pg` through Hyperdrive on Workers; Cloudflare documents and recommends this driver. Pin tested versions and a compatibility date. [Hyperdrive pg guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/)
Connect Hyperdrive to Neon's **direct endpoint** as Cloudflare's example specifies; do not stack another pooler without a measured reason. [Hyperdrive + Neon](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/)
Disable Hyperdrive query caching for permissions, sessions, board snapshots and reads after writes; it is enabled by default. [Query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)
Hyperdrive pools by transaction; session state cannot be assumed to survive release. Keep tenant settings transaction-local, bound transaction duration and set connection limits against the origin capacity. [Connection pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/)
Construct and release Worker database resources within their request lifecycle; use a bounded process pool with graceful shutdown in Node. Test both implementations rather than copying a global Node pool into workerd.

For card moves: authorize, lock the small ordering/version row, verify expected revision and neighbor ancestry, compute the rank, write the card/event/receipt/outbox, then commit.
Keep network calls and notification delivery outside the transaction. Acquire multiple locks in a deterministic order; retry only documented retryable failures with a bounded policy.
Short row locks still serialize competing moves within the same board; PostgreSQL does not eliminate contention in the proposed board-wide revision protocol.

## Authentication: portable library versus managed service

Start with Better Auth, OAuth identities and PostgreSQL-backed sessions, avoiding custom password implementation and email infrastructure in the first slice.
Better Auth documents direct Hono integration and the Workers `nodejs_compat` requirement; its PostgreSQL adapter uses `pg`. [Hono integration](https://better-auth.com/docs/integrations/hono), [PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql)
This keeps auth/session tables under our control but makes dependency patching, OAuth callback configuration, abuse controls and session policy our responsibility.
Review generated auth migrations alongside application migrations; do not apply both independent migration systems blindly to the same schema.
Prototype request-scoped pg/Hyperdrive resource handling and session operations before committing to this integration; the combination is documented in parts, not tested by this research.
Measure OAuth callback and session CPU on Workers Free. If they exceed its CPU allowance, use a paid Worker or the Node target; never weaken cryptography to remain free.

Managed auth such as Supabase Auth reduces operational work and can be the better choice when email/password recovery or enterprise identity is immediate scope.
It introduces provider-specific user/session/token behavior; retaining user IDs and provider subjects helps, but replacing auth can still require session invalidation, account linking and user reauthentication.
Keep workspace authorization in Flowboard; neither a valid OAuth login nor an external identity-provider role automatically grants board access.
GitHub is the supplied code host, not evidence that every future product user should authenticate through GitHub.

## Storage, jobs and realtime

Start with a PostgreSQL outbox committed with domain changes; a scheduled worker claims bounded batches with leases, retries and unique event/recipient keys.
Scheduled database polling also consumes compute/quota. Skip needless scans, use an indexed pending queue and select the least frequent acceptable schedule.
Later publish outbox IDs to Cloudflare Queues; its at-least-once delivery requires idempotent consumers. Retain the outbox as the delivery/recovery boundary. [Queue guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
Porting to SQS or Azure Service Bus changes queue handlers, retry/dead-letter behavior, credentials and monitoring; a common payload is useful, but does not erase those differences.

For attachments later, keep metadata and stable object keys in PostgreSQL and private bytes in R2. Store no permanently signed provider URLs as canonical identity.
R2 offers a documented subset of S3 APIs; S3 can reuse selected operations, whereas Azure Blob needs its own adapter and copy/verification workflow. [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
Use narrow upload/download/delete contracts, authorization, limits, checksums and orphan cleanup; add providers only when needed.

Use polling/refetch first and PostgreSQL as the authority. A later WebSocket gateway broadcasts committed event IDs and revisions; clients refetch after gaps or reconnects.
Durable Objects offer a Cloudflare-specific coordinator/presence option, but moving to Node or a managed gateway requires rebuilding connection ownership and fan-out.
Do not couple canonical mutations to an unportable coordinator, promise exactly-once notifications, or require beta database realtime for initial correctness.

## Portability that can be demonstrated

| Boundary | Reused | Work that remains during a move |
| --- | --- | --- |
| Browser | Static Vite output, React state and API contract. | CDN/origin routing, cookies, CSP and environment configuration. |
| API | Hono routes, domain services, PostgreSQL queries. | Worker export → Node adapter/container, secrets, probes, shutdown, logging and scaling. |
| Database | PostgreSQL schema and data, tested SQL migration history. | Version/extension compatibility, roles, TLS, networking, backup/restore and connection budgets. |
| Jobs/files/realtime | Event formats, outbox semantics, object keys. | Provider implementations, data transfer, delivery behavior, IAM and reconnect handling. |

AWS ECS/Fargate and Azure Container Apps can run the Node container, but their networking, identity, resource sizing and operational configurations are different. [ECS task definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html), [Azure containers](https://learn.microsoft.com/en-us/azure/container-apps/containers)
Move compute first while retaining Neon to isolate runtime changes; then move PostgreSQL to RDS or Azure Database for PostgreSQL if cost, locality or policy justifies it.
Use an export/restore rehearsal with compatible PostgreSQL tooling; `pg_dump` exports a consistent database but does not include all cluster-wide roles. [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)
For a small early installation, plan a short read-only/write-freeze window: stop consumers, export, restore, validate tenant counts/constraints, switch credentials, smoke test, then reopen writes.
Define rollback before reopening writes: once the new database accepts writes, switching back without reconciliation loses them. Lower-downtime replication needs its own design and testing.
No universal adapter turns a Worker, D1, Durable Object, SQS and Azure Blob into interchangeable infrastructure.

## Proposed benchmark and acceptance plan

1. Build one vertical slice: OAuth session, authorized board read, card move with idempotency/version conflict, comment/outbox and revision poll.
2. Run the same synthetic workload against Workers+Hyperdrive+Neon and Hono Node+the same PostgreSQL region/tier. Later compare paid/warm compute separately.
3. Use seeded small/large datasets and 1/10/25 concurrent users, then a separately budgeted 100-user stress case. Include same-board move contention and permission revocation.
4. Separate warm requests from requests after database suspension and app startup; test from the intended user region plus a distant region. Record every region, plan and configuration.
5. Capture browser input-to-next-paint/drag responsiveness, API p50/p95/p99, CPU, SQL count/duration, lock wait, retries, error rate, DB active time and response bytes.
6. Proposed warm targets: p95 board snapshot ≤500 ms and committed move acknowledgement ≤300 ms in the primary user region; visible optimistic feedback ≤100 ms.
7. Proposed correctness gate: zero cross-tenant reads/writes, lost accepted moves, duplicate logical events or false-success receipts under retries and concurrent execution.
8. Proposed pilot budgets: ordinary API CPU p95 <6 ms on the 10 ms Free limit; alert at 60% of daily request/SQL and monthly database allowances, review before 80%.
9. Start with 5-minute warm runs at ≤5 requests/second per configuration (≤1,500 requests), plus 20 labeled suspension/restart samples. Cap total remote statements at 20,000/day for research.
10. Obtain explicit spend approval before paid benchmark capacity; document exhausted quotas, warmups and failed samples. Do not discard cold results from the user-experience report.

These numbers are proposed goals and test caps, not measured results or performance guarantees. Account quotas and the actual statements per mutation may require smaller runs.
If warm latency is dominated by origin round trips, reduce SQL exchanges and compare Node near the DB; if CPU dominates, profile validation/auth/serialization before changing frameworks.
If cold latency fails the product requirement, budget warm compute; if same-board lock waits dominate, revisit ordering scope before sharding tenants or adding realtime infrastructure.
Accept the stack only after the slice passes correctness and representative latency tests; keep local → dev → UAT → production promotion explicit and isolated.

## Learning and implementation order

Learn one PostgreSQL transaction and an indexed board query first, then add typed Kysely queries, the Hono service boundary and React optimistic mutation behavior.
Implement the Node local path and Worker entry point together; a second runtime test is concrete portability evidence and a useful debugging aid.
Add OAuth/session integration before exposing customer writes; add outbox recovery before external notification channels.
Before application coding proceeds, record the accepted database/runtime decision and update architecture/schema documents coherently; the current D1 files are not executable PostgreSQL migrations.
Recheck provider quotas and supported versions at provisioning time. Pin dependencies after the compatibility spike, not from untested latest-version examples.
