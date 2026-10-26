# Frontend functional behavior checklist

Date: 2026-10-26. Status: **planning only; every case is unverified**. Read the [behavior specification](FRONTEND_BEHAVIOR_SPEC.md) for scope, decisions, failure handling and evidence requirements. The [98 product units](features.tsv) remain the product source of truth and the existing [B/U/I checklist](FEATURE_CHECKLIST.md) remains the delivery gate.

Inventory: **214 cases across 20 areas** — 165 derived contract cases and 49 proposed safeguards. All **98 product IDs** are mapped, including all **74 requiring a standalone UI handoff**. Mapping a unit is traceability, not proof of complete implementation or testing.

Each case has a stable FE ID, contract basis and proposed test priority. **C** = derived from the existing product/API contract; **P** = proposed reliability safeguard to agree before implementing. **P0/P1/P2** = critical, normal and additional hardening coverage. A mapped backend-only unit means the browser must handle its outcome; it does not create a standalone UI or claim to verify the server invariant. All cases need evidence before checking. Visual styling is outside this checklist.

## Navigation, links and browser history

- [ ] **FE-NAV-01** · C/P0 · ACC-01, CRD-03 — Open a copied protected card URL without a session: sign-in is required and no cached card title/body is displayed.
- [ ] **FE-NAV-02** · C/P1 · CRD-03 — Open an authorized card link in a fresh tab and hard-refresh it: load the same saved card independently of prior board memory.
- [ ] **FE-NAV-03** · P/P1 · CRD-03, UX-04 — Open card A then B and use Back/Forward: URL, selected card, project and displayed details stay synchronized.
- [ ] **FE-NAV-04** · C/P1 · CRD-03, UX-02 — Close details: preserve relevant board/filter context and return focus to the originating card or a valid nearby control if it disappeared.
- [ ] **FE-NAV-05** · P/P1 · UX-01, CRD-03 — Invalid, missing, duplicated or unsupported route/query values produce a controlled result; no uncaught exception or redirect loop.
- [ ] **FE-NAV-06** · C/P0 · RBAC-02, PRJ-02 — Guess a sibling project/board/card URL: show private unavailable state without exposing resource names or a distinct existence signal.
- [ ] **FE-NAV-07** · P/P0 · ACC-02, RBAC-04 — Restore a page with browser Back after logout/account change: revalidate and clear app-controlled stale private content before enabling interaction.
- [ ] **FE-NAV-08** · P/P1 · CRD-11, COM-06 — Navigate internally with dirty fields/comment: offer deliberate keep/discard behavior; choosing keep does not change route or lose the draft.
- [ ] **FE-NAV-09** · P/P1 · CRD-11, UX-04 — Reload/close the tab: use available browser safeguards, but never promise reliable custom unload handling or persistent draft recovery without an agreed policy.
- [ ] **FE-NAV-10** · P/P1 · UX-01 — Every rendered button/link/menu item has an implemented action or deliberate unavailable state; nested controls do not also trigger their parent action.

## Authentication, accounts and context isolation

- [ ] **FE-AUTH-01** · C/P0 · ACC-01 — Show sign-in success only after verified session establishment; an email string, role selector or callback URL alone cannot select another account.
- [ ] **FE-AUTH-02** · P/P0 · ACC-01 — Provider denial, canceled sign-in, blocked popup where used and malformed/expired callback recover safely without a false authenticated state.
- [ ] **FE-AUTH-03** · P/P0 · ACC-01 — A return-to destination is an authorized in-app route; external or malformed redirect input cannot navigate through a trusted-looking login flow.
- [ ] **FE-AUTH-04** · C/P0 · ACC-02 — A 401 locks protected actions, stops repeat failures and offers sign-in; refetching data must not continue indefinitely with the expired session.
- [ ] **FE-AUTH-05** · P/P0 · ACC-02, CRD-11 — On expiry, quarantine authorized in-memory drafts; reveal them only after the same actor and current project permission are verified; never auto-submit.
- [ ] **FE-AUTH-06** · C/P0 · ACC-02 — Explicit sign-out uses the server logout operation and accepts its 204 empty response; do not parse JSON blindly or retain an active private screen.
- [ ] **FE-AUTH-07** · P/P0 · ACC-02 — If sign-out response is lost, distinguish local screen lock from confirmed server-session revocation; retry safely and do not claim other sessions were revoked.
- [ ] **FE-AUTH-08** · P/P0 · ACC-02, ACC-06 — Account change/logout clears private query/router/UI state and object URLs; the next actor cannot see or submit the previous actor's drafts.
- [ ] **FE-AUTH-09** · C/P0 · ACC-06, PRJ-02 — An owner invited to someone else's project sees only that granted scope there; ownership of their own workspace grants no extra authority.
- [ ] **FE-AUTH-10** · C/P0 · ACC-06, RBAC-04 — Switch projects while old requests are pending: clear prior private context and ignore late results, notifications and people responses from the old project.
- [ ] **FE-AUTH-11** · P/P0 · ACC-02, UX-04 — If another tab changes authentication, the current tab revalidates on notification/focus or next request and stops exposing obsolete account state.
- [ ] **FE-AUTH-12** · C/P0 · RBAC-01, RBAC-03 — Demotion/removal while a menu/dialog is open disables newly forbidden actions when learned; a server denial is handled even if controls were previously enabled.

## Requests, response races and client state

