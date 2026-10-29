# UAT signed-in checklist (build 0d2b527, 2026-10-29)

URL: https://flowboard-app-uat.pages.dev/signin. Worker flowboard-api-uat ed08da94, Pages 12359b3d. Prototype for comparison: http://127.0.0.1:4173/index.html?project=website-redesign&board=board_website (restart it if it is not running).
Use a throwaway project. Do not use real customer data. Note each failure with the page, what you clicked, what you expected, and what happened (a screenshot helps).

1. Sign in with Google. Expect the gradient Flowboard wordmark, then your projects. Reload: still signed in.
2. Projects hub: create a project. Open it.
3. Project page: create a board. Open it.
4. Board: add a card from the column, then from the Add card page. Expect the card key (such as PRJ-1), title, and counters.
5. Drag a card to another column with the mouse. Reload: it stays. Then move one with the keyboard or the move button.
6. Open a card: edit title and description, add a comment, check the Activity tab shows your actions.
7. Attach an image to a card and view it. Open the image URL in a private window: it must NOT load.
8. Delete a card. Open Trash: see the 24-hour countdown, restore it, confirm it returns to its column.
9. Import: upload a small valid XLSX, review the preview, commit. Then try a broken file: expect a clear error and no partial cards.
10. People: open Manage members and Board access dialogs. Change a role or grant on a test member, then revert.
11. Invitation: create one, open the link in a private window (do not accept unless you have a second Google account).
12. Inbox, My tasks, Activity: check they load, filters work, and links open the right card.
13. Settings: rename the project or board, toggle theme light and dark. Reload: theme persists.
14. Sign out. Expect the sign-in page, and the browser Back button must not show board data.
15. Narrow the window to phone width and repeat steps 4 to 6 quickly.

Known not built: share dialog, column editor, archive/reopen, invitation preview, per-column paging. These show a "Soon" label by design.
Rate limit note: sign-in is limited to 10 per minute per address. If you hit it, wait a minute.
