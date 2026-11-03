# All 98 feature evidence map — not approval

Baseline `917706ae0433df471c72736be4d548eb022236c4`, changing worktree, 3 November 2026. All 98 IDs are mapped: 74 require UI and 24 are backend-only. [Detailed JSON](evidence-map.json) contains acceptance text, current source/test hashes, entry points, historical traces, evidence links and remaining checks.

I read source, reports and logs. I did not execute product tests, browser, database, cloud or advisory commands. Relevant passing local cases are not a final frozen run or 98 feature approvals. Counts overlap and must not be added.

The user selected **local gates → direct UAT → hosted checks**. There is no dev stage; production is excluded. Hosted-dependent acceptance stays pending after local approval and deployment.

## Remaining gates and addressed gaps

- **MAP-GAP-01 (active_implementation)** — Image verification is still changing. Genuine maximum-size JPEG checks and resource admission require passing evidence on the final source.
- **MAP-GAP-02 (evidence_freshness)** — No complete final frozen API/contracts/web/MCP/artifact/build/browser run existed at this map snapshot. Different partial runs use different targets.
- **MAP-GAP-03 (independent_review)** — No fresh final complete-scope reviews for all 98 features were supplied. Builder handoffs and bounded browser retests are not full-feature approvals.
- **MAP-GAP-04 (addressed_before_review_freeze)** — All eight formal criteria now explicitly require OpenAPI staleness, embedded SQL parity, actual browser integration and mounted/workerd MCP integration: 10 to 14 commands. Acceptance statements and thresholds are unchanged; prior commands and SHA are preserved in additive metadata. Commands still must run.
- **MAP-GAP-05 (partly_addressed_handoff_freshness)** — Root appended current 8-case My Tasks/calendar facts and latest outbox rollback-redaction evidence. Earlier retention BRD-06-open wording is superseded by the later board handoff. Final source hashes and complete run are still required.
- **MAP-GAP-06 (hosted_pending)** — Real Google, Hyperdrive/Neon, private R2/Images, email, cron, proxy and hosted CPU checks remain UAT pending.
- **MAP-GAP-07 (external_access)** — Parent reported a previous GitHub push 403; the user intends to switch the login. Reverify actual write access before publishing.

## Narrowly relevant evidence groups

