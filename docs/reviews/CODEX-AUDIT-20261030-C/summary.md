# Flowboard backend audit summary

## Result

I independently applied and inspected migrations 0001–0016, tested upgrade survival from the 0010 schema, seeded 5,000 cards across 20 boards for query plans, exercised member removal/card purge and direct hard-delete behavior, reviewed invitation email changes at commits `1eda522` and `8cc31e2`, and inspected scheduled-worker isolation/locking.

**The beta is blocked on a production least-privilege runtime role and on a clear card hard-delete privacy boundary.** Most measured plans are fast at the requested seed size, but two broad-scan patterns and activity-feed query fanout need fixing before meaningful scale. Email templating and retry classification passed the focused test suite; delivery is still at-least-once across an external provider send and a failed DB commit.

## Top five risks

1. **Runtime DB superuser (P1):** local compose uses its bootstrap user as runtime; a probe confirmed it can create, alter, truncate, and drop. Production grants were not available to audit. Use a separate DML-only runtime role and a distinct migration owner.
2. **Private data after hard delete (P1):** direct card deletion removes comments/mentions/images but leaves private notification text, stale links and activity title text; outbox entity IDs remain. Ensure all hard deletes route through redaction or are explicitly prevented.
3. **Duplicate invitation emails after crash window (P2):** a provider can accept the email before the DB transaction commits `delivered`. A later retry may send a duplicate. Treat delivery as at-least-once and add provider idempotency where supported.
4. **Query growth (P2):** board loading scans child tables globally for aggregates, notification feeds scan/sort the notification table, and activity feeds query actor profiles per distinct actor. The current synthetic plans were below 100 ms; production-scale behavior was not measured.
5. **Forward-only / blocking migrations (P2):** no rollback scripts exist. Earlier backfills rewrite all matching records and 0009 numbers all cards before building a unique index. Plan batch/online rollout and data recovery before applying to a populated production DB.

## What blocks beta and what can wait

- **Before beta:** provision and verify a least-privilege runtime DB principal for API and Worker; decide/enforce that direct physical card deletes cannot bypass purge/redaction; document provider email as at-least-once and test the provider-accepted/DB-commit-failed window or add idempotency; prepare a production migration/rollback plan for the large backfills.
- **Before scale, but not a blocker on the current 5k-row measurement:** restrict board aggregates to the selected cards, add ordered per-user notification indexing, batch activity actor lookups, and add missing child-side indexes for `project_links.workspace_id` and `board_grants.granted_by`.
- **Can wait for hosted integration:** real Worker cron overlap behavior, actual Hyperdrive role grants, R2 object deletion and backup/erasure retention, and live Brevo provider behavior. These were intentionally not touched in this audit.

## Limits and evidence

“Pass” here means the named local command and output succeeded; it does not imply hosted integration or production approval. The disposable test DB used synthetic data and no external provider or object-store calls. The complete A–F evidence and not-covered items are in [coverage.md](/Users/shubham/Documents/Flowboard/docs/reviews/CODEX-AUDIT-20261030-C/coverage.md); detailed reproductions are in [findings.md](/Users/shubham/Documents/Flowboard/docs/reviews/CODEX-AUDIT-20261030-C/findings.md); command logs and outputs are under `/Users/shubham/Documents/Flowboard/docs/reviews/CODEX-AUDIT-20261030-C/raw/`.

## Final record

- Frozen HEAD: `8cc31e26065b3351b68296a48163778744bd2f6c` (`chore/baseline-2026-10-28`).
- Runtime tools observed: Node `v24.15.0`; npm `11.12.1`; Git `2.54.0 (Apple Git-157)`; Docker client/server `29.6.2` (Docker Desktop `4.83.0`); PostgreSQL `17.11` in image `17-alpine`, digest `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`.
- Non-zero attempts: sandbox Docker/loopback access denied; `psql --version` unavailable (127); one broad `rg` command had shell quoting failure (2); first notification-plan SQL and the notification query embedded in the first plan batch had syntax errors (42601); initial orphan fixture bound an integer position incorrectly (22P02); first DB-role probe hit sandbox `EPERM`; initial email-suite URL failed the repository's local DB guard; final sandbox Docker server-version request was denied. Each relevant probe was corrected/retried where possible; command logs, failed attempts, and rerun results are under `raw/`, with the list in [raw/exit-summary.md](/Users/shubham/Documents/Flowboard/docs/reviews/CODEX-AUDIT-20261030-C/raw/exit-summary.md).
- The disposable container was stopped and removed after evidence capture; cleanup command output is in `raw/db-cleanup.log`.
