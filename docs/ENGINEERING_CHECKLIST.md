# Engineering checklist: 50 concerns

Updated 2026-10-26. Owner: Flowboard Architect; Backend implements runtime/data controls, UI implements client behavior. This is a living delivery checklist, not a claim that every distributed-systems technique belongs in the first release.

## Status rules

Each row is a delivery checkbox: leave it unchecked until its applicable acceptance evidence exists. A written plan is **design coverage**, not delivery. `Planned` means first-release implementation is required. `Deferred` means an explicit trigger must be met first. `Prototype` is local evidence for the superseded D1 option only. Do not turn deferred items into “done” merely because we chose not to install them. A later “not applicable” closure needs a dated rationale and review trigger.

Detailed explanations, options and primary sources: [data items 01–25](research/reliability-data.md), [runtime items 26–50](research/reliability-runtime.md). Platform choice and benchmarks: [stack research](research/stack-comparison.md), [architecture](../ARCHITECTURE.md). Validation scope: [verification](VERIFICATION.md). Design review status is recorded in PROGRESS.md after research synthesis.

## Design coverage completed this iteration

- [x] Items 01–25: data/concurrency research reviewed and incorporated into the root architecture.
- [x] Items 26–50: runtime/reliability research reviewed and incorporated into the root architecture.
- [x] Performance, free-tier caveats and cross-cloud exit steps compared with a separate stack researcher.
- [ ] Implement and validate applicable controls against the selected PostgreSQL application/runtime. The 50 delivery boxes below track this work individually.