| Key | Records and logs | What the evidence supports / limits |
|---|---|---|
| runtime | [runtime-validation-transport-repeat.log](raw/runtime-validation-transport-repeat.log), [runtime-validation-result.json](runtime-validation-result.json) | 14/14 actual Node/workerd tests cover protocol, 1,000-card samples, bounded pages and genuine SQL locks/deadlines. A first local request is not a hosted cold start. |
| openapi | [foundation-openapi-inventory-final.log](raw/foundation-openapi-inventory-final.log), [foundation-openapi-check-final-candidate.log](raw/foundation-openapi-check-final-candidate.log), [foundation-contracts-final.log](raw/foundation-contracts-final.log), [foundation-people-result.json](foundation-people-result.json) | Mounted route/schema generation and staleness checks. The recorded older contracts count is 123; a later contracts run reached 126. Neither approves later changes. |
| identity | [identity-repair-targeted-final.log](raw/identity-repair-targeted-final.log), [identity-repair-new-regressions-final.log](raw/identity-repair-new-regressions-final.log), [identity-repair-result.json](identity-repair-result.json) | 126 nearest local tests and 16 new identity/member regressions. Only the cases exercising a feature support that feature. OAuth uses local/provider fixtures, not real Google. |
| invitations | [invitation-repair-new-final.log](raw/invitation-repair-new-final.log), [invitation-repair-targeted-final.log](raw/invitation-repair-targeted-final.log), [invitation-repair-result.json](invitation-repair-result.json) | 12 new mounted invitation cases plus 151 nearest tests cover races, history and delivery state. Real configured email delivery remains UAT pending. |
| people | [foundation-people-mounted-green.log](raw/foundation-people-mounted-green.log), [people-directory-legacy.log](raw/people-directory-legacy.log), [foundation-people-result.json](foundation-people-result.json) | 8 mounted People/OpenAPI tests and 45 prior role/board-access cases cover Owner/Manager directory access and separate board-scoped pickers. |
| boards | [boards-lifecycle-round4.log](boards-lifecycle-round4.log), [boards-lifecycle-existing-round1.log](boards-lifecycle-existing-round1.log), [boards-lifecycle-handoff.json](boards-lifecycle-handoff.json) | 45 board/import/retention/workerd cases and 83 nearest tests cover soft columns, lifecycle versions and bounded snapshots/placement. Later card/import changes require a rerun. |
| retention | [lifecycle-retention-final.log](lifecycle-retention-final.log), [lifecycle-retention-handoff.json](lifecycle-retention-handoff.json) | 14 bounded comment/inbox retention, locking and migration cases. This alone does not establish every trash acceptance condition. |
| discussion | [discussion-activity-targeted-final.log](raw/discussion-activity-targeted-final.log), [discussion-activity-legacy-final.log](raw/discussion-activity-legacy-final.log), [discussion-activity-result.json](discussion-activity-result.json) | 8 focused and 89 nearest mounted tests cover mention eligibility, UTF-16 spans, renamed actors, no edit re-notification and safe activity date queries. |
| cursors | [cursor-integrity-final-v4.log](raw/cursor-integrity-final-v4.log), [cursor-integrity-legacy-final-v3.log](raw/cursor-integrity-legacy-final-v3.log), [cursor-integrity-result.json](cursor-integrity-result.json) | 38 final v4 mounted cursor tests. The 115 nearest cases explicitly used earlier v3 source. Covers microseconds, calendar dates, context binding and malformed input. |
| mytasks-calendar | [root-calendar-query-outbox-green.log](raw/root-calendar-query-outbox-green.log), [my-tasks-handoff.md](my-tasks-handoff.md) | 10 cases total: 8 My Tasks/calendar and 2 outbox, not 10 per feature. Adapter reads stayed 7 across 1 versus 3 boards; shared date/timezone and workspace validation are exercised. |
| undo-ranks | [undo-nearest-final.log](raw/undo-nearest-final.log) | 29 nearest mounted card/Undo/locking tests include 7 new cases. Numeric rank ordering and at most 2 materialized neighbor rows are measured. |
| outbox | [outbox-savepoint-redaction-green.log](raw/outbox-savepoint-redaction-green.log), [outbox-recovery-handoff.md](outbox-recovery-handoff.md) | 16 cases total: 2 SQL poison/recovery/consumer cases and 14 retention cases. Rollback privacy sanitization is re-applied. No external exactly-once guarantee is claimed. |
| import | [import-repair-final.log](import-repair-final.log), [genuine-template-import-green-1.log](raw/genuine-template-import-green-1.log), [genuine-template-empty-elements-green.log](raw/genuine-template-empty-elements-green.log), [import-repair-handoff.json](import-repair-handoff.json) | Earlier 16 import/workerd cases; later 20 genuine-template cases; final 6 mapping, provenance, query and self-closing XML cases. These overlap and are not summed. |
| images | [image-full-verifier-final.log](raw/image-full-verifier-final.log), [image-integrity-nearest-final-runtime.log](raw/image-integrity-nearest-final-runtime.log), [jpeg-complexity-probe.json](raw/jpeg-complexity-probe.json), [image-integrity-handoff.json](image-integrity-handoff.json) | Earlier full-verifier passes are intermediate. JPEG completeness, valid maximum-input budgets and admission are still changing. The retained complexity probe refused valid 20 MP inputs; no current image closure. |
| authorization | [route-auth-matrix-final-bindings.log](raw/route-auth-matrix-final-bindings.log), [route-auth-matrix-result.json](route-auth-matrix-result.json) | 466 test assertions represent 465 HTTP cells across 103 operations: 432 expected denials, 6 positive PAT cases, 9 public/optional cases and 23 additional private-read operations. This is not every role/route combination. |
| cookie-mutations | [cookie-mutation-typed.json](raw/cookie-mutation-typed.json), [cookie-mutation-result.json](cookie-mutation-result.json) | 55 tests represent 348 requests: 295 denials and 53 positive controls across 48 selected operations. Denials compare all table/sequence/storage effects. |
| browser-product | [browser-product-result.json](browser-product-result.json), [browser-product-result.md](browser-product-result.md) | 11 distinct Chrome/API/PostgreSQL flow groups across moving-source runs 04–07, not a single final frozen run. Memory storage and provider fixtures remain local substitutes. |
| browser-extended | [results.json](raw/browser-extended-1/results.json) | Actual browser Move/Undo, nested focus/inert behavior, 15 Tab presses, 360 px drawer and settings Back/draft checks. Named results are not all separate asserted groups. |
| checkpoint | [result.json](frontend-checkpoint/retest-2/result.json), [private-memory-result.json](frontend-checkpoint/retest-2/raw/private-memory-result.json), [summary.md](frontend-checkpoint/retest-2/summary.md), [ui-checkpoint-implementation.json](ui-checkpoint-implementation.json) | Bounded fresh independent retest: 315 web tests, 23 memory assertions and 4 browser/API/PostgreSQL groups. No full-feature score or release approval. Of 367 inputs, only a generated Next route reference changed. |
| mcp | [mcp-ci-script.json](raw/mcp-ci-script.json), [mcp-ci-script.log](raw/mcp-ci-script.log) | 22 local installed-dependency mounted/Pages-proxy/workerd groups cover scoped PATs, grants, lost replies, concurrency, receipt replay and revocation. No deployed Claude acceptance. |
| card-lifecycle | [undo-nearest-final.log](raw/undo-nearest-final.log) | The 29-test Undo-nearest log explicitly includes CRD-01 through CRD-11: lightweight summary, fields, dates, assignees, movement, conflicts and receipts. These are relevant local cases, not a full-feature approval. |
| ui-comment | [ui-comment-implementation.json](ui-comment-implementation.json), [ui-comment-repair-criteria.json](ui-comment-repair-criteria.json) | UI owner implementation phase comment: relevant source/tests and actual commands are recorded in its handoff. The final combined web suite reached 315; this is not per-feature or hosted approval. |
| ui-board | [ui-board-implementation.json](ui-board-implementation.json), [ui-board-repair-criteria.json](ui-board-repair-criteria.json) | UI owner implementation phase board: relevant source/tests and actual commands are recorded in its handoff. The final combined web suite reached 315; this is not per-feature or hosted approval. |
| ui-invitation | [ui-invitation-implementation.json](ui-invitation-implementation.json), [ui-invitation-repair-criteria.json](ui-invitation-repair-criteria.json) | UI owner implementation phase invitation: relevant source/tests and actual commands are recorded in its handoff. The final combined web suite reached 315; this is not per-feature or hosted approval. |
| ui-feed | [ui-feed-implementation.json](ui-feed-implementation.json), [ui-feed-repair-criteria.json](ui-feed-repair-criteria.json) | UI owner implementation phase feed: relevant source/tests and actual commands are recorded in its handoff. The final combined web suite reached 315; this is not per-feature or hosted approval. |
| ui-import | [ui-import-implementation.json](ui-import-implementation.json), [ui-import-repair-criteria.json](ui-import-repair-criteria.json) | UI owner implementation phase import: relevant source/tests and actual commands are recorded in its handoff. The final combined web suite reached 315; this is not per-feature or hosted approval. |
| ui-preferences | [ui-preferences-implementation.json](ui-preferences-implementation.json), [ui-preferences-repair-criteria.json](ui-preferences-repair-criteria.json) | UI owner implementation phase preferences: relevant source/tests and actual commands are recorded in its handoff. The final combined web suite reached 315; this is not per-feature or hosted approval. |
| ui-card-safety | [ui-card-safety-implementation.json](ui-card-safety-implementation.json), [ui-card-safety-repair-criteria.json](ui-card-safety-repair-criteria.json) | UI owner implementation phase card-safety: relevant source/tests and actual commands are recorded in its handoff. The final combined web suite reached 315; this is not per-feature or hosted approval. |
| ui-contract-followup | [ui-contract-followup-implementation.json](ui-contract-followup-implementation.json), [ui-contract-followup-criteria.json](ui-contract-followup-criteria.json) | UI owner implementation phase contract-followup: relevant source/tests and actual commands are recorded in its handoff. The final combined web suite reached 315; this is not per-feature or hosted approval. |
| ui-draft-restoration | [ui-draft-restoration-implementation.json](ui-draft-restoration-implementation.json), [ui-draft-restoration-criteria.json](ui-draft-restoration-criteria.json) | UI owner implementation phase draft-restoration: relevant source/tests and actual commands are recorded in its handoff. The final combined web suite reached 315; this is not per-feature or hosted approval. |
| ui-final-scope | [ui-final-scope-implementation.json](ui-final-scope-implementation.json), [ui-final-scope-repair-criteria.json](ui-final-scope-repair-criteria.json) | UI owner implementation phase final-scope: relevant source/tests and actual commands are recorded in its handoff. The final combined web suite reached 315; this is not per-feature or hosted approval. |
| ui-checkpoint | [ui-checkpoint-implementation.json](ui-checkpoint-implementation.json), [ui-checkpoint-repair-criteria.json](ui-checkpoint-repair-criteria.json) | UI owner implementation phase checkpoint: relevant source/tests and actual commands are recorded in its handoff. The final combined web suite reached 315; this is not per-feature or hosted approval. |

