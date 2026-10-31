# Own projects and hard limits: adversarial edge-case review (31 October 2026)

Status: read-only review. No source file, migration, database, deployment or commit was touched; this file is the only output. No secret or connection string was read or written. Every claim is marked **[V file:line]** (verified by reading code on the shared checkout at 685df94 plus the uncommitted B-16 working tree) or **[I]** (inferred, not run). Nothing was executed: no tests, no browser, no SQL. This is design coverage, not implementation or verification status.

Inputs: [own-projects-and-roles-cases-2026-10-31.md](own-projects-and-roles-cases-2026-10-31.md) (the "first report") and [own-projects-decisions-2026-10-31.md](own-projects-decisions-2026-10-31.md) (accepted decisions, which say this review wins where it is stricter or clearer, with the Architect confirming conflicts with the user).

Plain-English terms: an **advisory lock** is a named lock in PostgreSQL that is not tied to a table row; two transactions asking for the same name queue. A **deadlock** is two transactions each waiting for a lock the other holds; PostgreSQL kills one with error 40P01. **Grandfathering** means data already over a limit stays, but nothing new may be added until it falls below.

---

## 1. Headline

1. The 3-project and 5-board limits are easy to state but easy to bypass: there are **two** project-create routes, project and board **reopen** routes, and a no-consent **ownership transfer** that can move projects onto anyone. All five must share one quota check.
2. Nothing can ever be deleted (no delete route for boards or projects), and archived items do not count. So "create, archive, create again" is unlimited unless we add a total ceiling and a board-create rate limit.
3. The obvious way to lock the board count (upgrade the project row lock) deadlocks with the existing code. Use one advisory lock per user and one per project, taken first.
4. A quota error that says "5 of 5 boards" leaks the hidden board count to a Manager who can see only one board. Show the number only to the Owner.
5. Invitation **resend** has no rate limit and anyone can now own a project, so Flowboard becomes an open email relay with attacker-chosen project names. Fix before opening project creation to everyone.
6. A workspace named "<display name>'s Workspace" can exceed the 100-character contract once B-16 allows 121-character names, which makes GET /session fail. Use a fixed internal name.
7. 31 findings: 4 blocker, 8 high, 12 medium, 7 low. Exact rules in section 2.

---

## 2. Recommended exact limit rules (Backend can implement verbatim)

**Counting**