- [ ] **FE-DATA-01** · P/P0 · RBAC-04, UX-04 — Query/cache identities include actor and relevant workspace/project/board/filter/page scope; identical card titles or local indices never merge private resources.
- [ ] **FE-DATA-02** · C/P1 · QRY-01, UX-04 — Search A then B with A responding last: only B may replace the current results; debouncing alone is not race protection.
- [ ] **FE-DATA-03** · P/P1 · CRD-03, UX-04 — Open details A then B with A slower: A's response cannot replace B or mark B's form saved.
- [ ] **FE-DATA-04** · C/P0 · CRD-10, UX-04 — An older poll/read arriving after a confirmed write cannot overwrite the newer resource version shown to the user.
- [ ] **FE-DATA-05** · P/P0 · CRD-07, CRD-10 — A failed optimistic mutation reconciles affected resources without restoring a stale whole-board snapshot over a different successful update.
- [ ] **FE-DATA-06** · C/P1 · BRD-07, COM-01 — Repeated Load more activation sends controlled page requests and deduplicates by stable IDs without dropping legitimate rows.
- [ ] **FE-DATA-07** · C/P1 · BRD-07, QRY-02 — Filter/context changes invalidate old page cursors; pages from the previous filter are never appended to the new list.
- [ ] **FE-DATA-08** · C/P1 · BRD-07 — A stale cursor conflict refreshes the affected snapshot deliberately; never silently restart pagination and present duplicated or skipped cards as complete.
- [ ] **FE-DATA-09** · P/P1 · UX-04 — Leaving a view cancels obsolete reads where supported and ignores remaining late callbacks; cancellation does not create an unhandled promise rejection.
- [ ] **FE-DATA-10** · P/P0 · FND-02, UX-01 — Malformed/partial/wrong-schema responses become a recoverable contract error, not undefined-property crashes, fabricated default records or successful saves.
- [ ] **FE-DATA-11** · C/P0 · UX-04, CRD-11 — Refetch after success/replay uses canonical resource data; historical receipt versions do not overwrite newer edits or clear a newer unsent draft.
- [ ] **FE-DATA-12** · P/P1 · BRD-03, UX-03 — Insert/remove/reorder items without reusing another card's form/menu state; stable resource IDs drive list identity rather than array position.

## Network failures, retries and uncertain outcomes

- [ ] **FE-NET-01** · P/P0 · FND-04, UX-01 — Treat non-2xx HTTP responses as failures even when fetch resolves; HTML/invalid JSON responses never trigger a success toast.
- [ ] **FE-NET-02** · C/P0 · CRD-11, UX-01 — Offline/connection failure retains authorized drafts and explains lack of confirmation; no hidden offline-write queue is introduced.
- [ ] **FE-NET-03** · C/P0 · CRD-01, COM-02, IMP-06 — Disconnect after the server commits: recover the existing operation using its supported status/refetch or same-key replay; do not create another logical command.
- [ ] **FE-NET-04** · P/P0 · CRD-11, IMP-10 — Abort/navigation/timeout during a write means outcome unknown until reconciled; never equate browser request cancellation with database rollback.
- [ ] **FE-NET-05** · C/P0 · CRD-01, COM-02, INV-01 — Double-click/tap/Enter submits one logical intent while pending; intentional later creation remains possible after the first result is resolved.
- [ ] **FE-NET-06** · C/P0 · FND-02, CRD-11 — A retry preserves idempotency key and validated body; editing intent creates a new command rather than changing an existing key's payload.
- [ ] **FE-NET-07** · C/P0 · CRD-10 — A 409 version conflict preserves input, refreshes saved state and asks for deliberate reapply; never silently resend using guessed latest versions.
- [ ] **FE-NET-08** · C/P1 · UX-01 — Handle 400/422 by identifying the invalid field, cursor or relation; no automatic retry of unchanged invalid input.
- [ ] **FE-NET-09** · C/P0 · RBAC-01, RBAC-02 — Handle 403 and private 404 without revealing sibling data; refresh capabilities and prevent repeated forbidden submissions.
- [ ] **FE-NET-10** · C/P1 · DEL-05, IMP-10 — A 410 restore/preview expiry stops that action and explains an alternative; local clock edits or refresh do not renew eligibility.
- [ ] **FE-NET-11** · C/P1 · ATT-02, IMP-03 — A 413 size limit preserves existing saved fields and identifies the rejected file/batch; do not label it a generic successful upload.
- [ ] **FE-NET-12** · P/P1 · FND-04, UX-04 — Rate limiting honors Retry-After with bounded retry/backoff; leaving scope or losing access cancels retry schedules.
- [ ] **FE-NET-13** · C/P1 · FND-04, UX-01 — 5xx errors show safe recovery and request ID if supplied; raw server traces, SQL, tokens and private response bodies are not exposed in diagnostics.
- [ ] **FE-NET-14** · P/P1 · UX-01, UX-04 — Reconnect/focus can refresh canonical reads, but never automatically resubmits old failed writes or opens repeated dialogs/toasts in a loop.

## Forms, drafts and event handling