## Per-feature checklist for the fresh reviewer

All rows still require fresh final independent review. Group keys refer to the table above; they do not mark a feature passed. Source/test paths and candidate routes are in the JSON. Historical discovery lines are not asserted to be current.

| ID | Feature | Relevant evidence group | Remaining phase |
|---|---|---|---|
| FND-01 | Local backend harness | runtime | Backend review; related hosted checks where applicable |
| FND-02 | Shared API schemas and fixtures | openapi, mcp | Backend review; related hosted checks where applicable |
| FND-03 | PostgreSQL schema and migrations | Source/test trace; final execution evidence required | Backend review; related hosted checks where applicable |
| FND-04 | Failure and observability baseline | runtime | Backend review; related hosted checks where applicable |
| ACC-01 | Sign in and session | identity | UI + UAT acceptance pending |
| ACC-02 | Sign out and expired session | identity, checkpoint, ui-card-safety, ui-contract-followup, ui-draft-restoration, ui-checkpoint | UI + UAT acceptance pending |
| ACC-03 | Profile and historical identity | identity, ui-preferences, ui-draft-restoration | UI + UAT acceptance pending |
| ACC-04 | Personal workspace and owner | identity | UI + UAT acceptance pending |
| ACC-05 | Workspace preferences | mytasks-calendar, browser-extended, ui-preferences, ui-final-scope | UI + UAT acceptance pending |
| ACC-06 | Owned and invited project switcher | ui-checkpoint | UI + UAT acceptance pending |
| ACC-07 | Ownership transfer retirement | identity | UI + UAT acceptance pending |
| PRJ-01 | Create multiple projects | identity, browser-product, ui-draft-restoration | UI + UAT acceptance pending |
| PRJ-02 | Project list and navigation | cursors, checkpoint, ui-final-scope, ui-checkpoint | UI + UAT acceptance pending |
| PRJ-03 | Project settings | browser-product | UI + UAT acceptance pending |
| PRJ-04 | Archive and reopen project | identity, invitations, browser-product, ui-draft-restoration | UI + UAT acceptance pending |
| PRJ-05 | Project people directory | people | UI + UAT acceptance pending |
| INV-01 | Project invitation | invitations, browser-product, ui-invitation, ui-checkpoint | UI + UAT acceptance pending |
| INV-02 | Invitation delivery | invitations, browser-product, ui-invitation, ui-contract-followup | UI + UAT acceptance pending |
| INV-03 | Accept matching invitation | invitations | UI + UAT acceptance pending |
| INV-04 | Resend and revoke invitation | invitations, browser-product, ui-invitation | UI + UAT acceptance pending |
| INV-05 | Pending invitations list | invitations, cursors, browser-product, ui-invitation, ui-contract-followup | UI + UAT acceptance pending |
| INV-06 | Change member roles | identity, cookie-mutations, ui-board | UI + UAT acceptance pending |
| INV-07 | Remove project access | identity, cookie-mutations, ui-board | UI + UAT acceptance pending |
| INV-08 | Leave a project | identity, invitations | UI + UAT acceptance pending |
| RBAC-01 | Owner manager member viewer matrix | identity, people, authorization, cookie-mutations, mcp | Backend review; related hosted checks where applicable |
| RBAC-02 | Project ancestry enforcement | authorization, cookie-mutations, mcp | Backend review; related hosted checks where applicable |
| RBAC-03 | Revocation versus writes | identity, invitations, authorization, cookie-mutations, browser-product, mcp | Backend review; related hosted checks where applicable |
| RBAC-04 | Picker and notification privacy | people, discussion, authorization | Backend review; related hosted checks where applicable |
| RBAC-05 | Explicit board access disclosure | invitations, authorization, cookie-mutations, browser-product, ui-checkpoint | UI + UAT acceptance pending |
| BRD-01 | Create board | boards, browser-product, ui-draft-restoration | UI + UAT acceptance pending |
| BRD-02 | Board list and settings | boards, checkpoint, mcp, ui-board, ui-draft-restoration | UI + UAT acceptance pending |
| BRD-03 | Bounded consistent board snapshot | boards, ui-board | UI + UAT acceptance pending |
| BRD-04 | Add and rename columns | boards, browser-product, ui-board, ui-draft-restoration | UI + UAT acceptance pending |
| BRD-05 | Reorder columns | boards, browser-product, ui-board, ui-draft-restoration | UI + UAT acceptance pending |
| BRD-06 | Remove empty column | boards, browser-product, ui-board | UI + UAT acceptance pending |
| BRD-07 | Card pagination and column counts | boards, ui-board | UI + UAT acceptance pending |
| BRD-08 | Archive and reopen board | boards, browser-product, ui-board | UI + UAT acceptance pending |
| CRD-01 | Quick create card | browser-product, checkpoint, mcp, card-lifecycle, ui-comment, ui-card-safety, ui-checkpoint | UI + UAT acceptance pending |
| CRD-02 | Compact card summary | card-lifecycle | UI + UAT acceptance pending |
| CRD-03 | Open detail dialog and deep link | browser-product, browser-extended, card-lifecycle | UI + UAT acceptance pending |
| CRD-04 | Edit title and description | card-lifecycle | UI + UAT acceptance pending |
| CRD-05 | Priority and due date | mytasks-calendar, card-lifecycle, ui-final-scope | UI + UAT acceptance pending |
| CRD-06 | Assign project teammates | browser-product, card-lifecycle | UI + UAT acceptance pending |
| CRD-07 | Drag across and within columns | boards, undo-ranks, browser-extended, card-lifecycle, ui-board | UI + UAT acceptance pending |
| CRD-08 | Click tap and keyboard Move | boards, undo-ranks, browser-extended, card-lifecycle, ui-board | UI + UAT acceptance pending |
| CRD-09 | Filtered movement | boards, card-lifecycle, ui-board | UI + UAT acceptance pending |
| CRD-10 | Concurrent edits and move conflicts | undo-ranks, card-lifecycle, ui-board, ui-card-safety | UI + UAT acceptance pending |
| CRD-11 | Save pending errors and unsaved drafts | browser-product, checkpoint, card-lifecycle, ui-comment, ui-card-safety, ui-draft-restoration, ui-checkpoint | UI + UAT acceptance pending |
| CRD-12 | Move undo | undo-ranks, browser-extended, ui-card-safety | UI + UAT acceptance pending |
| COM-01 | Comment read and pagination | discussion, cursors, ui-comment | UI + UAT acceptance pending |
| COM-02 | Post comment | discussion, browser-product, ui-comment | UI + UAT acceptance pending |
| COM-03 | Mention project teammate | discussion, browser-product, ui-comment | UI + UAT acceptance pending |
| COM-04 | Edit own comment | discussion, ui-comment | UI + UAT acceptance pending |
| COM-05 | Delete and moderate comment | retention, discussion, ui-comment | UI + UAT acceptance pending |
| COM-06 | Independent comment drafts | ui-comment | UI + UAT acceptance pending |
| ATT-01 | Image upload staging | images, browser-product, ui-final-scope | UI + UAT acceptance pending; image repair active |
| ATT-02 | Validate and finalize image | images | Backend review; related hosted checks where applicable; image repair active |
| ATT-03 | Card image gallery | images, browser-product, ui-final-scope | UI + UAT acceptance pending; image repair active |
| ATT-04 | Private image delivery | images, browser-product | Backend review; related hosted checks where applicable; image repair active |
| ATT-05 | Remove attached image | images, browser-product, ui-final-scope | UI + UAT acceptance pending; image repair active |
| ATT-06 | Orphan cleanup and storage limits | images | Backend review; related hosted checks where applicable; image repair active |
| ATT-07 | Attachment lifecycle in trash | retention, images | Backend review; related hosted checks where applicable; image repair active |
| AUD-01 | Card activity timeline | discussion, cursors, ui-comment | UI + UAT acceptance pending |
| AUD-02 | Field and movement history | discussion, mcp | Backend review; related hosted checks where applicable |
| AUD-03 | Owner cross-project activity | discussion, cursors, browser-product, ui-final-scope | UI + UAT acceptance pending |
| AUD-04 | Manager and member audit scopes | discussion, cursors, ui-final-scope | UI + UAT acceptance pending |
| AUD-05 | Lifecycle import and image events | import | Backend review; related hosted checks where applicable |
| AUD-06 | Append-only history and redaction | retention, outbox | Backend review; related hosted checks where applicable |
| DEL-01 | Delete card with 24-hour recovery | retention | UI + UAT acceptance pending |
| DEL-02 | Project trash list | retention, cursors, ui-feed | UI + UAT acceptance pending |
| DEL-03 | Restore before deadline | retention | UI + UAT acceptance pending |
| DEL-04 | Restore destination conflict | retention | UI + UAT acceptance pending |
| DEL-05 | Expired restore denial | retention | Backend review; related hosted checks where applicable |
| DEL-06 | Purge and restore races | retention | Backend review; related hosted checks where applicable |
| DEL-07 | Content purge and audit retention | retention | Backend review; related hosted checks where applicable |
| DEL-08 | Deleted card interaction guards | retention, ui-card-safety, ui-checkpoint | UI + UAT acceptance pending |
| IMP-01 | Download Excel template | import, browser-product, ui-import | UI + UAT acceptance pending |
| IMP-02 | Choose authorized import target | import, ui-import, ui-draft-restoration | UI + UAT acceptance pending |
| IMP-03 | Bounded literal workbook parsing | import, ui-import | Backend review; related hosted checks where applicable |
| IMP-04 | Map and validate template fields | import, browser-product, ui-import, ui-contract-followup, ui-draft-restoration | UI + UAT acceptance pending |
| IMP-05 | Preview new existing and conflict rows | import, browser-product, ui-import | UI + UAT acceptance pending |
| IMP-06 | Explicit atomic confirmation | import, browser-product, ui-import | UI + UAT acceptance pending |
| IMP-07 | External ID and retry deduplication | import, ui-import | Backend review; related hosted checks where applicable |
| IMP-08 | Date and multi-assignee conversion | import, ui-import | Backend review; related hosted checks where applicable |
| IMP-09 | Results and safe error download | import, browser-product, ui-import, ui-contract-followup | UI + UAT acceptance pending |
| IMP-10 | Cancel expire and clean preview | import, browser-product, ui-import | UI + UAT acceptance pending |
| IMP-11 | Import provenance and activity | import, browser-product, ui-import, ui-contract-followup | UI + UAT acceptance pending |
| NTF-01 | Durable in-app mention inbox | retention, discussion, browser-product, ui-feed | Backend review; related hosted checks where applicable |
| NTF-02 | Inbox read state and deep link | retention, cursors, browser-product, ui-feed | UI + UAT acceptance pending |
| NTF-03 | Outbox retry and failed-work recovery | outbox | Backend review; related hosted checks where applicable |
| QRY-01 | Project-scoped search | boards, mcp, card-lifecycle, ui-board | UI + UAT acceptance pending |
| QRY-02 | Assignee priority date column filters | boards, card-lifecycle, ui-board | UI + UAT acceptance pending |
| QRY-03 | My assigned tasks in selected project | mytasks-calendar, browser-product, ui-feed, ui-final-scope | UI + UAT acceptance pending |
| UX-01 | Empty loading failed and forbidden states | browser-product, browser-extended, checkpoint, ui-comment, ui-board, ui-invitation, ui-feed, ui-import, ui-preferences, ui-card-safety, ui-draft-restoration, ui-final-scope, ui-checkpoint | UI + UAT acceptance pending |
| UX-02 | Accessible movement and dialog | browser-product, browser-extended, checkpoint, ui-comment, ui-board, ui-invitation, ui-feed, ui-import, ui-preferences, ui-card-safety, ui-checkpoint | UI + UAT acceptance pending |
| UX-03 | Narrow viewport and long content | browser-extended, ui-card-safety | UI + UAT acceptance pending |
| UX-04 | Refresh reconnect and safe polling | browser-product, browser-extended, checkpoint, ui-comment, ui-board, ui-invitation, ui-feed, ui-import, ui-preferences, ui-card-safety, ui-draft-restoration, ui-final-scope, ui-checkpoint | UI + UAT acceptance pending |
| UX-05 | Performance and full workflow acceptance | runtime | Backend review; related hosted checks where applicable |

