# Hosted OAuth backend acceptance — frozen before implementation

Risk: high (browser consent, token issuance, project boundaries and revocation). Scope: additive PostgreSQL migration 0027; hosted OAuth adapter/config/routes; OAuth rate buckets; focused tests. Parent owns transport, app/auth/card/activity wiring and shared contracts. No cloud writes.

- Only explicit APP_ORIGIN determines issuer/resource; resource is `/api/v1/mcp`.
- Public CIMD is bounded to HTTPS `claude.ai`, exact document identity and exact hosted callback. Bounded DCR admits only that callback, no secret or native/external redirect.
- Authorization code + S256 PKCE binds exact client, redirect and resource; pending request expires in ten minutes, code in five, access in fifteen; family expires absolutely after thirty days.
- Cookie session, same-origin request, browser binding and single-use CSRF protect consent. A current project is selected and live membership/Owner inheritance is locked. No board grants are created.
- Token/code values persist only as SHA-256 hashes. Standard OAuth errors do not expose secrets.
- Code exchange and refresh rotate atomically. Correctly bound spent-refresh reuse commits family revocation, denying successor access. Wrong-client misuse cannot revoke a victim.
- Connection/access locks precede existing project/board authorization; revocation conflicts with in-flight locks and blocks future operation/replay. Connection ID remains stable across rotation.
- Existing PAT/session routes remain unchanged. Hosted principal cannot serve as a cookie or PAT.
- Rate/body limits fail closed; DCR cap/retention does not delete active grants. Migration is additive, repeat-safe and embedded through the existing owner script.
- Tests use disposable local PostgreSQL; separate connections cover rotation and revoke-versus-operation. No live-user data.

Required commands: focused `NODE_ENV=test node --test apps/api/test/hosted-oauth.test.ts` with explicit synthetic DATABASE_URL; root `npm run typecheck`; full API tests and embedded migration parity by release owner. Fresh independent reviewer must inspect full reachable target and BACKEND_REVIEW_GATE.md; no self-approval.