- [ ] **FE-FORM-01** · C/P0 · CRD-11, COM-06, ATT-01 — Save fields, Post comment and Upload image are independent commands; pressing one never silently submits the other drafts.
- [ ] **FE-FORM-02** · C/P1 · CRD-04, CRD-11 — Save success clears only the submitted form revision; typing again while it was pending leaves the newer draft dirty.
- [ ] **FE-FORM-03** · C/P1 · CRD-04 — Cancel/Discard restores last saved values without sending PATCH; canceling a confirmation returns to the unchanged dirty form.
- [ ] **FE-FORM-04** · C/P1 · CRD-11, UX-02 — Escape first closes the nested picker; a later Escape protects unsaved detail work and restores focus correctly.
- [ ] **FE-FORM-05** · P/P1 · COM-06, UX-02 — Enter in a multiline field, menu, file picker or IME composition does only the intended action; no accidental Save/Post/Delete.
- [ ] **FE-FORM-06** · C/P1 · FND-02, CRD-04 — Shared validation handles blank/whitespace-only, maximum and maximum-plus-one input; errors do not erase entered text.
- [ ] **FE-FORM-07** · C/P0 · FND-02, CRD-04 — Absent fields remain unchanged; null clears only nullable fields; an empty description is deliberate and protected ancestry/role fields are never added to card Save.
- [ ] **FE-FORM-08** · P/P1 · UX-01, CRD-11 — Client validation and server validation errors point to the correct current form; a late response cannot annotate another card's inputs.
- [ ] **FE-FORM-09** · C/P1 · CRD-11, COM-06 — Polling/tab changes/refetch preserve independent authorized drafts; no silent reset while someone is typing.
- [ ] **FE-FORM-10** · P/P0 · ACC-02, RBAC-04 — Draft storage follows the proposed actor/project scope and clearing policy; storage failure never enables a cross-account recovery or logs content.
- [ ] **FE-FORM-11** · P/P1 · UX-01 — Disabled and pending controls cannot be activated through a second event path; failed requests restore a reachable retry state.
- [ ] **FE-FORM-12** · P/P1 · UX-01, CRD-11 — Reopening a dialog resets only intentionally discarded state; old errors/pending flags/confirmation targets cannot act on a newly opened resource.

## Workspace, project and board setup

- [ ] **FE-PROJ-01** · C/P0 · ACC-04 — Create workspace with validation, repeated activation and lost response: one canonical workspace/owner result, not phantom or duplicate containers.
- [ ] **FE-PROJ-02** · C/P1 · PRJ-01 — Owner creates multiple projects with independent names/data; cancel/back creates none and a failed request keeps the correct draft.
- [ ] **FE-PROJ-03** · C/P0 · PRJ-01, RBAC-01 — Nonowner cannot create a project by manipulating a link or workspace selector; handle the actual server denial safely.
- [ ] **FE-PROJ-04** · C/P1 · PRJ-02 — Active/archived project lists support loading, empty, failure and pagination; results contain only owned or explicitly granted projects.
- [ ] **FE-PROJ-05** · C/P0 · PRJ-03 — Owner/manager saves project settings with expected version; stale or revoked authority preserves unsaved intent without overwriting saved state.
- [ ] **FE-PROJ-06** · C/P1 · BRD-01 — First-board creation and default columns appear only after canonical success; a failed board step does not pretend the project itself vanished.
- [ ] **FE-PROJ-07** · C/P1 · BRD-02 — Rename board: existing card links/IDs remain usable; list/header refresh consistently without losing unrelated drafts.
- [ ] **FE-PROJ-08** · C/P0 · PRJ-04, BRD-08 — Project archive/reopen is owner-only; board archive/reopen is owner/manager. Archived data remains readable, writes stop, and trash deadlines keep running.

## People, invitations and membership administration

- [ ] **FE-TEAM-01** · C/P0 · INV-01, RBAC-05 — Invite names the exact project and all-board inheritance; owner may choose manager/member/viewer, manager only member/viewer.
- [ ] **FE-TEAM-02** · C/P1 · INV-01, INV-02 — Validate invitation input and repeat submit safely; show creation/pending delivery separately from actual email delivery or acceptance.
- [ ] **FE-TEAM-03** · C/P1 · INV-02 — Failed/retrying invitation delivery is visible and recoverable; no “email sent” claim based only on an outbox row or mockup.
- [ ] **FE-TEAM-04** · C/P0 · INV-03 — Invitation acceptance requires matching verified identity; wrong account offers safe account change without leaking tokens or silently granting access.
- [ ] **FE-TEAM-05** · C/P0 · INV-03, INV-04 — Expired/revoked/used/resend-invalidated invitation links have safe states; double acceptance/reload never creates another grant.
- [ ] **FE-TEAM-06** · C/P0 · INV-04 — Resend/revoke uses the selected invite's ID/current scope; a stale list response cannot revive an obsolete link or claim an old token works.
- [ ] **FE-TEAM-07** · C/P1 · INV-05 — Pending/accepted/revoked/expired filters and list paging reflect canonical states; no bearer token is displayed in roster/list diagnostics.
- [ ] **FE-TEAM-08** · C/P0 · INV-06 — Role change checks current target and actor authority; manager cannot grant manager, edit self/peer-manager authority or exploit stale controls.
- [ ] **FE-TEAM-09** · C/P0 · INV-07, RBAC-03 — Remove a member while their action is pending in a second browser: reflect the server's serialized outcome; no success after a rejected write.
- [ ] **FE-TEAM-10** · C/P0 · INV-07, INV-03 — An old self-invite does not restore removed access; show current server rejection, and distinguish a fresh authorized reinvite.
- [ ] **FE-TEAM-11** · C/P0 · INV-08 — Leave confirms the exact project; after success remove its active views; workspace owner cannot leave ownership through this action.
- [ ] **FE-TEAM-12** · C/P0 · PRJ-05, RBAC-04 — Directory/pickers paginate/search only eligible project identities; historical actors display safely but cannot be newly assigned when ineligible.

