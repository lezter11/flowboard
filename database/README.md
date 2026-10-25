# Database status

The original SQLite/D1 schema is preserved under [prototypes/d1/migrations/0001_initial.sql](prototypes/d1/migrations/0001_initial.sql). It is historical executable design evidence, not a production migration or the selected PostgreSQL schema. `python3 scripts/check_schema.py` runs its 11 synthetic SQLite checks.

The v0.2 architecture re-evaluates the database for performance and portability; see [ARCHITECTURE.md](../ARCHITECTURE.md). PostgreSQL migrations and real integration tests are a separate task and do not exist yet. No PostgreSQL, D1, identity provider or queue has been provisioned by this project.

If the D1 alternative is revisited, its mutation_guards CHECK demonstrates turning a zero-row conditional UPDATE into a failed transaction: INSERT changes() immediately after the relevant UPDATE and delete the guard inside the same atomic batch. This is SQLite-local evidence only; actual D1 binding behavior still needs integration verification.

The domain invariants—tenant-scoped foreign keys, optimistic versions, canonical card ordering, atomic receipts/activity/outbox—survive a database change. SQL dialect, transaction execution, migrations and query plans need database-specific implementations and tests. A SQLite pass proves nothing about PostgreSQL locks, isolation levels, query plans or connection pooling.