1. **Owned projects (limit 3).** `used = COUNT(*) FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE w.owner_id = :user AND p.archived = FALSE`. It counts every workspace the user owns (a user can own two after a transfer). Project memberships (Manager, Member, Viewer) **never** count, so an invitation or accept can never be refused by this limit.
2. **Boards per project (limit 5).** `used = COUNT(*) FROM boards WHERE project_id = :project AND archived = FALSE`. It does not matter who created the board (Owner or Manager) or whether the project itself is archived. There is no board trash, no default board created with a project, no board duplication and the XLSX import creates no boards or columns **[V: only INSERT INTO boards is adapters/boards.ts:173; projects.ts:165 inserts the project only; IMPORT_SPEC.md:3 "No spreadsheet can create a workspace/project/board"; imports.ts has no INSERT INTO columns/boards]**. "Trashed projects and boards" in the decisions doc do not exist; only cards have trash.
3. **Backstop totals (new, needs the user's yes).** Because nothing can be deleted and archived items do not count, also refuse when **owned projects including archived ≥ 20** per user, or **boards including archived ≥ 25** per project. Without this, 30 project creates per hour allows about 720 archived projects a day, and boards have no rate limit at all. Alternative: build a real delete (large; out of beta scope).
4. **Members per project (limit 50).** `active = COUNT(*) FROM project_memberships WHERE project_id = :p AND status = 'active' AND user_id <> :owner_id` (the Owner is not a member; a former Manager who received the workspace by transfer keeps a membership row and must not be counted twice).
5. **Pending invitations per project (limit 50).** `pending = COUNT(*) FROM project_invitations WHERE project_id = :p AND status = 'pending' AND expires_at > NOW()`. The `expires_at` filter is required because expiry is lazy: an expired invitation keeps `status = 'pending'` until someone touches it **[V invitations.ts:322-328, 887]**.
6. **Seat reservation (recommended).** Invite and resend are refused when `pending >= 50` **or** `active + pending >= 50`. Accept is refused only when `active >= 50`. This way an accepted invitation almost never fails late. (If the user prefers two independent numbers, drop the `active + pending` clause and accept may then fail for some invitees.)

**Where the checks run** (and only there)

7. Owned-project check: `POST /api/v1/projects` (new), `POST /api/v1/workspaces/:id/projects` (old, kept), `POST /api/v1/projects/:id/reopen`, and the transfer target in `POST /api/v1/workspaces/:id/transfer-ownership` (or close that route, finding F-06). All through **one** adapter function, for example `assertOwnedProjectQuota(client, userId)`.
8. Board check: `POST /api/v1/projects/:id/boards` and `POST /api/v1/boards/:id/reopen`. Also any future duplicate, template or import that creates boards.
9. Never checked on: archive (always allowed, it is the way out), leave, accept for project counts, rename, grant changes, sign-in.
10. Member and pending checks: invite, resend, accept (members only).

**Order inside one transaction** (prevents double counting and deadlocks)

11. (a) Quota advisory locks **first, before any row lock**: `pg_advisory_xact_lock(hashtext('fb:quota:user:' || userId))`, then `pg_advisory_xact_lock(hashtext('fb:quota:project:' || projectId))`. When two users are involved (transfer), lock both user ids in sorted order. The personal-workspace ensure helper uses the **same** user key, so it never needs a second lock. (b) The existing authorization locks unchanged (workspace FOR SHARE, membership FOR SHARE, grant FOR SHARE, board FOR UPDATE). (c) The idempotency replay check: a stored answer is returned as is, never `QUOTA_EXCEEDED` and never `RATE_LIMITED`. (d) Rate-limit counters, per actor id, inside the transaction, so a refused or rolled-back attempt is not counted (same pattern as `consumeInvitationScopeLimits` **[V rate-limit-postgres.ts:80-106]**). (e) Count and refuse. (f) Insert.
12. Invitation accept cannot know the project before reading the invitation, so it must read `project_id` by token **without** a lock, take the project quota lock, then `SELECT ... FOR UPDATE` the invitation and check its `project_id` did not change (finding F-04).

**Grandfathering**

13. Existing data over any limit is kept. Creates and reopens are refused while `used >= limit`; archive, edit and every read keep working. Nothing is archived or deleted automatically. A transfer that would put the target over 3 is refused (or the route is closed; see F-06).

**Rate limits**

14. `project-create`: 5 per 60 s and 30 per 3600 s per actor id. Proposed new `board-create`: 10 per 60 s and 60 per 3600 s per actor id. Invitation **resend** spends the existing `invite-inviter` and `invite-project` buckets. Keys are user ids, never IP addresses, so people behind one office NAT are not blocked together.

**Override for the product owner's testing**

15. Every number is a constant with an environment override read once per Worker start: `FB_LIMIT_OWNED_PROJECTS`, `FB_LIMIT_BOARDS_PER_PROJECT`, `FB_LIMIT_OWNED_PROJECTS_TOTAL`, `FB_LIMIT_BOARDS_PER_PROJECT_TOTAL`, `FB_LIMIT_MEMBERS_PER_PROJECT`, `FB_LIMIT_PENDING_INVITES_PER_PROJECT`. Parse as a whole number between 1 and 1000; a missing, empty or invalid value means the **default**, never "no limit" (fail closed). Log the effective values (numbers only) at start. UAT may raise them for testing; production keeps the defaults. No per-user allowlist, no request header, no query parameter, no admin API. If a per-user exception is ever needed, it is a separate table written only by a reviewed migration.

**Error shape**

16. Over a limit: HTTP **409**, `{"error":{"code":"QUOTA_EXCEEDED","message":"…","requestId":"…","details":{"scope":"owned_projects"|"project_boards"|"project_members"|"project_pending_invitations","limit":3,"current":3,"remedy":"archive_project"|"archive_board"|"remove_member"|"revoke_invitation"}}}`. `current` is included only when the caller may already see that number: always for `owned_projects`; for `project_boards` only when the caller is the Owner; for members and invitations only for Owner and Manager (they can already list them). It is checked **after** authorization, so a stranger still gets the private 404.
17. Too fast: HTTP **429**, code `RATE_LIMITED` (the contract's standard code **[V common.ts:20]**; the invitation path uses `TOO_MANY_REQUESTS` **[V rate-limit-postgres.ts:100]**, so pick one and align both), `details.retryAfterSeconds`, plus a `Retry-After` header.
18. Session adds `limits: { ownedProjects: { limit, used } }`; project overview adds `boards: { limit, used? }` (used for the Owner only). The UI never hardcodes 3 or 5, because of rule 15.

---

## 3. Findings (sorted by severity)

| ID | Sev | Scenario (who does what) | What the code does today | What should happen | Fix (layer) | Test that catches it |
|---|---|---|---|---|---|---|
| F-01 | blocker | Priya has 3 active projects. Her browser still calls the old `POST /api/v1/workspaces/<her ws>/projects` (the web app uses it today), or she calls it with curl. | The old route inserts with no count **[V projects.ts:93-214]**. The first report keeps it "for compatibility" **[V first report 3.3]**. If the quota lives only in the new route, the old one bypasses it. | Both routes refuse the 4th with `QUOTA_EXCEEDED`. | Backend: one shared `createOwnedProject` adapter used by both routes; or remove the old route after U1 ships. | Integration: at 3, POST to both routes, each returns 409; count stays 3. |
| F-02 | blocker | Two Managers (or two tabs) press "New board" in a project with 4 boards at the same moment. | Board create takes the project row **FOR SHARE** only **[V idempotency.ts:63-64 → rbac.ts:424-427]**. Both see 4, both insert: 6 boards. If the fix is "SELECT … FOR UPDATE on the project" after that, both hold FOR SHARE and both try to upgrade: deadlock 40P01. The same trap already bit card writes **[V rbac.ts:383-386 comment]**. | Exactly one gets 201, the other 409; no deadlock. | Backend: rule 11, project advisory lock taken before the authorization locks. | Concurrency test: 10 parallel creates at 4 boards, exactly 1 succeeds, 0 errors with code 40P01. |
| F-03 | blocker | Same as F-02 for projects: two tabs create Priya's 3rd and 4th project. Or Priya owns two workspaces (after a transfer) and creates in both. | The old route takes the **workspace** row FOR SHARE **[V projects.ts:127-129]**. The first report proposes "count under FOR UPDATE on the workspace row" **[V first report 5.3]**, but the count is per user across workspaces, so a workspace lock does not serialize two workspaces, and the share-then-update upgrade deadlocks. | One per-user lock covers every create, reopen, transfer and ensure. | Backend: user advisory lock (rule 11). | Parallel creates across two owned workspaces at 2 projects: exactly 1 succeeds. |
| F-04 | blocker | Once member and pending caps add a per-project lock: an Owner resends invitation X while the invitee accepts X. | Resend locks the project context and then the invitation **FOR UPDATE** **[V invitations.ts:296-301 route, adapter 502-519]**. Accept locks the invitation **FOR UPDATE** first **[V invitations.ts:303-307]**. Adding "lock project" to accept after reading the invitation gives opposite orders: deadlock. | Accept and resend never deadlock. | Backend: rule 12 (read project id by token unlocked, lock project, then lock invitation and re-check). | Concurrency test: 50 loops of resend vs accept on one invitation, no 40P01. |
| F-05 | high | A Google account named with 90+ characters signs in, or (after B-16) a user saves first and last names of 60 characters each and then the ensure helper or backfill builds the workspace name. | Workspace name is `${display_name}'s Workspace` **[V google-auth.ts:187, 232]**; Google's name is not length-bounded **[V google-auth.ts:187]**; B-16 allows `displayName` up to 121 **[V packages/contracts/src/auth.ts:8, uncommitted]**; the session workspace summary allows at most 100 **[V auth.ts:15]**; GET /session parses its own response with the schema **[V routes/session.ts:54]**, so a 101+ name throws and the user cannot load the app **[I: not run]**. | Session never fails because of a hidden workspace name. | Backend: ensure helper and backfill 0019 use a fixed internal name (for example `Personal workspace`), never the person's name; also bound `display_name` at sign-in. Deployment: read-count `char_length(name) > 100`. | Unit: ensure helper with a 121-character display name; session parse succeeds. |
| F-06 | high | Mallory creates 3 projects, transfers her whole workspace to Bob (any user id she has seen in a people list), signs in again (a fresh personal workspace is created because she owns none), creates 3 more, repeats. Or she dumps projects named with abuse onto Bob, who now sees them under "Yours" and cannot delete them. | Transfer checks only that the target user exists; no membership, no consent, no limit **[V workspaces.ts:333-347, 368-373]**. Sign-in creates a workspace for anyone who owns none **[V google-auth.ts:225-238]**. ACC-07 says "eligible account" without defining it **[V features.tsv ACC-07]**. | Transfer cannot bypass limits or push content onto strangers. | Backend: for the beta, disable the transfer route behind an env flag (it has no UI). If kept: target must be an active Manager in that workspace, must accept, and the target's quota is checked under both user locks in sorted order. Doc: define "eligible" in ACC-07. | Transfer to a non-member: refused. Transfer that would give the target 4 active: refused. |
| F-07 | high | Any Google user creates "Your account is locked, call +1…" as a project name, invites a victim, then calls resend in a loop. | Resend is outside every window bucket: the IP regex matches only `/projects/:id/invitations` **[V rate-limit.ts:59]** and the per-inviter and per-project counters run only on create **[V routes/invitations.ts:82]**. The soft Cloudflare limiter is not enforcing on UAT **[V UAT_DEPLOY.md:180]**. Resend also turns an expired invitation back into pending **[V invitations.ts:548-566]**. | Resends count like invites; resend respects the pending cap. | Backend: call `consumeInvitationScopeLimits` in resend; apply rules 5-6 in resend. SECURITY_ROADMAP S15. | 21 resends in a minute: the 21st is 429; resend of an expired invite at 50 pending: 409. |
| F-08 | high | Archived items do not count (decision 3) and nothing can be deleted. A script: create board, archive, create, archive… | No delete route for boards or projects exists **[V grep: no `DELETE FROM boards/projects` in apps/api/src]**; no board-create bucket **[V rate-limit.ts:27-38]**; each board inserts 5 columns plus an activity row **[V adapters/boards.ts:188-217]**. | Bounded storage growth per user and per project. | Backend: rules 3 and 14 (backstop totals and board rate limit). User decision for the two backstop numbers. | 26th board including archived refused; 11th board create in a minute 429. |
| F-09 | high | Reopen: Priya has 3 active projects and reopens an archived 4th; a Manager reopens a 6th board. | Project reopen checks only Owner **[V projects.ts:626-695]**; board reopen checks only Owner or granted Manager **[V boards.ts:788-852]**. | Refused with `QUOTA_EXCEEDED` and remedy "archive another first". | Backend: rule 7/8 in both reopen routes. | Reopen at cap: 409; after archiving one: 200. |
| F-10 | high | Manager Ravi (sees 1 of the project's 5 boards) presses New board and gets "5 of 5 boards". | Board counts are deliberately private for non-Owners **[V rbac.ts:723-724]**; PRJ-02 says hidden things leak "no name, count or existence" **[V features.tsv PRJ-02]**. A naive error with `current` leaks it. | Ravi sees "This project has reached its board limit. Ask the project Owner to archive a board." without numbers. | Backend: rule 16; UI copy. | Manager at cap: response has no `current`; Owner at cap: has `current`. |
| F-11 | high | 49 active members, 50 pending; 30 invitees accept. Or two Managers invite at once at 49 pending. | Invite creation locks only workspace and project FOR SHARE **[V invitations.ts:73-77; rbac.ts:424-427]**; the duplicate-pending check is check-then-insert with no unique index **[V invitations.ts:153-165; 0001 has no partial unique index]**; accept has no member count **[V invitations.ts:283-433]**. | Caps hold under concurrency; accept rarely fails. | Backend: project lock (rule 11), seat reservation (rule 6). Database: optional partial unique index on `(project_id, lower(email)) WHERE status = 'pending'` in a later migration. | Parallel 10 invites at 45 pending: exactly 5 succeed. Parallel duplicate invites of one email: exactly 1. |
| F-12 | high | An implementer adds the creator auto-grant by calling the existing grant function. | `changeBoardGrant` requires the actor to be the Owner and refuses the Owner as target **[V board-grants-foundation.ts:76-90]**. So the auto-grant is a **new** self-grant path that bypasses Owner-only administration; the first report says "no existing authorization rule is loosened" **[V first report 5.1]**, which is not true for this path. | Auto-grant only inside `createBoard`, only when the creator is a non-Owner Manager, only for the new board id, in the same transaction, with an audit row. | Backend: insert grant directly after the board insert (membership row is already FOR SHARE-locked by `acquireWriteGrantLock` **[V rbac.ts:334-340]**), `granted_by = creator`, record `board_access_granted` with `source: 'creator'`. Doc: amend board-access-decisions-2026-10-27.md:7 and :16. | Manager creates board A: grant only on A; cannot grant anyone; existing board B unchanged; Member cannot create. |
| F-13 | medium | Priya receives Shubham's older workspace by transfer. She creates a new project, which goes to her "primary" workspace. Later she transfers Shubham's workspace back; her new project leaves with it. | First report picks primary as "oldest owned by created_at, id" **[V first report 3.2]**; session sorts owned workspaces by name **[V rbac.ts:100-104]**. | A personal workspace is marked, not guessed. | Database: in 0019 add `workspaces.is_personal BOOLEAN NOT NULL DEFAULT FALSE` and a partial unique index on `(owner_id) WHERE is_personal`; backfill marks each owner's earliest workspace; transfer clears the flag on the moved workspace. (Conflicts with decision 4's "revisit later"; Architect to confirm.) | Two-workspace user: new project lands in the flagged one. |
| F-14 | medium | Priya clicks Create on a slow network; the response is lost; she clicks again. | The projects page passes no key, so each call gets a fresh one **[V projects/page.tsx:75; api.ts:194-199]**. The board dialog keeps one key per attempt **[V new-board-dialog.tsx:44]**. | One project, even on retry; a cap of 3 makes duplicates costly. | UI: keep a key per open dialog, as the board dialog does. | Component test: two submits with a forced network error produce one key. |
| F-15 | medium | The first report says the double Google callback can create two workspaces. | The user upsert `ON CONFLICT (email) DO UPDATE` locks the user row, so a second callback waits for the first to commit and then sees its workspace **[I from google-auth.ts:202-238 under READ COMMITTED; not run]**. The real races are callback vs the new ensure on `POST /projects`, and the backfill vs a live sign-in (random `ws_<uuid>` vs deterministic `ws_<md5>` id). | No duplicate on any path. | Backend: every ensure path takes the user advisory lock first (rule 11). Deployment: after 0019, read-count owners with more than one workspace. | Parallel callback + POST /projects for a workspace-less user: 1 workspace. |
| F-16 | medium | UAT is set to 10 projects for testing; the UI says "3 of 3". Or an env typo `FB_LIMIT_OWNED_PROJECTS=3O` turns into `NaN` and every comparison is false (unlimited). | No limit code exists yet **[V grep]**. | UI shows server values; bad values mean defaults. | Backend: rules 15 and 18. Contract: `limits` in session. | Unit: parse '', '0', '3O', '-1', '5000' → default or clamp. |
| F-17 | medium | Project or board named with a right-to-left override, for example "Invoice ‮fdp.exe". | Project and board names are only trimmed and length-checked **[V contracts projects.ts:53, boards.ts:24]**; the email strips control characters but not format characters **[V invitation-email.ts:39]**, and the subject is built from the project name **[V invitation-email.ts:226]**. B-16 already refuses these for person names **[V auth.ts REFUSED_NAME_CHARACTERS, uncommitted]**. | Same refusal for project and board names. | Contract: reuse the B-16 character rule on create and update; email: also strip `\p{Cf}`. | Contract test with U+202E and U+200B. |
| F-18 | medium | Invitee accepts into a project the Owner archived after sending. | Accept has no archived check **[V invitations.ts:283-433; create/resend/revoke have one at 86, 471, ~690]**; the accept screen has a "This project is archived" state that therefore never shows **[V accept-screen.tsx:66, 135]**. | Accept into an archived project is refused with `READ_ONLY_CONTEXT`, matching the UI. | Backend. | Archive, then accept: 409 READ_ONLY_CONTEXT. |
| F-19 | medium | Rate limit implemented in the router middleware (like the per-IP `invite` bucket) rather than in the transaction. | Middleware buckets count before authorization and replay and key on IP **[V rate-limit.ts:56-76, 83-87]**. | Replays and refusals do not spend tokens; per user, not per IP. | Backend: rule 11(d) and 14. | Replay the same key 10 times: 0 tokens spent. |
| F-20 | medium | Closing `POST /api/v1/workspaces`. | Used as setup by 7 test files (acc04-workspaces 13 calls, acc-lifecycle, att01-att07, aud-ntf, imp01-imp06, lifecycle-undo, ux-integration) and 3 audit scripts (scripts/execute_acc_lifecycle_audit.py, execute_aud_ntf_audit.py, execute_qry_audit.py) **[V grep]**; no web caller **[V api.ts:185-187 only GET]**. ACC-04's definition "Account creates a workspace" and its passing handoff become false **[V features.tsv ACC-04; docs/handoffs/backend/ACC-04.json]**. | Tests use a fixture helper; ACC-04 re-scoped to "personal workspace ensured". | Backend tests, Architect docs (features.tsv, FEATURE_CHECKLIST regenerated, API.md). | Suite green with route returning 404/410. |
| F-21 | medium | Manager Ravi is downgraded to Member after creating board A. | The grant-clearing trigger fires only on a **status** change, not a role change **[V 0007_board_grants.sql trigger `IF OLD.status IS DISTINCT FROM NEW.status`]**; so Ravi keeps access to A and can edit cards (Member rights), but cannot archive or add columns **[V rbac.ts:372-374]**. On removal his grants go and his boards stay, still counting toward the project's 5. | Document as intended: a grant is board access; the role decides actions. | Doc: decisions note. | Downgrade: still reads A, 403 on archive; removal: 404 on A, board count unchanged. |
| F-22 | medium | Owner wants to know which boards a Manager made, or a pre-change Manager board must be granted. | `boards` has no `created_by` **[V grep migrations]**; the creator exists only in the `board_created` activity row, which is board-scoped **[V adapters/boards.ts:208-217]**. Boards Managers created before the change have no grant and the auto-grant will not cover them. | Clear rule for old boards. | Database: optional `boards.created_by TEXT NULL REFERENCES users` in 0019 (no backfill needed). Decision: no retroactive grants; Owner grants old boards by hand. | Migration test: column nullable, existing rows untouched. |
| F-23 | medium | First-run landing for a person with shared projects only (decision 2). | Landing goes to a remembered location first, else the only open project **[V landing.ts:9-20]**; the accept screen links straight into the project, which then becomes the remembered location **[I accept-screen.tsx accepted state]**. Two copies of the rule exist **[V landing.ts:6-8 comment; functions/_middleware.ts:57-64]**. | A concrete predicate: if the user owns no active project **and** has no remembered location, land on `/projects`. Same in both copies. | UI (landing.ts and _middleware.ts together). | Unit for both functions with the same fixture table. |
| F-24 | medium | B-16 (names) and quotas meet. An inviter with an unconfirmed Google name sends invitations; the email shows that name **[V invitations.ts:19-23 reads `display_name`]**. A user with `needsName` creates a project. | Name check exists only on accept **[V routes/invitations.ts:144-146]**. | Creating a project does **not** require a confirmed name (keeps first run simple). Sending an invitation does, so emails carry a real name. | Backend (invite route), UI (name prompt before the invite dialog). | Invite with `needsName`: 409 NAME_REQUIRED; create project: 201. |
| F-25 | low | Members-per-project count after a transfer to a former Manager. | That user is now Owner **and** keeps an active membership row **[I: transfer does not touch memberships, workspaces.ts:368-373]**. | Not counted twice. | Backend: rule 4 excludes `owner_id`. | Transfer to member, count = previous − 1. |
| F-26 | low | Hiding the sharer's workspace name. | Restricting `GET /api/v1/workspaces` is not enough: `getProjectAccessSummary` returns `workspaceName` and the owner's name to every member **[V rbac.ts:696-707, 756-766]**. | Accept: the Owner's name is meant to be visible; the workspace name becomes neutral once F-05's fixed name is used for new workspaces. | Doc; optional: drop `workspaceName` from the summary later. | none needed |
| F-27 | low | Counting owned projects and finding a user's workspace. | No index on `workspaces(owner_id)` **[V 0001_initial.sql index list]**. | Index exists. | Database: `CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id)` in 0019 (tiny table; plain create is fine). | Migration test. |
| F-28 | low | A person's Google email changes, or they use a second Google account. | Users are keyed by email; Google's stable `sub` is parsed but unused **[V google-auth.ts:27, 208-210]**. The new email becomes a new user with a fresh allowance of 3 and none of the old memberships. | Known residual for the beta. | Doc now; later: store `google_sub`. | none in beta |
| F-29 | low | Ensure on invitation accept (first report B1). | Accept does not need a workspace; Google sign-in already ensures one **[V google-auth.ts:225-238]**. Adding it enlarges the accept transaction and adds a lock-order case. | Ensure only at sign-in and in the create-project route. | Backend: drop ensure from accept. | n/a |
| F-30 | low | Board archive or reopen inside an archived project. | Those routes skip `acquireWritableProjectContextLock` **[V boards.ts:687-688, 804-805]**, unlike other writes; the spec says an archived project makes its boards read-only **[V FEATURE_SPEC.md:53]**. | Refused with `READ_ONLY_CONTEXT`; this also keeps board counts stable while a project is archived. | Backend. | Archive project, then board reopen: 409. |
| F-31 | low | Error code drift. | Existing limits use 400 `COLUMN_LIMIT_EXCEEDED` **[V adapters/boards.ts:472]**; invitation 429 uses `TOO_MANY_REQUESTS` while the contract lists `RATE_LIMITED` **[V common.ts:20; rate-limit-postgres.ts:100]**. | One code per meaning (rules 16-17), registered in contracts and `apps/web/src/lib/error-codes.ts`. | Contract, UI. | Contract snapshot of error codes. |

Severity counts: **blocker 4** (F-01 to F-04), **high 8** (F-05 to F-12), **medium 12** (F-13 to F-24), **low 7** (F-25 to F-31).

### UX contract for the limits (applies to U1, U4)

- The Create project button stays visible at the cap. It opens a short panel instead of the form: "You have 3 of 3 active projects. Archive a project to create another." with a link to the Archived tab and to the project list. Do not use a disabled button with no reason.
- The message goes in an element with `role="status"` (or `role="alert"` when it appears after pressing Create), and the button gets `aria-describedby` pointing at it. Text, not colour, carries the meaning.
- For a Manager at the board cap: "This project has reached its board limit. Ask the project Owner to archive a board." No numbers (F-10).
- For 429: "You are creating projects too quickly. Try again in N seconds." using `retryAfterSeconds`; keep the typed name in the form.
- Mobile (375 px): the panel stacks under the header; the switcher truncates long project names with an ellipsis and keeps the full name in the accessible name; the role chip never wraps under the name.
- The word "workspace" never appears, including in quota messages ("active projects", not "projects in your workspace").

---

## 4. Corrections to the first report

1. **Double callback race (2.1, 3.2).** Two parallel Google callbacks for one user are serialized by the user-row upsert lock **[I]**. The races that remain are between the callback, the new ensure in `POST /projects`, and the backfill (F-15).
2. **"Count under FOR UPDATE on the workspace row" (5.3).** Wrong lock: the 3-project count is per user across workspaces, and upgrading FOR SHARE to FOR UPDATE deadlocks. Use the advisory locks of rule 11 (F-02, F-03).
3. **Backfill name and number (6).** `0018_personal_workspace_backfill.sql` is taken by B-16 names; use **0019**. Its proposed name `<display_name>'s Workspace` can exceed 100 characters and break the session (F-05).
4. **"No existing authorization rule is loosened" (1.8, 5.1).** The creator auto-grant is a new self-grant path outside Owner-only grant administration; it needs its own tests (F-12).
5. **Keeping the old create route (3.3)** is safe only if it shares the quota adapter (F-01).
6. **Reopen and transfer** were not listed as places where limits apply (F-06, F-09).
7. **Archive as the way out vs nothing can be deleted.** With archived items not counting, the report's numbers alone allow unlimited churn; it proposed no board rate limit in the user's final list and no total ceiling (F-08).
8. **Leak claim about `GET /api/v1/workspaces` (5.2).** Restricting it hides less than claimed; the access summary already returns the workspace and owner names (F-26).
9. **Accept already blocks archived projects (4.1 F-rows, implied).** It does not; only create, resend and revoke do (F-18).
10. **Resend** is listed as "same, none" (case F3) but is an unlimited email sender (F-07).
11. **Primary workspace by oldest `created_at` (3.2)** can put new projects into a received workspace (F-13).
12. **Quota response "409 or 429"** is now split: 409 `QUOTA_EXCEEDED` for limits, 429 for speed, with a defined body (rules 16-17).
13. **Dropped numbers.** The report's "100 boards per user" and "50 non-Owner memberships per person" are not in the user's new list. Memberships stay unlimited (an invitation must never be blocked by the invitee's state); the session list is unbounded **[V rbac.ts:117-170]**, so paginate later.
14. **Decisions doc wording.** "Archived and trashed projects and boards do not count": projects and boards have no trash state, only cards do **[V 0001_initial.sql: `state` exists only on cards]**. Should read "archived projects and boards do not count".

---

## 5. Extra tests to add

Backend (PostgreSQL, real transactions):

1. Old and new project routes both refuse the 4th active project; archived projects do not count; the 21st including archived is refused (if rule 3 is accepted).
2. Idempotent replay at the cap returns the original 201 and spends no rate-limit token.
3. 10 parallel project creates at 2 active: exactly 1 succeeds, none fails with 40P01.
4. 10 parallel board creates at 4 boards by two Managers and the Owner: exactly 1 succeeds.
5. Project reopen and board reopen at the cap: 409; after archiving one: 200.
6. Grandfathered project with 7 boards: create and reopen refused, archive allowed, edits allowed.
7. Manager at board cap gets no `current`; Owner gets `current: 5`; stranger gets 404 before any quota logic.
8. Creator auto-grant: grant only on the new board, `granted_by` the creator, one audit row; Owner creating gets no grant row; Member and Viewer still 403; the Manager still cannot grant anyone.
9. Downgrade Manager to Member keeps the grant; removal clears it; the board still counts.
10. Invite and resend at `active + pending = 50`: 409; accept at 50 active: 409; expired-but-pending rows are not counted.
11. 50 loops of resend vs accept on the same invitation: no deadlock.
12. Resend counts toward `invite-inviter` and `invite-project` buckets.
13. Accept into an archived project: 409 `READ_ONLY_CONTEXT`.
14. Transfer to a non-member or over the target's cap: refused (or route disabled: 404).
15. Ensure helper with a 121-character display name: workspace name ≤ 100; GET /session parses.
16. Parallel Google callback and `POST /api/v1/projects` for a user with no workspace: one workspace.
17. Migration 0019 run twice: second run inserts 0 rows; `is_personal` unique per owner; index exists; works with 0018 applied or not (the runner fills gaps **[V migrations.ts:60-100]**).
18. Env override parser: invalid values fall back to defaults.
19. Project and board names with U+202E or U+200B: 422.
20. Invite while `needsName`: 409 NAME_REQUIRED.

Web:

21. Projects page: one Idempotency-Key per open create dialog across retries.
22. Cap panel shown at 3 of 3 with archive link; values come from `session.limits`, not constants.
23. Manager board-cap message has no numbers.
24. `landingFor` and the middleware `landingPath` agree on a shared fixture table, including "no owned project and no remembered location → /projects".
25. Accept screen handles `QUOTA_EXCEEDED` (project full) and `NAME_REQUIRED`.

Deployment (read-only counts on UAT before and after 0019, numbers only, no names or emails recorded):

26. Users with no owned workspace; owners with more than one workspace; workspaces with `char_length(name) > 100`; users with `char_length(display_name) > 88`; users with more than 3 active owned projects; projects with more than 5 active boards; projects with more than 50 active non-owner members; projects with more than 50 unexpired pending invitations. After: users without a workspace = 0; owners with more than one `is_personal` = 0.

---

## 6. Things I could not verify

- Nothing was executed. Every concurrency and deadlock claim is reasoning from the lock statements, not an observed run.
- Whether `getSessionResponseSchema.parse` failure surfaces as a 500 (and blocks the app) depends on the error middleware; read only the parse call **[V routes/session.ts:54]**.
- `updateProjectMember` and `removeProjectMember` were read only for their checks (members.ts:17-300), not line by line; F-21 relies on the trigger text.
- The resend and revoke adapters were read in part (invitations.ts:444-670); the exact lock order inside resend after the route's locks was inferred from the `FOR UPDATE` at 519.
- The accept screen's post-accept navigation and whether it writes `lastLocation` were inferred (F-23).
- The rail, settings and "Manage" group were not re-read; the first report's UI findings there are taken as given.
- `functions/_middleware.ts` was read only around `landingPath` (lines 57-113).
- The B-16 work is uncommitted and may change (`displayName` 121, `needsName`, NAME_REQUIRED placement).
- I did not check whether UAT has users with long names, multiple workspaces or over-limit projects; section 5 item 26 is how Deployment finds out.
- The backstop totals (20 projects, 25 boards), the board-create rate limit (10/60 s, 60/3600 s) and seat reservation are my proposals, not the user's numbers; they need the user's yes.