## Board snapshot, columns and pagination

- [ ] **FE-BOARD-01** · C/P1 · BRD-03 — Render metadata, columns, cards and counts from one supplied snapshot; do not combine unrelated stale versions into a coherent-looking board.
- [ ] **FE-BOARD-02** · C/P1 · BRD-03, CRD-02 — Total active, matching and loaded counts remain distinct; totals cover unseen pages and never imply business progress percentages.
- [ ] **FE-BOARD-03** · C/P1 · BRD-03, BRD-07 — Respect snapshot/per-column caps and nextCursor; disclose more cards instead of truncating silently or fetching unlimited pages.
- [ ] **FE-BOARD-04** · C/P1 · BRD-07, UX-01 — Empty board, empty column, no filter matches and failed/unloaded page are distinguishable; each has a correct permitted next action.
- [ ] **FE-BOARD-05** · C/P1 · BRD-07 — Load more in one column does not reorder other columns or reset their pages; failures retain already confirmed data and a retry path.
- [ ] **FE-BOARD-06** · C/P1 · BRD-04 — Column create/rename validates normalized duplicate names, bounds/category/color and the agreed 12-column cap; stale changes refresh rather than overwrite.
- [ ] **FE-BOARD-07** · C/P1 · BRD-04 — Renaming a column preserves its stable ID and category semantics; due/completion behavior does not infer meaning from the display label.
- [ ] **FE-BOARD-08** · C/P0 · BRD-05 — Column reorder submits all required stable IDs once with expected board version; stale/invalid ordering restores canonical order.
- [ ] **FE-BOARD-09** · C/P0 · BRD-06 — Remove final or referenced column: handle useful conflict without silently moving/deleting active or restorable cards.
- [ ] **FE-BOARD-10** · C/P0 · BRD-08, RBAC-01 — Archive or demotion discovered during configuration stops new writes; opening archived board does not make it editable.
- [ ] **FE-BOARD-11** · P/P1 · UX-03, BRD-07 — Load pages or add/remove cards while scrolled: keep a sensible stable reading position, with no focus jumping into another resource.
- [ ] **FE-BOARD-12** · C/P1 · BRD-03, UX-04 — A polling/refetch failure does not replace the whole board with empty data or silently clear filters and selection.

## Cards and the detail action contract

- [ ] **FE-CARD-01** · C/P0 · CRD-01 — Quick create validates title and active target; repeated click/lost response creates one saved card and keeps draft until outcome is resolved.
- [ ] **FE-CARD-02** · C/P1 · CRD-02 — Compact summaries show canonical title/priority/date/assignees and accurate comment/finalized-image counts; they do not require fetching every full detail.
- [ ] **FE-CARD-03** · C/P1 · CRD-03 — Detail can load independently; card switching, failed detail read and retry do not corrupt board state or another card's draft.
- [ ] **FE-CARD-04** · C/P0 · CRD-04 — Explicit Save updates only editable fields with expected version; a failed save never shows new values as durably saved.
- [ ] **FE-CARD-05** · C/P1 · CRD-05 — All five priorities and clearing due date persist across reload; invalid enum/date values show validation rather than silently defaulting.
- [ ] **FE-CARD-06** · C/P0 · CRD-06 — Assignee selection allows zero/multiple eligible people, rejects removed/viewer candidates for assignment and includes the owner correctly without global directory lookup.
- [ ] **FE-CARD-07** · C/P0 · CRD-10 — Another teammate edits the same card: show recoverable 409 and both saved context/user intent without automatic overwrite.
- [ ] **FE-CARD-08** · C/P0 · DEL-08, CRD-03 — Card is trashed/purged or access revoked while open: stop edits/comment/upload/move, clear unauthorized content and explain unavailable state safely.
- [ ] **FE-CARD-09** · C/P0 · CRD-04, CRD-07 — Status/column changes use the Move contract, not a generic field PATCH; combined dirty Save+Move waits for an agreed sequencing/failure policy.
- [ ] **FE-CARD-10** · C/P1 · CRD-11, UX-02 — Card menus, detail controls and confirmations cannot submit the wrong resource after navigation; discarded text and completed actions stay independently tracked.

## Drag, Move and Undo

- [ ] **FE-MOVE-01** · C/P0 · CRD-07 — Drag within/across authorized active columns sends one versioned move with canonical neighbor IDs; reload confirms saved position.
- [ ] **FE-MOVE-02** · P/P1 · CRD-07, UX-02 — Clicking card/menu does not accidentally start a drag; completing a drag does not also open details or activate Delete.
- [ ] **FE-MOVE-03** · C/P1 · CRD-08, UX-02 — Click/tap and keyboard Move can reach first/last/before/after positions, including anchors outside currently loaded pages.
- [ ] **FE-MOVE-04** · C/P0 · CRD-08 — Placement read excludes the moving card; both neighbors null means empty destination, never guessed append into a populated column.
- [ ] **FE-MOVE-05** · C/P0 · CRD-09 — Filtering disables ambiguous drag; Move reads full canonical destination boundaries rather than reordering just visible cards.
- [ ] **FE-MOVE-06** · C/P0 · CRD-10 — Destination/anchor changes after placement read: handle conflict, refresh and preserve intended placement without silently choosing another neighbor.
- [ ] **FE-MOVE-07** · P/P1 · CRD-07, UX-02 — Escape, outside drop, pointer cancellation or interrupted gesture cleans provisional state; no stray server move or permanently stuck dragging flag.
- [ ] **FE-MOVE-08** · P/P1 · CRD-07, UX-03 — Native board/column scrolling and touch gestures remain usable during movement; losing pointer capture does not leave a phantom card.
- [ ] **FE-MOVE-09** · C/P0 · CRD-07, CRD-10 — Rejected move restores/reconciles canonical affected order/counts while keeping another successful mutation intact.
- [ ] **FE-MOVE-10** · P/P0 · CRD-07, UX-04 — Rapid moves of one card are serialized or reconciled by version; slow acknowledgement of the first cannot win over the second confirmed state.
- [ ] **FE-MOVE-11** · C/P0 · CRD-12 — Move Undo is a new authorized command with current expected versions, not a local array reset; intervening changes may make it fail safely.
- [ ] **FE-MOVE-12** · C/P1 · CRD-12, DEL-03 — Undo labels are action-specific: move Undo does not restore trash and prototype delete Undo is not an unimplemented generic rollback endpoint.

