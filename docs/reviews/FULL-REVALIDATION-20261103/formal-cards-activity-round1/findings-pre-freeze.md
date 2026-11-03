# Independent pre-freeze findings

Reviewer `collaboration:/root/formal_cards_activity_round1` did not implement target. Source is a provisional focused hold; no broad approval is claimed. Baseline revision917706ae0433df471c72736be4d548eb022236c4 plus uncommitted source is captured in source-before.json. Observation test exit0 is NOT an acceptance pass: assertions intentionally pin observed defects.

## F-CA-01 (P2): Editing a comment retains the old private notification preview

- Acceptance: NTF-01 requires no stale private preview leak. COM-04 edits should not resend notifications; this does not require keeping removed text.
- Reproduction: POST `/api/v1/cards/card/comments` as active Member with body `SYNTHETIC_SECRET_REMOVED_BY_AUTHOR @Retention manager` and selected Manager mention. PATCH `/api/v1/comments/:id` by author, version1, body `Corrected ordinary message`, mentions[]. GET recipient `/api/v1/notifications`. Source is corrected, but returned notification body contains the removed secret.
- Source: apps/api/src/adapters/comments.ts:543-607 updates comments/body/mentions/history but not existing notifications; comments.ts:378-393 copies original body into notification; notifications.ts:119-132 reads that copy.
- Evidence: retention-probe.test.ts first observation; retention-probe-local-pg.log, own command exit0 against disposable loopback55931/import database and own random schema. Initial sandbox EPERM is retained in retention-probe.log and is not counted as a successful DB run.
- Impact: sensitive or incorrect text deliberately removed by author persists in another normal read path; no duplicate notification is required for repair. Redact old preview or synchronize current safe preview in edit transaction, preserving read state/event identity.
- Counterevidence: deleteComment does call redactCommentCopies, so actual tombstones are redacted. Current access filtering hides inbox rows after grant removal. These do not address successful edits.
- Status: observed and sent to Architect for independent confirmation/interpretation; no final verdict until confirmation/freeze.

## F-CA-02 candidate: Canonical comment edit remains outside protected-draft redaction

- Source: comment-state.ts:18-43 creates actor/card sessions and stores a whole fetched body using editDraftFromComment at50-57; card-comments.ts:93 initializes that copy. No registerProtectedDraft call and no session.clear call on scope refusal. The refusal hooks handle cards/boards/projects, not comments; card-fields use protected registration separately.
- Pure-state reproduction: initialize comment edit with canonical fetched body without making any user change; call card/comments refusal redaction, project-scope removal and actor redaction. session.get().edit.body remains canonical fetched body. Own second observation test logs this.
- Impact candidate: after revocation the comment component hides fetched rows but still renders an edit composer with the retained full canonical body. The drawer hides its child on a card404; stored copy may reappear after remount/regrant or if comments refusal precedes card response. Need actual browser denial ordering before declaring a confirmed UI disclosure.
- Counterevidence: actor/card keys prevent another account receiving this session; explicit logout navigates the full document and clears JS memory. Own unsent changed text is deliberately preserved by product policy. Finding concerns fetched unchanged canonical text, not authorized preservation of a user's newly typed draft.
- Status: confirmed in actual Chrome156.0.8078.74: after Owner mounted grant revocation and a real comments404, with other protected responses delayed to force ordinary out-of-order delivery, the comment article disappears but edit combobox remains visible with the unchanged fetched canonical body. No typing occurred. Own browser-comment-retention-v2/result.json + screenshot; own command exit0, sourceChanged[] over five UI files. Architect independent check still requested.

## F-CA-03 (P2): Public card/comment write contracts silently strip unknown fields

- docs/API.md:30 requires unknown fields to fail validation. Own mounted observations returned successful writes for all card create/update/move/move-undo and comment create/edit/delete bodies containing unexpectedField, plus a nested mention with unexpectedField. No injected field influenced authority, and no such privilege escalation is claimed.
- Exact schemas: packages/contracts/src/cards.ts createCardInputSchema/updateCardInputSchema/moveCardInputSchema; discussion.ts mentionSpanSchema/postCommentInputSchema/editCommentInputSchema/deleteCommentInputSchema; apps/api/src/http/routes/cards.ts inline move-undo z.object.
- Evidence: third observation in retention-probe.test.ts and retention-and-contract-probe-local-pg.log (own3 observation tests, exit0, explicit approved55931/import random schemas). Eight successful accepted commands produced eight receipts.
- Status: Architect confirmed strict public unknown-field contract remains required; repair is builder-owned.