## Validation commands — not executed by this mapper

After the independent reviewer actually completes the frozen criteria, source trace, mandatory commands, category reasoning and preserved identity/evidence:

```sh
python3 scripts/generate_review_record.py --init docs/reviews/FULL-REVALIDATION-20261103/criteria/<scope>.json -o docs/reviews/FULL-REVALIDATION-20261103/<scope>-draft-round-1.json
# Reviewer completes the draft with real evidence and complete scopeRoots.
python3 scripts/generate_review_record.py docs/reviews/FULL-REVALIDATION-20261103/<scope>-draft-round-1.json -o docs/reviews/FULL-REVALIDATION-20261103/<scope>-round-1.json --validate
python3 scripts/check_backend_review.py docs/reviews/FULL-REVALIDATION-20261103/<scope>-round-1.json --feature <FEATURE-ID>
# Only after passing review and genuine role-owned handoff updates:
python3 scripts/render_feature_checklist.py
```

The validator checks declared file coverage/hashes, evidence, commands, independence declarations, fixed category floors and the strict score threshold. It cannot prove honesty, identity, complete dependency tracing or test execution. UI/integration handoffs must bind the current backend review bytes; integration also binds required UI handoff bytes. Changing a reviewed file invalidates the applicable approval.

## Limits that must remain visible

- One Node oversized import reset under contention remains recorded. A later solo pass does not prove every such request always receives JSON 413.
- HTTP deadlines stop waiting; they do not cancel SQL. Genuine test-only SQL continuation was observed. Worker pool shutdown waited for the query.
- Missing Worker database binding returns a pre-middleware 500 configuration response without the usual request ID.
- Local first-request/warm samples are not hosted cold starts, p95/p99 latency or Free-plan CPU evidence.
- Large historical directory/name-disambiguation performance is not benchmarked; selected mention eligibility is bounded to 20 IDs.

## Future company API

Current MCP is local stdio, with a human-bound scoped PAT calling the card API. Company installation/service identities and durable external compliance-issue deduplication are future work. A seven-day receipt protects retries inside that window; it does not supply lifetime business-event deduplication.

## Next

Finish the image work; run all required commands on stable source; obtain fresh independent reviews and genuine handoffs; reverify GitHub write access; deploy only UAT; finish hosted acceptance. No score, checkbox, application source or existing handoff was changed by this map.
