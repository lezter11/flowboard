# Projects / Project work with separate board access

Date: 27 October 2026. Final source snapshot: projects-board-access-2026-10-27-manifest.json. This is local HTML design evidence, not production/API/backend acceptance.

## User-confirmed acceptance criteria

- Preserve Project → Boards → Columns/Cards; My Fashion contains Web, Marketing and Operations. No nested project entity is required.
- Non-Owners require project membership AND access to each board. Owner can access all boards in owned projects. Hidden board IDs/names/counts/cards must not appear in project projections, selectors, work lists or summaries.
- Project work combines cards inside exactly ONE project, including for Owner. Switching projects changes scope; there is no All projects aggregate.
- Owner-only local board access editor uses project members only, Owner locked, staged Save/Cancel. Manager delegation remains a backend/product decision, not implicit self-grant permission.
- Keep source project/board/column context, source category semantics, read-only combined view, reachable controls, bounded loading and correct deep links.

## Work and evidence ownership

Root coordinated the frontend and cross-chat handoff; GPT-6 Luna projects_reference_research analyzed all three preserved references and official product/accessibility docs; projects_aggregate_backend_design prepared source-grounded proposals. GPT-6 Luna projects_hierarchy_ui built the hub/overview and grant editor. Root implemented scoped Portfolio fixtures, workbench, navigation and tests. A fresh GPT-6 Luna project_board_access_audit independently inspected source and ran the actual-source VM/mock-DOM harness read-only.

## Audit history

The earlier project-grant-inheritance prototype had three source passes by projects_independent_audit: 7.8/10 (close button did not close, deep link limited to visible 20, aggregate implied description payload), 8.2/10 (archived card could route into an editable standalone board), then 8.9/10 after repairs. The reviewer's initial URL-key mismatch claim was withdrawn after re-reading the actual correct mapping. These historical assessments are not acceptance of the new board-grant policy.

After the user answered two pending questions, separate board access and one-project-only aggregation superseded that policy. A fresh independent auditor, project_board_access_audit, reviewed the revised model, dialog and routes, ran /tmp/flowboard-board-access-check.mjs, and scored the bounded UI/mock behavior **9.1/10**, no blockers. Later changes were limited to truthful session-persistence copy and short-screen modal CSS; reviewer confirmed no impact on the qualified score.

## Verified behavior

Actual-source VM/static-mock tests (not rendering) verify:

- Role matrix inside My Fashion: Owner 3 boards/10 cards; Manager 1/4; Member 2/7; Viewer 1/3. Board projections, project board IDs, dropdown options, card rows and counts match authorized scope. Hidden/foreign board URLs produce generic unavailable results.
- Even Owner gets one project per workbench/default cards query. All projects card option is absent. Project chooser changes context rather than combining projects.
- Owner checkbox is rendered checked and disabled. Invalid/non-project member IDs are rejected. Actual dialog checkbox change remains staged; Cancel/reopen discards it, Save commits it. Owner access cannot be removed. Manager cannot self-grant. Revocation to zero boards retains the accessible project but exposes no board metadata; grants survive a reload in the same mock session store. Removing project membership denies reads even if a board grant remains.
- Private fields (description/images/comments) are absent from aggregate summary objects. Source original columns remain in individual Board view, while combined layout uses category semantics instead of column-name guessing.
- 37-card project pagination shows 20 initially, loads the rest, and opens authorized card deep links beyond the visible page or active search filter. Close button closes the layer and clears URL state; role rerender closes details. Archived Website cards hide the editable action and redirect card/shared-board navigation to a read-only scope. Inaccessible Website routes fall back to Projects.

Passed syntax checks for model, projects, project, all-work and shared screens JS; HTML nesting/unique-ID and local asset checks recorded separately; CSS brace and scoped whitespace checks passed. Transcript: projects-board-access-2026-10-27-checks.txt.

## Design detector triage

The first bounded scan found a real cramped dialog boundary, corrected with 8px bottom inset and protected scrollable form/body plus nonshrinking actions. Final confirmation: **0 anti-patterns**, with three advisory modal border/shadow notes retained. Six narrow ignore-value entries were persisted through `impeccable hooks`: gradient-text for each of three portfolio pages (user-selected shared Flowboard wordmark), and overused-font=inter for each (existing HTML artifact typography; IBM Plex remains the locked sign-in choice pending a product-wide decision). No blanket rule/file ignore was added. These exceptions must be disclosed and do not claim all inherited UI issues are fixed.

## Research and backend handoff

References REF-14–16 are copied byte-for-byte under docs/references with SHA-256 entries. docs/research/projects-reference-direction-2026-10-27.md compares the images and official tool patterns; existing backend readiness is documented separately.

The root used the user's explicit authorization to message the existing **Flowboard Backend** chat (01a17470-0521-72f1-906d-d8dda6550527). Initial provisional inheritance/workspace proposal and QRY-04 contract draft were sent, then explicitly superseded when answers arrived. The revised request is docs/handoffs/proposals/project-board-access-v2-2026-10-27.md: board grants and full authorization impact first; project-only aggregate after that cutover; no workspace-wide card endpoint. Previous contract approval is withdrawn for its inherited-board-access assumption. Backend was told to prepare revised contract/migration impact before further affected handler changes. No backend files, migrations, contracts, generated checklists or accepted handoffs were changed by this UI work.

## Limits and integration requirements

No browser rendering, real pointer geometry, screen-reader run, production authentication, database grant persistence, hosted behavior or API integration was verified. Session storage and role fixtures are demonstration state, not secure authorization. Older standalone artifact pages are not a complete board-grant-aware product; only new portfolio projections and exposed navigation were repaired here. Server enforcement must cover all board/card/column, comment/image, search/people, activity/notifications, import/export, trash, receipt/replay, cursor and count paths before integration.

Current backend contracts still differ from this new policy. Real-data grant backfill and Manager grant-administration authority need explicit agreement. The prototype uses complete fixture arrays for local title/due sorting, totals and archived browsing; those cannot be silently mapped to a paginated API without the corresponding approved contracts. Existing failed backend review records are preserved; this UI score cannot approve them.
