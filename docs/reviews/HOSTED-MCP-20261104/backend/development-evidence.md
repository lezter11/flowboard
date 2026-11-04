# Preserved development outcomes

These are builder observations, not independent findings or approval. All checks used synthetic fixtures; no raw credential/private environment file is included.

| Stage | Actual observed outcome and disposition |
|---|---|
| Tests written before implementation | Focused test command failed because hosted route module did not exist. This was an initial missing-module red, not behavioral acceptance. |
| Initial static check | Failed on erasableSyntaxOnly parameter properties and Hono test generic typing; repaired without changing scope. |
| First PostgreSQL attempts | Default sandbox blocked loopback with EPERM. Authorized isolated test execution proceeded after sandbox escalation; there was no automatic approval rejection. |
| Synthetic setup | Initial fixtures lacked required timestamps/timezone and membership ID/workspace. Corrected fixtures; no production code or live database changed for these errors. |
| Initial functional suite | 8/8 passed against isolated PostgreSQL. |
| Expanded suite | 17/18 passed; the sole failure was the membership fixture ID. After correcting that fixture, 18/18 passed. |
| Paging/cap/loopback expansion | 24/24 passed. Static checks found one test-only Hono Bindings generic mismatch, corrected. |
| Declared browser Origin regression | Actual red: foreign Origin registration returned201 instead of403. Added explicit protocol-Origin refusal; regression passes. |
| Absolute token lifetime regression | Actual red: renewal near family expiry still reported900 seconds. SQL now reports remaining clamped token lifetime; regression passes. |
| Revoked project metadata regression | After making the fixture self-contained, actual red: connection settings returned a newly changed private project name after membership removal. Projection now returns `Unavailable project`; regression passes. |
| First component snapshot | 27/27 passed; exact retained log is `round-1/focused.log`. No full application or hosted acceptance is inferred. |
| Independent review persistence repair | The parent added mandatory persistence/lifetime fields to shared schemas after review identified unclear continuing-access consent. Two new real PostgreSQL regressions failed because the old projection no longer satisfied the strict schema (GET500 versus200). Added only truthful consent/connection projection fields; conditional refresh issuance is unchanged. Both continuing and access-only requests passed, including assertions that only the former receives a refresh token. That29-test snapshot/log remains under `round-2/`. |
| Independent operations retention repair | Accepted scope extension recorded before implementation in `docs/decisions/2026-11-04-hosted-mcp-retention.md`. Actual red: allow/deny state remained instead of NULL. New cleanup module initially absent. Implemented bounded scheduled deletion/redaction with supporting indexes while retaining code/refresh families. First combined run37/39 failed solely because actual scheduled-entry fixtures omitted the existing mandatory image-storage binding; added a synthetic empty bucket, after which39/39 passed. Added hard100cap and Worker pool-settlement tests;42/42 now pass. Prior29-test target remains under `round-2/`. |

The new retention test invokes the actual Worker scheduled function under Node with an isolated PostgreSQL schema. It does not claim native workerd/provider cron execution or measured hosted backlog drain time. The controlled cleanup failure rolled back its transaction, was reported by job name, and did not prevent the later real rate-window cleanup job.

Transport assembly temporarily lacked the newly requested `onMcpWorkLifetime` option while Worker wiring was being added. Root typecheck correctly failed on that missing option; after the transport owner added the callback contract, root typecheck passed. The current source and static log include both sides of the interface.

Timeboxed OAuth-child body repair: the independent preserved probe confirmed that the generic1MiB buffer preceded both the16KiB child reader and its deadline. The early middleware and generic bypass were coordinated with the application owner. Initial mounted regression run passed12/13; an already-aborted cached-state fast path returned400 without cancelling its source. Fixed that cancellation path and obtained13/13. The combined runner then passed55/55, exit0, retained in `logs/focused.log`. The initial test-wrapper Promise-or-Response type error was corrected and root typecheck passed before the final cancellation-only adjustment. The parent's final record-only instruction prevents a further static run in this timebox; next resume must perform fresh complete static/regression checks and independent acceptance on the final held target. No threshold, test skip or timeout budget was raised.

Concurrent parent/transport edits briefly caused unrelated missing-module and exactOptionalPropertyTypes errors while those files were being built. The final root typecheck recorded in `logs/static.log` passes; those transient failures were not hidden or counted as OAuth behavioral passes.