## Dates, text and identity rendering

- [ ] **FE-TEXT-01** · C/P0 · CRD-05, IMP-08 — YYYY-MM-DD survives save/reload in positive/negative timezone offsets and DST boundaries without changing the selected calendar day.
- [ ] **FE-TEXT-02** · C/P1 · CRD-05 — Real leap days validate; impossible days, ambiguous date strings and accidental timestamp values fail rather than normalize to a different date.
- [ ] **FE-TEXT-03** · C/P1 · ACC-05, CRD-05 — Overdue uses workspace today/asOfDate, excludes due-today and done-category cards, and is recalculated correctly when work reopens.
- [ ] **FE-TEXT-04** · P/P1 · UX-04, CRD-05 — A tab left across midnight or workspace-timezone change refreshes due-state assumptions; client clock alone never rewrites date-only values.
- [ ] **FE-TEXT-05** · C/P0 · CRD-04, COM-02, IMP-04 — Titles, comments, imported strings and filenames render as inert text; HTML/script-like content never executes or creates automatic fetches.
- [ ] **FE-TEXT-06** · P/P1 · CRD-04, COM-03 — Emoji, combining characters, non-Latin input, paste and IME composition preserve text; shared length/normalization rules govern validation, not guessed browser character counts.
- [ ] **FE-TEXT-07** · C/P0 · COM-03 — Mention offsets use validated UTF-16 boundaries; emoji or trimming before a mention cannot shift it onto the wrong user/text.
- [ ] **FE-TEXT-08** · C/P1 · ACC-03, AUD-02 — Duplicate display names, renamed people, missing avatars and removed authors retain stable identity labels without exposing account-email lookup.

## Comments and structured mentions

- [ ] **FE-COM-01** · C/P1 · COM-01 — Comments load chronologically with stable page identity; refresh/load-more deduplicates without changing which draft is being edited.
- [ ] **FE-COM-02** · C/P1 · COM-02 — Blank/whitespace-only/overlong comments fail appropriately; ordinary line breaks remain plain text and the composer stays recoverable.
- [ ] **FE-COM-03** · C/P0 · COM-02, COM-06 — Lost post response/retry creates one canonical comment; failure leaves independent composer text intact and does not undo saved card fields.
- [ ] **FE-COM-04** · C/P0 · COM-03, PRJ-05 — Picker returns active eligible project readers including viewers/owner; typed literal @name alone has no notification meaning.
- [ ] **FE-COM-05** · C/P1 · COM-03, UX-02 — Keyboard/pointer selection, Escape, deleting a selected mention and editing surrounding text update structured spans safely; Enter in picker never posts accidentally.
- [ ] **FE-COM-06** · C/P0 · COM-03, NTF-01 — Recipient access changes before Post: show validation/authority result without substituting another user or claiming a delivered mention.
- [ ] **FE-COM-07** · C/P0 · COM-04 — Edit own comment uses expected version; stale edit retains text for review and does not resend mention notifications.
- [ ] **FE-COM-08** · C/P0 · COM-05 — Author or permitted owner/manager deletion shows tombstone only after confirmation; members cannot moderate others and moderation does not impersonate an edit.
- [ ] **FE-COM-09** · C/P1 · COM-06 — Comment draft survives Save, tab changes and authorized refetch; posting one draft does not clear another comment's editing state.
- [ ] **FE-COM-10** · C/P0 · COM-05, AUD-06 — Deleted/redacted body and mention data stay hidden from discussion, preview and history views after refresh/back navigation.

## Private images and upload lifecycle