## F-CA-04 candidate: Assignee role changes between eligibility validation and assignment commit

- CRD-06 requires currently eligible non-Viewer identities for new assignments. ARCHITECTURE.md:90 explicitly requires locking actor/assignee/mention grants before ordering/card rows.
- Own mounted real separate-connection observation: Owner PATCH card assignment validates active Member, then synthetic BEFORE INSERT trigger blocks actual card_assignees insert on an advisory fence. Concurrent Owner PATCH membership demotes selected recipient to Viewer and commits200. Releasing fence allows assignment200; final assignment joins Viewer. Real writer PID was11724.
- Source: cards.ts validateAssigneeIds uses boardAssigneeIds plain reads; board-assignees.ts reads memberships/grants without locks. Actor authority locks cannot serialize the selected recipient. Role-only demotion in members.ts does not update board coordination row.
- Evidence: assignee-race-probe.test.ts/log, own1 observation test exit0, explicit55931/import random schema cleaned.
- Counterevidence: already assigned people becoming Viewers can be historical; membership removal does serialize through grant cleanup/board update. This probe concerns a newly accepted assignment and role-only demotion. The source validation preceded demotion; interpretation of commit-order linearization requires Architect review before confirmed severity.
- Status: candidate sent to Architect for independent confirmation.

## Invalid excluded execution

focused-existing-tests.log is wholly INVALID and excluded: the command supplied IMPORT/ACCESS/IDENTITY URLs55931 but omitted DATABASE_URL. First alphabetical activity-coverage-b5 uses getPool and defaulted to local55432, completing14 nested tests with random IDs there. Reviewer discovered this while inspecting test connection sources and immediately interrupted runner (exit1). No later legacy TRUNCATE suite appears in retained log. Reviewer did not contact55432 again for cleanup; Architect was informed immediately. This is a reviewer execution mistake and cannot count toward acceptance.

Corrected focused-existing-isolated.log used explicit DATABASE_URL55931/harness AND PGOPTIONS search_path to its own generated schema, with explicit other allowed55931 URLs. Own run127/127 passed, exit0; generated schema dropped. This is focused evidence, not all14 required commands or global formal acceptance.

## F-CA-05 (P2): Notification Open card drops the target card ID

- NTF-02 requires opening the accessible project/card. Backend comments.ts:383 and notifications.ts:317 generate `...?cardId=:id`; inbox/page.tsx:34 appHref only recognizes `?card=`.
- Own actual Chrome156.0.8078.74 mounted observation: real Owner comment mentions real Member; Member inbox Open card href is `/board?id=:board` with no card query; clicking opens board, target card is present but zero card dialogs open.
- Evidence: browser-notification-link.mjs/log and browser-notification-link/result.json+screenshot; exit0, sourceChanged[] for inbox/comments/notifications. PostgreSQL55931/UI own random schema and processes cleaned.
- Counterevidence: board scope is correct and the recipient is authorized. Clicking the card manually works; this does not satisfy notification deep-link behavior. Root product browser checked only notification visibility, not its Open card target.

## Query-parity sweep

Own query-contract-probe.log (exit0, own random approved55931/import schema) observes comments GET accepts limit=1junk/0/101, unknown field and empty cursor200; comment DELETE query expectedVersion=1junk performs deletion200. Search unknown field is stripped200. Strict activity/card/project/workspace/notification unknown-query controls correctly422. Legacy ListQuery OpenAPI notes malformed-bound clamping, so malformed list-limit behavior is not silently treated as a new security finding; Architect must reconcile exact policy/schema semantics. Unknown-field rejection remains an explicit published requirement. All accepted unsafe-shaped writes only caused their normal intended effects; no authority escalation claimed.

Browser evidence correction: original retention JSON/Next log was overwritten by a second script with a reused output path. Original stdout and screenshot remain, but full retention evidence now comes from fresh unique browser-comment-retention-v2/result.json (exit0, sourceChanged[]). Notification run was preserved by renaming its actual output to browser-notification-link/. The executed original scripts retain the path mistake for transparency. Generated Next metadata side effects were cleaned by removing only three own include paths and restoring the initially clean next-env.d.ts path; no product source logic was edited.
