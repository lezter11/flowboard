# Discussion, notification and audit UI — resumed builder evidence

Status: builder work held for the fresh global freeze and independent review. This is not a passing backend handoff, release approval, feature closure, score or hosted acceptance. Baseline commit: `e13b15fc8ab4279d6a59977c94d6cb05d7dcd711`.

## Actions

- Verified all23 files against the committed checkpoint manifest before editing; all matched. Old failed/incomplete evidence is preserved.
- Reproduced the pending-request dirty-state defect with a focused regression before fixing it: a lost-reply edit remained unresolved after access refusal removed the fetched editor, while `hasUnsaved()` incorrectly returned false. `dirty-red.log` records the actual failing assertion and exit1.
- Changed only the comment-session unsaved expression and card-drawer close-warning expression to include unresolved create/edit/delete commands. The original command remains private, retains its original arguments/key, and is retryable only through the existing authorized recovery path. No fetched body was restored and no possibly committed operation was treated as cancelled.
- Added the regression to the existing owned test file. Corrected the new browser probe's long-value locator to `.activity-list`; the committed old probe and its failed logs remain unchanged.

## Why and options

A teammate can click Save and lose the reply after the server saved the comment. Flowboard must then protect that unresolved request even if access loss hides the fetched editor. Keeping the request in dirty tracking preserves the unload/close warning without retaining the fetched text on screen. Treating an absent editor as completed work would silently lose that protection.

## Evidence and limits

All successful executions use current local source and synthetic records. Browser fixture startup creates an isolated random schema in `flowboard_ui_test` and finally drops it. Primary and all configured test database URLs explicitly select the approved loopback55931 harness databases. No default/shared55432/55479 database was used. Synthetic password values are omitted from this handoff.

| Command | Exit | Observed result |
| --- | --- | --- |
| `node --test --test-name-pattern='pending original edit keeps unload' apps/web/test/discussion-notification-repair.test.ts` | 1 | Expected pre-fix regression:1 failed assertion |
| `node --test apps/web/test/activity-details.test.ts apps/web/test/discussion-notification-repair.test.ts apps/web/test/comment-state.test.ts` | 0 |21 passed;0 failed/skipped |
| `npm test -w @flowboard/web` | 0 |332 passed;0 failed/skipped |
| `npm run typecheck -w @flowboard/web` | 0 | TypeScript completed |
| `NODE_ENV=test node docs/reviews/FULL-REVALIDATION-20261103/discussion-notification-ui-repair/resume-round1/browser-resumed.mjs` with the explicit six test URLs listed in commands.json | 0 | Actual Chrome156.0.8078.80;8 observation groups;136 API responses;0 external requests;21 held source/dependency hashes unchanged |

Actual browser observations:

1. Unchanged fetched editor disappears on a real comments404 while6 other reads are held. After access restoration and drawer remount, the copied edit does not reappear.
2. User-authored changed text survives the same refusal and becomes read-only.
3. An actual PATCH commits but its browser reply is lost; after real grant revocation/comments404 the fetched editor disappears, original retry is disabled, drawer-close warning appears and an actual native beforeunload warning appears. After grant recovery and explicit comments200, keyboard retry sends the exact original body/key. The database shows one version increment and one edit event.
4. Keyboard Open on the actual server `cardId` notification link displays exactly the target card drawer.
5. A contradictory board/card link for a user authorized to both boards hides the card body and mutation controls. An off-page card on the correct board and an aggregate source-board route still open.
6. Card, project and workspace activity show assignment-only descriptions, exact referenced names, safe old/new title/priority/date values and from/to columns. Long description history expands by keyboard.
7. HTML-like description history is rendered as inert text; no injected image or script execution appears.
8. A real activity404 removes all safe detail rows and copied history text while unrelated reads are held.

The backend referenced-person projection was not edited here; its builder verification is in `../activity-reference-repair/` from the parent review directory. These local results do not verify Google sign-in, live providers, Cloudflare/Neon/R2 deployment or UAT behavior. They do not replace the fresh global14-command gate or independent domain reviews.

## Next / your input

Own source is held and own Chrome/Next/API processes have closed; schema cleanup completed. Runtime ports44931/44932 and default `.next` were released to Architect immediately after the successful browser command. Architect can freeze the complete candidate, run the global gates and obtain independent review before any UAT promotion. No user action needed for this bounded builder work.