- [ ] **FE-IMG-01** · C/P1 · ATT-01 — Upload requires a real saved card; file selection/drop/cancel changes upload state without submitting dirty card fields.
- [ ] **FE-IMG-02** · C/P1 · ATT-02, ATT-06 — Type/size/dimension/count/quota rejection identifies the affected file; client checks aid feedback but server byte verification remains authoritative.
- [ ] **FE-IMG-03** · P/P1 · ATT-01 — Selecting the same file again after failure works; multiple files have independent stable IDs, progress, errors and retry controls.
- [ ] **FE-IMG-04** · C/P0 · ATT-01, ATT-02 — Separate transferred, validating and finalized states; do not show fabricated validation percentages or count staged bytes as a saved image.
- [ ] **FE-IMG-05** · C/P0 · ATT-01, ATT-02 — Retry/finalize follows agreed upload ID/digest semantics; double finalize or lost response does not duplicate attachment or silently reattach changed bytes.
- [ ] **FE-IMG-06** · C/P0 · ATT-01, ATT-06 — Cancel during staging/late finalize follows server state; ALREADY_FINALIZED directs to ordinary removal. Browser abort alone never proves object cleanup or canceled association.
- [ ] **FE-IMG-07** · C/P1 · ATT-03 — Gallery paginates finalized images; missing/broken thumbnail has per-image recovery and does not crash the whole detail or lose drafts.
- [ ] **FE-IMG-08** · C/P0 · ATT-04 — Image/thumbnail requests use authenticated current-project proxy; no mock public URL or reusable signed-link shortcut replaces permission checks.
- [ ] **FE-IMG-09** · C/P0 · ATT-04, RBAC-04 — Access revocation clears app-controlled image displays/URLs and handles next fetch denial; never promise recall of previously downloaded bytes.
- [ ] **FE-IMG-10** · C/P0 · ATT-05 — Uploader or authorized owner/manager explicitly confirms removal of the intended image; cancel removes nothing and failure preserves canonical gallery and independent form state.
- [ ] **FE-IMG-11** · C/P0 · ATT-07, DEL-03 — Trash/restore recovers only finalized images present at deletion; previously removed images do not reappear and purge cannot remove restored files.
- [ ] **FE-IMG-12** · P/P1 · ATT-03, ATT-06 — Close/navigate/reselect cleans temporary object URLs/listeners and stale progress callbacks; no private image/file leak into the next card.

## Trash, restore and deadline handling

- [ ] **FE-TRASH-01** · C/P0 · DEL-01 — Owner/manager Delete confirmation identifies the card and 24-hour recovery; member/viewer cannot use trash administration.
- [ ] **FE-TRASH-02** · C/P0 · DEL-01, QRY-03 — Confirmed delete removes the card from active board/search/My tasks/counts; failed deletion does not masquerade as success.
- [ ] **FE-TRASH-03** · C/P1 · DEL-02 — Trash pages show correct project, actor, exact deadline, canRestore/blockedReason and serverNow; inaccessible trash stays private rather than empty-but-successful.
- [ ] **FE-TRASH-04** · P/P0 · DEL-05 — Clock skew, sleeping tab and changing local time never decide eligibility; advisory countdown uses API serverNow offset and handles stale/unavailable timing without claiming extended recovery.
- [ ] **FE-TRASH-05** · C/P0 · DEL-03, DEL-05 — Check just before, exactly at and after cutoff with controlled server time: only a confirmed permitted restore is shown as successful.
- [ ] **FE-TRASH-06** · C/P0 · DEL-03 — Repeated restore/lost response recovers the same card ID and original recoverable content without renewing the deletion window.
- [ ] **FE-TRASH-07** · C/P0 · DEL-04 — RESTORE_DESTINATION_REQUIRED/READ_ONLY_CONTEXT requires authorized original-board column choice or reopening; no cross-board relocation or client-chosen rank, and role loss remains private denial.
- [ ] **FE-TRASH-08** · C/P0 · DEL-06 — Restore racing purge or another restore reflects the canonical winning outcome; disable misleading follow-up actions and refetch affected lists.
- [ ] **FE-TRASH-09** · C/P0 · DEL-07, AUD-06 — After purge, UI/history/inbox/receipt-derived views expose only permitted minimal facts, never reconstruct deleted body/images from old app caches.
- [ ] **FE-TRASH-10** · C/P0 · DEL-08, CRD-11 — Stale open detail rejects comment/save/upload/move once trashed; retain drafts only under the agreed authorized in-memory policy, without implying they were saved/restored.

## Excel template, validation and preview

