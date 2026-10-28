# UAT-first release policy — 2026-10-28

Decided by the user in chat. Two environments only: UAT and PROD (local development aside). The `dev` environment is dropped.

- No production cutover today. There are no live users, so nothing forces a rushed release.
- Changes are deployed to UAT on a periodic basis and verified there (sign-in, board/card flows, cookie attributes, rejections).
- One planned, rehearsed production deployment happens only when: the UI/UX is complete for the beta scope; backend and database blockers are resolved; an independent review has been re-run for the features that currently rely on `2026-10-28-beta-risk-acceptance.md`; and the user gives an explicit go.
- Production today: old build (cross-site cookies, wildcard pages.dev CORS). Sign-in works. The user set `CURSOR_SECRET` and `DEV_LOGIN_SECRET` on the production Worker. Production migration state is unverified (psql not installed on the user's machine; use another read-only route before cutover).
- Before the production cutover: Neon backup branch with data, migration plan, rollback anchors per docs/RELEASE_BETA.md.
