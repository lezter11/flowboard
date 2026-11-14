# Card drawer save and navigation repair

Status is locally verified. UAT deployment is pending. The repair is a frontend change on top of the Google Drive links candidate `f6fe80cd9832df4dd4b47939b9d2f1e6279ae8b8`. Its own diff has no database or API changes. Deploying that combined candidate requires the separate Drive-link review and migration checks. The hosted banner was outside the repair scope.

## Findings and changes

- The independent reviewer reproduced an unsaved warning on an untouched board with a saved description ending in spaces. It also reproduced a false close warning when opening an existing comment editor without typing and when dismissing a delete confirmation with Escape. Saved board metadata and project briefs now compare consistently. Opening a comment menu or dismissing a confirmation leaves no dirty marker.
- A status selection used to leave a draft waiting for a separate Move action. It now sends a move to the end of that column directly. Card field edits still use Save changes. If the move result is uncertain, retrying reuses the original operation and version.
- Comments and photos can finish after the drawer closes in the current tab. Failed comments keep the text and retry the original request if the result is uncertain. Image finalization refreshes the board badge and card activity. Text with an inline clipboard image can be pasted into an editable field without starting an upload.
- Comment and activity lists retain their useful Load more controls. The redundant status line is gone. Closing with actual unsaved edits still offers to keep the draft, which the tab protects on reload.

## Verification

- `npm run test --workspace @flowboard/web` passed all 357 tests.
- `npm run typecheck:web`, `git diff --check`, and `NEXT_EXPORT=true NEXT_DIST_DIR=.next-drawer-save NEXT_TELEMETRY_DISABLED=1 npm run build:web` exited 0.
- Eight [Chrome cases](BROWSER.json) used the static export, the local Hono API, synthetic users and a disposable PostgreSQL 17.11 database. No hosted accounts or environments were used. Run `scripts/e2e/card-drawer-save.mjs` with `NODE_ENV=test`, a loopback `FLOWBOARD_UI_TEST_DATABASE_URL` as specified in `scripts/e2e/server.mjs`, and a writable `FLOWBOARD_DRAWER_BROWSER_RESULT` path.

## UAT smoke checklist

1. Open an untouched card, close it, and navigate from the board to Projects. Neither step should show an unsaved warning.
2. Post a comment or attach a small PNG. Close the drawer before completion. Reopen the card and check both entries are visible without a second save. The board image badge should update.
3. Pick a new status and confirm the card moves. Edit a title without saving, close and keep the draft, and confirm it is still present when you reopen.