- [ ] **FE-IMPORT-01** · C/P1 · IMP-01 — Authorized template download returns the versioned XLSX with blank Cards sheet; download failure cannot be mistaken for successful import.
- [ ] **FE-IMPORT-02** · C/P0 · IMP-02 — Owner/manager explicitly chooses project/board/default column; switching destination invalidates old preview and cannot retain another project's resolved people.
- [ ] **FE-IMPORT-03** · C/P0 · IMP-03 — Reject unsupported or spoofed package, macros/formulas/links/embedded objects and exceeded bounds through server validation; browser extension checks alone prove nothing.
- [ ] **FE-IMPORT-04** · C/P1 · IMP-04 — External ID/Title headers are required; five optional template headers use specified defaults when absent. Duplicate/unknown headers and wrong sheet structure identify correction without guessing.
- [ ] **FE-IMPORT-05** · C/P1 · IMP-04 — Blank template creates zero cards, blank rows are ignored and invalid nonempty rows have stable source row/field errors, even between blank rows.
- [ ] **FE-IMPORT-06** · C/P0 · IMP-07 — Text External ID preserves leading zeros and normalized case-sensitive identity; numeric IDs and conflicting repeated IDs produce explicit errors.
- [ ] **FE-IMPORT-07** · C/P0 · IMP-08 — Both Excel date systems and strict ISO text map to date-only values; fictitious 1900 leap day and ambiguous/numeric non-date cells do not get guessed.
- [ ] **FE-IMPORT-08** · C/P0 · IMP-04, IMP-08 — Semicolon emails resolve only eligible project assignees; unknown/viewer/removed identities block commit and never auto-invite or grant access.
- [ ] **FE-IMPORT-09** · C/P0 · IMP-04, IMP-05 — Blank status uses explicitly selected default; unknown status requires explicit mapping to existing column and revalidation, never automatic column creation.
- [ ] **FE-IMPORT-10** · C/P1 · IMP-05 — Preview row paging preserves original source rows; new/already-imported/conflicting/invalid totals describe the entire batch, not just loaded rows.
- [ ] **FE-IMPORT-11** · C/P0 · IMP-05 — Upload/preview creates no domain cards; cancellation or invalid preview never leaves phantom board cards in local state.
- [ ] **FE-IMPORT-12** · C/P0 · IMP-06 — Confirm requires deliberate action, zero invalid/conflicting rows, current expected import version and digest; changing mappings/file/target disables stale confirmation.
- [ ] **FE-IMPORT-13** · C/P0 · IMP-06 — Role/assignee/column/board changes before commit require revalidation or deny access; all new rows appear or none, never invented valid-row partial success.
- [ ] **FE-IMPORT-14** · C/P0 · IMP-06, IMP-09 — Double confirm/lost response follows same operation/status to actual outcome; no second import while an earlier result is unknown.
- [ ] **FE-IMPORT-15** · C/P0 · IMP-07, IMP-11 — Same ID/original payload skips even after later card edits; changed payload conflicts; trashed/purged originals never resurrect through reupload.
- [ ] **FE-IMPORT-16** · C/P0 · IMP-10 — Before commit, cancel is explicit; during committing, do not promise rollback. Back/navigation and server expiry cannot extend a preview's 30-minute eligibility.
- [ ] **FE-IMPORT-17** · C/P0 · IMP-09 — Result links point to canonical authorized cards; created/skipped/failed outcomes are truthful and error-report downloads do not execute formula-like strings.
- [ ] **FE-IMPORT-18** · C/P1 · IMP-11, AUD-05 — Import results/provenance identify the actor/batch and link normal card history without exposing raw workbook or another project's data.

## Activity and notifications

- [ ] **FE-FEED-01** · C/P1 · AUD-01, AUD-02 — Card history shows stable chronological actor/time/action and meaningful safe changes; pagination/refetch does not duplicate or fabricate events.
- [ ] **FE-FEED-02** · C/P0 · AUD-03, AUD-04 — Workspace owner, project manager and ordinary project reader get only their allowed feed scope; filter controls cannot widen authority.
- [ ] **FE-FEED-03** · C/P0 · AUD-06 — No audit edit controls or client reconstruction of redacted bodies; missing historical identity uses safe fallback without private account lookup.
- [ ] **FE-FEED-04** · C/P1 · AUD-05 — Image/import/trash/restore facts follow confirmed server state; optimistic activity is never presented as immutable recorded history.
- [ ] **FE-FEED-05** · C/P1 · NTF-01 — Mention inbox may arrive later; do not fabricate notification success, duplicate logical entries or self-mention alerts while work is pending.
- [ ] **FE-FEED-06** · C/P0 · NTF-02 — Open/mark-read uses actor-owned notification and current project access; repeated activation is safe and unavailable destinations do not leak previews.
- [ ] **FE-FEED-07** · C/P0 · NTF-01, RBAC-04 — Removed project access hides/redacts related inbox data and stops stale poll results from making it visible again.
- [ ] **FE-FEED-08** · C/P1 · NTF-03 — Delayed/retrying/failed background delivery does not block a saved comment or claim exactly-once external email; only agreed status fields are displayed.

## Search, filters and My tasks

- [ ] **FE-QUERY-01** · C/P0 · QRY-01 — Search is project-scoped and active-only; guessed filters/IDs cannot enumerate sibling data or trash.
- [ ] **FE-QUERY-02** · C/P1 · QRY-02 — Combined assignee/priority/date/column filters obey shared semantics; clearing one does not clear unrelated filters or change underlying card order.
- [ ] **FE-QUERY-03** · C/P1 · QRY-02, BRD-03 — Matching/total/loaded counts remain honest after filter changes and across unseen pages; no-results is not a failed request.
- [ ] **FE-QUERY-04** · P/P1 · QRY-01, UX-04 — Rapid input, clearing search while pending and Back/Forward respect current query identity without stale results or runaway request storms.
- [ ] **FE-QUERY-05** · C/P0 · QRY-03 — My tasks includes only actor assignments in accessible projects; revocation/deletion/unassignment disappears after canonical refresh.
- [ ] **FE-QUERY-06** · C/P1 · QRY-03, CRD-05 — My tasks groups due state/project correctly, handles unassigned/removed historical data and links authorized saved cards.
- [ ] **FE-QUERY-07** · C/P1 · QRY-01, BRD-07 — Changing filters resets affected pagination; stale nextCursor produces refresh recovery, not silent skipped results.
- [ ] **FE-QUERY-08** · P/P1 · QRY-01, UX-03 — Long queries, pasted Unicode, empty query and contract-rejected malformed filters remain responsive and never crash rendering.

## Preferences, profile and later administration