| ID | Concern | Delivery | Design plan / adoption trigger | Evidence needed to check done |
|---|---|---|---|---|
| 01 | Race Conditions | [ ] Planned; D1 prototype | Revisions, authorized transaction, stable neighbor validation | Concurrent move/edit/revoke and retry tests against actual selected DB |
| 02 | Deadlocks | [ ] Planned | Short transactions, common lock order; bounded whole-transaction retry | Induced PostgreSQL deadlock; no partial side effects; metrics |
| 03 | Database Transactions | [ ] Planned; D1 prototype | State + receipts + audit + outbox in one DB transaction | Failure injection at each write; full rollback |
| 04 | ACID Properties | [ ] Planned; partial prototype | Map atomicity/consistency/isolation/durability to concrete invariants | DB/runtime tests plus recovery/backup evidence; no global ACID claim |
| 05 | Isolation Levels | [ ] Planned | Read Committed plus explicit locks/CAS; stronger snapshot only where needed | Write-skew/phantom scenarios and consistent board snapshot tests |
| 06 | Optimistic Locking | [ ] Planned; D1 prototype | Card/comment versions and board structure/snapshot revisions | Two writers, one winner; stale 409 with draft retained |
| 07 | Pessimistic Locking | [ ] Planned | PostgreSQL row lock for short board-order mutation; fixed lock order | Contention, timeouts, membership-removal race and no network IO under lock |
| 08 | Connection Pooling | [ ] Planned | Runtime driver/pool adapter with caps; account for all instances | Burst test: pool wait, connection budget and no session-state leakage |
| 09 | N+1 Queries | [ ] Planned | Bounded joins/batched relations; avoid per-card calls | Query count stays bounded as board page size grows |
| 10 | Database Indexes | [ ] Planned; D1 prototype | Tenant/order, comments, inbox, due-date and outbox indexes | Selected DB plans + read/write/index-size measurement |
| 11 | Query Optimization | [ ] Planned | Keyset pagination, projections, bounded snapshots | Representative p95/p99 and realistic cardinality/skew plans |
| 12 | EXPLAIN ANALYZE | [ ] Planned | PostgreSQL execution plans on safe synthetic data; SQLite uses different tools | Stored before/after plans; avoid executing live mutations via ANALYZE |
| 13 | Foreign Key Constraints | [ ] Planned; D1 prototype | Composite tenant/board ancestry constraints | Actual PostgreSQL wrong-tenant/board negatives and valid write tests |
| 14 | Unique Constraints | [ ] Planned; D1 prototype | Receipts, provider identities, assignment and notification dedupe | Duplicate/race tests; ownership-transfer invariant separately proved |
| 15 | Database Migrations | [ ] Planned | Versioned SQL, single deploy runner, forward/backward compatibility | Clean install + upgrade from previous schema |
| 16 | Zero-Downtime Migrations | [ ] Planned | Expand/backfill/contract; concurrent indexes where suitable | Old/new versions run together; lock duration + rollback rehearsal |
| 17 | Read Replicas | [ ] Deferred | Add after measured primary read pressure; keep critical reads primary | Replica routing, failover and consistency contract tests |
| 18 | Replication Lag | [ ] Deferred | Staleness budget, primary fallback, no stale auth/read-after-write | Inject lag; verify revocation and version freshness |
| 19 | Database Sharding | [ ] Deferred | Tenant routing only after single-DB limits persist after tuning | Tenant migration/rebalance, routing correctness, recovery runbook |
| 20 | Partitioning | [ ] Deferred | Consider large append-only history by time/tenant; distinguish from shards | Pruning/index plans; uniqueness, retention and migration validation |
| 21 | Cache Invalidation | [ ] Planned | Static assets cache; private data no-store initially; versioned opt-in caches | Update/revoke/cross-tenant cache-leak tests before private caching |
| 22 | Redis Eviction | [ ] Deferred; no Redis | Disposable cache only, explicit policy and memory budget | Force eviction; system stays correct and recovers |
| 23 | Cache Stampedes | [ ] Deferred | Coalesce rebuilds, bounded stale safe reads, TTL jitter | Simultaneous miss test; bounded DB pressure |
| 24 | Distributed Caching | [ ] Deferred | No process-local authority; scoped keys/TTL/version | Multi-instance invalidation and cold-cache performance |
| 25 | Idempotency | [ ] Planned; D1 prototype | Actor/workspace keys, payload hash, transaction receipt, side-effect dedupe | Lost response, concurrent duplicate, changed hash, expiry/revoked-access tests |
| 26 | Retry Mechanisms | [ ] Planned | Classify failures; bounded attempts and total deadlines | Transient success/permanent failure/no duplicate side effects |
| 27 | Exponential Backoff | [ ] Planned | Capped delay growth; respect Retry-After | Fake-clock timing and end-to-end retry deadline tests |
| 28 | Jitter | [ ] Planned | Randomize bounded retries to spread bursts | Seeded distribution/limits tests and burst recovery |
| 29 | Circuit Breakers | [ ] Deferred | Per-dependency breaker after observed sustained failures | Open/half-open recovery, fleet/runtime-scope behavior, no silent loss |
| 30 | Rate Limiting | [ ] Planned | Actor/tenant and edge abuse controls; exact quotas need strong authority | Multi-location bypass/load, 429 and recovery; no approximate hard quotas |
| 31 | Load Balancing | [ ] Planned | Initial provider ingress; later stateless container routing | Health routing/load test without in-memory session affinity |
| 32 | Horizontal Scaling | [ ] Planned | Stateless API, shared DB sessions, bounded pool/queue budgets | Multi-instance correctness and database saturation behavior |
| 33 | Vertical Scaling | [ ] Deferred | Grow DB/compute after profiling, not as query-design substitute | Before/after latency, cost and saturation evidence |
| 34 | Reverse Proxies | [ ] Planned | Same-origin /api route, explicit trusted headers, bounded body/timeouts | No SPA fallback for API; forwarded IP/auth/cache spoof tests |
| 35 | Message Queues | [ ] Deferred provider; outbox planned | Durable job interface; add managed queue when backlog/throughput merits | At-least-once duplicate/out-of-order/visibility-timeout tests |
| 36 | Dead Letter Queues | [ ] Planned job failure state | Exhausted attempts → inspectable failed work; provider DLQ when queue added | Poison job quarantined; authorized audited replay |
| 37 | Background Workers | [ ] Planned | Transactional outbox + leased dispatcher; request lifetime is not durability | Crash/lease expiry/reclaim and duplicate dispatch tests |
| 38 | Job Scheduling | [ ] Planned | Provider scheduler adapter; idempotent overlapping runs | Missed/overlapping ticks, catch-up and DST policy |
| 39 | Event-Driven Architecture | [ ] Planned limited | Domain events/outbox inside monolith; no broker by default | Commit-before-publish, event schema evolution, consumer dedupe |
| 40 | Webhook Verification | [ ] Deferred integration gate | Signature on raw body, freshness/provider policy and scoped secrets | Tamper/replay/wrong secret/raw-body tests before enabling endpoint |
| 41 | Webhook Retries | [ ] Deferred integration gate | Durable receipt before ACK; own bounded outbound retries | Duplicate delivery, lost ACK, exhausted attempt/manual redelivery |
| 42 | Eventual Consistency | [ ] Planned | Saved card authoritative immediately; inbox/presence asynchronous | User-visible pending state and convergence under delayed jobs |
| 43 | Distributed Transactions | [ ] Planned avoidance | Keep canonical write in one DB; outbox/compensation across services | Failure matrix for each external side effect; no false exactly-once claim |
| 44 | Outbox Pattern | [ ] Planned; D1 schema prototype | Same-transaction event; lease/retry/dedupe consumer | Crash before/after publish; no committed work disappears |
| 45 | CQRS | [ ] Deferred infrastructure | Separate read/write functions only; same DB first | Projection lag/rebuild tests if a read store is later adopted |
| 46 | Event Sourcing | [ ] Deferred; not selected | Relational state plus audit history; history is not event sourcing | Separate design review, schema/version replay and rebuild if adopted |
| 47 | Backpressure | [ ] Planned | Bounded payload/page/job batches, deadlines and concurrency | Overload test returns controlled 429/503; backlog stays bounded |
| 48 | Graceful Shutdown | [ ] Planned runtime-specific | Worker deadline-safe jobs; container drain/SIGTERM + leases | Terminate requests/jobs mid-flight; reclaim safely, no lost commit |
| 49 | Health Checks | [ ] Planned | Liveness separate from readiness; bounded private DB dependency check | Dependency outage, timeout and recovery; no secrets in response |
| 50 | Distributed Tracing | [ ] Planned | Request/trace IDs across HTTP/DB/outbox; portable telemetry boundary | Trace one operation end-to-end; sampling/redaction and overhead measured |

## Updating an item

Check a delivery box only with a dated link to code plus relevant test/run evidence. Add environment/commit and limitations. For a provider move, reopen affected items until their acceptance tests pass on the new adapter. Review deferred triggers at each release. Root TASKS.md holds the next small task; this document holds the complete risk map.

## Product scope revision v0.3

The controls above now apply to explicit project grants, Owner/Project Manager administration, private image fetch/upload, exact 24-hour restore/purge and XLSX preview/commit. Revocation races cover project grants; cache/replica policies must not leak sibling projects; outbox/retry/deadline controls also cover invitation email, import jobs and cleanup. See FEATURE_SPEC.md/API.md and the separate 98-item product checklist. Old SQLite checks remain historical and do not mark these selected-stack delivery controls complete.
