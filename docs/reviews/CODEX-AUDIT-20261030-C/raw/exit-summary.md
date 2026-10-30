# Non-zero command exits

Every command-specific capture has a `.log` with its exact command, output and exit code; DB captures identify loopback port 55634 and the pinned image digest. The initial parallel captures left the aggregate `commands.log` interleaved; use the per-command `.log`/`.out` files as the authoritative individual records.

| Attempt | Exit | Result / recovery |
|---|---:|---|
| Initial sandbox `docker version` / image-list calls | 1 | Docker socket denied by sandbox. Repeated local container operations with authorized escalation; versions/images recorded in `docker-version-elevated.out` and `docker-images-elevated.out`. |
| Sandbox socket bind check for 127.0.0.1:55634 | 1 | `EPERM`; proceeded with a disposable loopback-bound Docker container on that port. |
| `psql --version` | 127 | `psql` absent; used the repository's installed Node `pg` module. |
| First broad source `rg` via a quoted `bash -c` command | 2 | Shell quoting/pattern error; reran focused `rg` calls successfully. |
| First multi-plan command, notification SQL | 1 / PostgreSQL 42601 | Missing closing parenthesis in the audit query; the other plans emitted results; notifications were re-run with corrected SQL in `db-notification-plans-retry.log` (0). |
| First standalone notification plan | 1 / PostgreSQL 42601 | Same missing closing parenthesis; corrected query produced both plans (`db-notification-plans-retry.log`, 0). |
| First orphan fixture | 1 / PostgreSQL 22P02 | Audit fixture passed a title into the integer position parameter; corrected fixture rerun succeeded (`db-orphan-lifecycle-retry.log`, 0). |
| First runtime-role probe in sandbox | 1 / `EPERM` | Node could not open loopback socket in sandbox; same probe rerun with authorized local-only access succeeded (`db-runtime-role-ddl.log`, 0). |
| First invitation-test command | 1 / repository FND-01 guard | Used a non-harness URL without enabling the explicit test-only remote URL guard; reran only against disposable port 55634 with `ALLOW_REMOTE_DB=true` (`db-invitation-test.log`, 0; 17 passed). |
| Final sandbox Docker server-version query | 1 | Docker client answered, server socket denied. Repeated elevated version query succeeded (`docker-version-confirmed.log`, 0). |
| Redundant final sandbox container-list check | 1 | Docker socket denied; an elevated post-cleanup check had already returned no container names (`db-cleanup-verify.log`, 0). |

No failed command contacted a hosted service or altered files outside this audit directory. Expected SQL constraint rejections (`23514`, `23505`, `23503`) are successful audit probes, not command failures.