- [ ] **FE-PREF-01** · C/P1 · ACC-03 — Name/avatar changes save/refetch correctly; failure preserves permitted draft and does not rewrite historical actor attribution.
- [ ] **FE-PREF-02** · C/P0 · ACC-05 — Only owner changes workspace preferences; invalid timezone/version fails visibly without silently shifting existing due dates.
- [ ] **FE-PREF-03** · P/P2 · UX-01 — Optional non-sensitive preference storage may be disabled/full/corrupt; fall back safely without breaking sign-in, board use or writes.
- [ ] **FE-PREF-04** · C/P0 · ACC-07 — Owner transfer requires explicit target confirmation and canonical success; afterward refresh all affected capabilities, not just displayed owner name.
- [ ] **FE-PREF-05** · C/P0 · ACC-07, INV-08 — Stale transfer, target ineligibility and lost response do not invent a new owner or let the prior owner leave before a valid transfer.
- [ ] **FE-PREF-06** · C/P0 · PRJ-04, BRD-08 — Later archive/reopen controls obey distinct project/board authority; failed reopening never silently enables editing/import/restore.

## Browser, interaction and resource resilience

- [ ] **FE-BROWSER-01** · C/P1 · UX-02 — Every essential permitted action works by keyboard and click/tap, including Move, pickers, confirmations and file selection; focus never becomes trapped outside reachable controls.
- [ ] **FE-BROWSER-02** · C/P1 · UX-02 — Dialog focus/Escape/return behavior survives failed requests, card removal and nested menus; state announcements reflect actual result rather than provisional success.
- [ ] **FE-BROWSER-03** · C/P1 · UX-03 — Narrow viewport, zoom, long titles, many assignees and large discussion/gallery lists do not hide or make actions unreachable; no visual redesign is prescribed.
- [ ] **FE-BROWSER-04** · C/P1 · UX-04 — Hidden tabs pause scheduled polling; focus/reconnect starts a bounded fresh read rather than accumulating duplicate timers and listeners.
- [ ] **FE-BROWSER-05** · P/P1 · UX-04 — Repeated mount/unmount, development rerenders and route transitions clean subscriptions/timers; no duplicate mutation is caused by lifecycle setup.
- [ ] **FE-BROWSER-06** · P/P1 · UX-01 — A detail/image/component exception exposes safe local recovery and preserves reachable navigation; no permanent blank application or unhandled rejection.
- [ ] **FE-BROWSER-07** · P/P1 · UX-01 — Failed/obsolete JavaScript chunk or unavailable route has bounded reload recovery; never endlessly reload a dirty page or present stale authorization as current.
- [ ] **FE-BROWSER-08** · P/P0 · RBAC-04, ATT-04 — Verify app/router/framework/HTTP caches separately; no service worker or prefetch cache stores private product responses without an explicit policy and evidence.
- [ ] **FE-BROWSER-09** · P/P1 · ATT-03, IMP-01, IMP-09 — File chooser cancel, blocked download, unavailable clipboard where used and failed image decode are handled as recoverable capability errors, not successful operations.
- [ ] **FE-BROWSER-10** · C/P1 · UX-02, UX-03 — Reduced-motion or interrupted transitions cannot block completion, lose focus or fire commands; function remains available without relying on animation completion.

## Verification, integration and release evidence

- [ ] **FE-TEST-01** · P/P0 · FND-01, FND-02 — Frontend setup/build/typecheck and real API base URL are reproducible; FND-01 runtime and FND-02 schema dependencies do not make mockup roles/configuration actual integration evidence.
- [ ] **FE-TEST-02** · C/P0 · FND-03, RBAC-02 — Integration uses selected PostgreSQL migrations and synthetic distinct projects/accounts; a historical SQLite/mock pass never proves project isolation.
- [ ] **FE-TEST-03** · P/P1 · FND-04, UX-01 — Test common error matrix and reordered/dropped responses in each relevant action class; assert control state, retained draft and canonical result, not just HTTP status/toast.
- [ ] **FE-TEST-04** · C/P0 · RBAC-01, RBAC-03 — Two actual sessions reproduce concurrent edits, actor revocation and target promotion; browser outcomes match committed server authority and data.
- [ ] **FE-TEST-05** · C/P0 · DEL-05, DEL-06, IMP-07 — Use controlled server time/concurrent requests for expiry, restore/purge and repeated import; changing a browser timer alone proves none of those invariants.
- [ ] **FE-TEST-06** · P/P1 · UX-02, UX-03 — Agree and record supported browser/touch/keyboard matrix; run full journeys there with no unexplained console errors, unhandled promises or endless pending indicators.
- [ ] **FE-TEST-07** · C/P0 · UX-05 — Real create/edit/move/comment/image/delete/restore and template/preview/commit/reimport journeys survive reload; fixture-only clicks remain separately labeled.
- [ ] **FE-TEST-08** · C/P1 · UX-05 — Measure representative board/input/render/network behavior with declared sizes/devices; no framework choice, mock screenshot or local test duration proves performance targets.
- [ ] **FE-TEST-09** · C/P0 · FND-02, UX-05 — UI evidence binds current approved backend review and its prerequisites; integration binds current UI evidence; changed contracts/approval bytes reopen affected acceptance.
- [ ] **FE-TEST-10** · P/P1 · UX-01, UX-05 — Every reported frontend bug gains a stable regression case and reproduction; preserve failed evidence instead of retrying until a flaky test appears green.

## Applying the cases

For a feature, select its mapped FE cases plus navigation/context, applicable failure matrix, draft, permission and concurrency cases. Execute success, relevant negative/boundary cases and a real refresh. Record test identity, source revision, backend review consumed and browser/environment. Do not check any box merely because a handler, mock or screenshot exists.

New frontend acceptance cases do not change the 98 stable product IDs. A checked case is not a security guarantee, a new API requirement approval or an integrated feature checkmark. Product/API contract decisions and current backend review gates still apply.
