# Everyone can own projects, roles decide inside shared projects: cases, risks and plan (31 October 2026)

Status: research proposal. Nothing was edited, migrated, deployed or run against any database. No secret was read. Every claim is marked **[V]** (verified in code or docs, with file:line) or **[I]** (inferred, not run). This is design coverage, not implementation or verification status.

Plain-English terms used below: a **workspace** is the hidden container a person's projects live in. The **Owner** of a project is whoever owns its workspace (there is no per-project owner row). A **grant** is permission for one board. **Idempotent** means running something twice has the same effect as once. A **tenancy filter** is a `WHERE workspace_id = ...` style rule that keeps one customer's data apart from another's.

---

## 1. Summary

1. **The premise is only half true today.** Every Google sign-in already creates a personal workspace "<Name>'s Workspace" if the person owns none, and it does so for invitees too, at first sign-in, before they accept anything **[V google-auth.ts:213-231]**.
2. So an invited Member or Viewer who signed in with Google **already owns a workspace**, the **API already lets them create projects** in it, and the **UI "New project" button is already shown** (gate is "owns at least one workspace") **[V projects/page.tsx:45-46, 97; projects.ts route POST /workspaces/:id/projects]**.
3. They feel "stuck" for other reasons: they land straight inside the one shared project (no hub screen, so no button) **[V landing.ts:12-14]**; the only Create-project button is on `/projects` **[V]**; the sidebar shows the wrong workspace label inside someone else's project **[V active-project.ts:22-24]**; the project list is one flat list with no "Yours" / "Shared with you" split **[V projects/page.tsx:140]**; and the empty-state copy "No project has been shared with you yet" is wrong for a person who can create **[V projects/page.tsx:86]**.
4. There are real gaps behind the scenes: workspace creation is not guarded against a double sign-in race **[V no unique index; google-auth.ts:215-231]**, `POST /api/v1/workspaces` is open and unlimited **[V workspaces.ts:19-121]**, there is no quota on projects, boards or workspaces **[V]**, and a user who later owns two workspaces breaks UI code that uses `ownedWorkspaces[0]` **[V projects/page.tsx:75, active-project.ts:23]**.
5. Also, a Manager can create a board but cannot see it until the Owner grants access (by the user's own 27 Oct decision) **[V boards.ts:268; board-access-decisions-2026-10-27.md]**. That conflicts with "Manager can create boards" feeling useful.
6. **Recommended model:** keep one hidden personal workspace per person, created at first sign-in (already true) and ensured again on invitation accept and on project create. Add a workspace-less `POST /api/v1/projects` so the UI never picks a workspace. In the UI show two sections, **Yours** and **Shared with you**, with a role chip, a Create project button always visible, and "workspace" removed from visible copy.
7. Keep project-only access, per-board grants, Owner/Manager administration and the four roles unchanged. Add concrete quotas (section 5).
8. The change is mostly UI, plus one small additive API route, a quota layer, a backfill migration and tests. No existing authorization rule is loosened.
9. 8 open decisions need the user (section 8). Largest: should a Manager who creates a board automatically get access to it.

---

## 2. Verified current behaviour

### 2.1 Sign-in and workspace creation

| Fact | Evidence |
|---|---|
| Google callback upserts the user by email (`ON CONFLICT (email)`), so an invited email that already has a user reuses that user. | **[V]** google-auth.ts:197-216 |
| It then checks `SELECT id FROM workspaces WHERE owner_id=$1 LIMIT 1`; if none, it inserts `ws_<uuid>` named `${display_name}'s Workspace`, timezone UTC. No check of invitation status: invitees get one too. | **[V]** google-auth.ts:213-231 |
| This happens inside the sign-in transaction, before any invitation is accepted. Accepting does **not** create a workspace. | **[V]** google-auth.ts:187-231; invitations.ts:283-407 (no workspace insert) |
| There is no unique index on `workspaces.owner_id`, and the check-then-insert is not locked, so two simultaneous first sign-ins could create two workspaces. | **[V]** embedded-migrations.ts 0001 (workspaces table has no unique), 0003 adds only FK; **[I]** the race is possible under READ COMMITTED |
| Dev-login (`createDevUserAndSession`) inserts a user and a session but **no workspace**. It is blocked on deployed Workers. | **[V]** session.ts:210-248; session.ts routes dev-login guard 109-119 |
| `INSERT INTO workspaces` exists in only two places: Google callback and `POST /api/v1/workspaces`. | **[V]** grep, google-auth.ts:225, workspaces.ts:73 |

### 2.2 Who is "Owner"

| Fact | Evidence |
|---|---|
| `resolveProjectRole` returns `'owner'` if the actor owns the project's workspace, else the active `project_memberships.role`. | **[V]** rbac.ts:47-85 |
| `project_memberships.role` can only be manager/member/viewer (DB check). Owner is never a membership row. | **[V]** embedded-migrations.ts 0001 |
| `getAccessibleProjects` returns every project in workspaces the user owns (role `owner`) plus every project with an active membership. | **[V]** rbac.ts:117-170 |
| `getOwnedWorkspaces` returns workspaces the user owns, sorted **by name**. | **[V]** rbac.ts:87-115 (`ORDER BY name ASC`) |
| `GET /api/v1/workspaces` returns owned workspaces **and** workspaces where the user has any active project membership. So a member receives the other person's workspace name. The web app declares `listWorkspaces` but no screen uses it. | **[V]** workspaces.ts:123-160; api.ts:185; grep shows no other web caller |
| Session response shape: `actor`, `ownedWorkspaces[]`, `accessibleProjects[]`, optional `lastLocation`. A project summary carries `workspaceId`, `role`, `isArchived`, `defaultBoardId`. No owner name, no "shared" flag. | **[V]** packages/contracts/src/auth.ts:22-69; session route 38-59 |

### 2.3 Creating things

| Action | Current rule | Evidence |
|---|---|---|
| Create workspace | Any signed-in user, any number, no quota. | **[V]** workspaces.ts:19-121 |
| Create project | Allowed only if `workspaces.owner_id = actor.id` for the path workspace; otherwise 404. Idempotency key required. No cap, no rate limit. | **[V]** projects.ts POST `/api/v1/workspaces/:workspaceId/projects` (checks at `SELECT ... WHERE id=$1 AND owner_id=$2` and again `FOR SHARE`); rate buckets list has no project bucket, rate-limit.ts:27-38 and windowBucketsFor 56-76 |
| Create board | `createBoard` calls `acquireWriteGrantLock(..., 'manager')`: Owner or Manager passes; Member and Viewer get 403. No cap, no rate limit. | **[V]** boards.ts adapters:137-143; rbac.ts:297-352 |
| New board grants | `createBoard` inserts **no** `board_grants` row. A non-Owner lists only boards they hold a grant for. So a Manager's new board is invisible to that Manager until the Owner grants it. | **[V]** boards.ts adapters:137-235, 262-272; decisions doc "A Manager creating a board cannot open it until the Owner grants access." |
| Archive / reopen project | Owner only. | **[V]** projects.ts:45-64, 550-564 |
| Delete project, delete workspace, delete account | No route exists; all foreign keys are `ON DELETE RESTRICT`. | **[V]** grep of `.delete(`/DELETE statements; embedded-migrations.ts 0001/0003 |
| Transfer ownership | `POST /workspaces/:id/transfer-ownership` moves the **whole workspace** (all its projects) to another user. No web UI found. | **[V]** workspaces.ts:258-380; grep of web src |
| Leave a project | API exists (`POST /projects/:id/leave`, Owner refused). **No web caller** (`leaveProject` not in api.ts; "leave" strings in settings are unrelated). | **[V]** invitations.ts adapters:911-1028; routes invitations.ts:454; grep web |

### 2.4 Invitations

| Fact | Evidence |
|---|---|
| Accept requires a signed-in user whose email equals the invitation email, else 403 `EMAIL_MISMATCH`. | **[V]** invitations.ts adapters:~335-345 |
| Pending only: used, revoked or unknown token gives 400 `INVALID_INVITATION`. Expired gives 400 `INVITATION_EXPIRED` and flips status. | **[V]** adapters:~312-330 |
| An Owner of the project's workspace cannot accept (400 `ALREADY_MEMBER`). Active member accepting again: `ALREADY_MEMBER`. Removed member: allowed only if the invitation was issued after the removal, else `INVITATION_SUPERSEDED`. | **[V]** adapters:~347-385 |
| Accept inserts or reactivates `project_memberships` in the **inviter's** workspace (`invitation.workspace_id`); it never touches the invitee's own workspace. | **[V]** adapters:~387-407 |
| Replaying the same accept (same Idempotency-Key) returns the stored answer after re-checking membership is still active. | **[V]** routes invitations.ts:144-168 |
| Resend rotates the token and extends expiry. Revoke exists. Invite rate limits: per IP 10/min; per inviter 20/min, 200/hour; per project 30/min, 300/hour. | **[V]** adapters:439-444; rate-limit.ts:27-38 |
| The accept screen shows no project name, inviter or role before acceptance; the token is read once and removed from the URL. | **[V]** accept-screen.tsx comment before `AcceptScreen`, lines ~74-100 |

### 2.5 Web

| Fact | Evidence |
|---|---|
| "New project" shows when `ownedWorkspaces.length > 0` and always posts to `workspaces[0]` (the alphabetically first owned workspace). | **[V]** projects/page.tsx:45-46, 75, 97 |
| Empty-state copy says "No project has been shared with you yet. Ask a project owner to add you." when the user cannot create. | **[V]** projects/page.tsx:86 |
| Project list is one flat list (Active/Archived tabs), no Yours / Shared split, no role chip on the card. | **[V]** projects/page.tsx:116-216 |
| After sign-in: remembered location, else if exactly one open project go to it (and its only board), else `/projects`. | **[V]** landing.ts:9-20 |
| Sidebar header "workspace switcher" shows `workspace?.name`, resolved as the owned workspace of the current project, **falling back to `ownedWorkspaces[0]`**. Inside someone else's project it therefore shows the viewer's own personal workspace name. It also shows `projects.length` (all accessible projects) as the project count. It links to `/projects`; it is not a real switcher. | **[V]** active-project.ts:22-24; rail.tsx:~97, 108-117 |
| Outside a project, the UI role is "strongest of owner-if-owns-a-workspace, else best project role". Because everyone owns a workspace, every user off a project page is treated as Owner in the UI, so the rail "Manage" group (rail.tsx:146) shows for a Viewer-only invitee. Server still enforces; this is a UI-only inaccuracy. | **[V]** active-project.ts:31-34; rail.tsx:99, 146 (code read, not run in a browser) |
| Project page "New board" shows when `can(role,'manageBoard')`, i.e. Owner or Manager. | **[V]** project-view.tsx:34, 115; roles.ts PERMISSIONS |
| My tasks, trash, people, import, activity, settings pages loop over `accessibleProjects` (My tasks calls the API once per open project, also for the sidebar badge). | **[V]** rail.tsx:70-73; my-tasks/page.tsx:34; trash/page.tsx:33; people/page.tsx:20; import/page.tsx:49 |
| Portfolio fetches boards for every accessible project, then a snapshot per board, for the counts. | **[V]** portfolio.ts:29-40 |

### 2.6 Docs

| Fact | Evidence |
|---|---|
| Role table: "Create a project; archive/reopen project: Owner yes, Manager/Member/Viewer no." Owner and Manager can create/archive boards. | **[V]** FEATURE_SPEC.md:~24-26 |
| "Owner's initial screen: project list with Create project. Invitee's initial screen: only granted projects and invitation acceptance." This is what the user wants changed. | **[V]** FEATURE_SPEC.md:~49 |
| Project-only access; per-board access; "Holding a workspace account does not reveal a sibling project." Manager may create boards, Owner-only grant administration, no automatic grants. | **[V]** FEATURE_SPEC.md:~141-145; board-access-decisions-2026-10-27.md |
| ACC-06 "Owned and invited context switcher" and PRJ-02 "Owned projects and invited projects are paginated and scoped" are already in the checklist (both unticked). The target model matches them. | **[V]** FEATURE_CHECKLIST.md:29, 37 |
| ARCHITECTURE.md: "One workspace owner accesses all owned projects; other accounts need explicit project_memberships". Consistent with the target. | **[V]** ARCHITECTURE.md:69 |
| A **generated** route-authorization test (SECURITY_ROADMAP item S2) is planned. I found no such generated test in `apps/api/test`; the closest is the hand-written `rbac01-matrix.test.ts` and `prj01-projects.test.ts`. | **[V]** SECURITY_ROADMAP.md:30; test dir listing; **[I]** it may live elsewhere |

### 2.7 Direct answers

- **(a) Can an invitee create a project today via the API?** Yes, if they have an owned workspace, which every Google-signed-in invitee gets at first sign-in. They call `POST /api/v1/workspaces/<their own workspace id>/projects`. The project is theirs and Owner-only for them. They cannot create one inside the inviter's workspace (404). Even with no workspace they could first call `POST /api/v1/workspaces`. **[V]**
- **(b) Does the UI hide or show it?** It shows the button on `/projects` for any user with an owned workspace, so it is **shown** for Google invitees; hidden only for users with zero owned workspaces (for example dev-login users, or a user who transferred their only workspace away until their next sign-in). The button is not on any other screen. **[V]**
- **(c) Does the API check workspace Owner or project Owner?** Workspace owner: `workspaces.owner_id = actor.id`. There is no separate project-Owner concept; project "Owner" is derived from workspace ownership (rbac.ts:47-70). Board creation then checks Owner-or-Manager of the project. **[V]**
- **(d) What does an invited Member or Viewer see on first sign-in?** Sign-in creates their personal workspace (empty). If they came from the invitation link, the callback returns them to the accept page (safe-next), they accept, and the session now lists one project. Landing logic: exactly one open project, so they go straight to that project (or its only board if they hold a grant), skipping `/projects`. If they hold no board grant (the default after the 27 Oct decision) they see the project page with "No boards available ... ask an owner for board access". The rail header shows "<Their Name>'s Workspace, 1 project" and, because of the role fallback, a Manage group. On `/projects` (if they navigate there) they see their one shared project in a flat list, a "New project" button, and no hint that they can own something. **[V code read; not run]**

---

## 3. Target model and options

### 3.1 Rules (what "done" means)

1. Every person has **at least one** workspace they own, created for them however they arrived. For the beta, **exactly one personal workspace** and no way to create more (see 3.2).
2. Anyone can create a project in their own workspace and then boards, invite people, and is Owner there.
3. In another person's project, the role decides: Manager can create boards and invite Member/Viewer; Member works on cards; Viewer reads. Nobody gets project creation *inside someone else's workspace*.
4. Unchanged: project-only access, per-board grants (non-Owner needs project membership AND a board grant), Owner-only grant administration, Owner/Manager administration, roles Owner/Manager/Member/Viewer.
5. Owning a workspace elsewhere grants nothing in a shared project (already spec: ACC-06).

### 3.2 When is the personal workspace created

| Option | How | Benefits | Drawbacks |
|---|---|---|---|
| A. Eager at first sign-in (today) | Google callback creates it | Session always has a workspace; UI gate is trivial; already shipped | Unused empty workspace rows; unprotected against double sign-in race; dev-login and old users may have none |
| B. Lazy at first "Create project" | Create-project endpoint creates it | No empty rows | Session can have zero workspaces so every UI gate must change; two code paths; concurrent first creates can race |
| C. **Hybrid (recommended)** | Keep A; add a shared `ensurePersonalWorkspace` helper called from the Google callback, from invitation accept, and from a new workspace-less create-project route; serialize with `pg_advisory_xact_lock` on the user id; back-fill stragglers once | Works for every join path including dev-login; no UI dependency on an owned workspace existing; removes the race without a risky unique index | One small helper plus tests; still creates a row for people who never create a project (negligible) |

Why not a unique index on `owner_id`: ownership transfer can legitimately give a person a second workspace **[V transfer-ownership]**, and an index would make that transfer fail. A guarded helper plus deterministic choice (oldest owned workspace by `created_at, id`, never by name) keeps transfer working. Alternative: add `workspaces.is_personal` with a partial unique index; more precise, but a schema change that touches transfer semantics. Offered as decision 4.

`POST /api/v1/workspaces` (open, unlimited) should be closed or capped at the personal workspace for the beta. Nothing in the web app calls it **[V grep: only `listWorkspaces` and `createProject` in api.ts for workspaces]**; recommend removing the public route or limiting it to "returns your personal workspace".

### 3.3 One create endpoint that does not expose workspaces

Add `POST /api/v1/projects` (additive). Server resolves the actor's personal workspace (ensure if missing), enforces quotas, creates the project, returns the same `Project` shape. Keep `POST /workspaces/:id/projects` for compatibility; it keeps its Owner-only 404 rule. The UI calls the new route, so `workspaces[0]` disappears.

### 3.4 How people see their own and shared projects

| Option | Benefits | Drawbacks |
|---|---|---|
| 1. Two sections on `/projects`: **Yours** (role owner) and **Shared with you** (grouped, role chip) | Matches mental model; no API change needed (role already in `accessibleProjects`); simple | Long lists need search (exists) and later pagination |
| 2. A real sidebar project switcher grouped the same way | Clear context while inside a project; fixes the wrong workspace label | More UI work |
| 3. Keep one flat list with a role chip only | Smallest change | The "stuck" feeling remains |

**Recommend 1 + 2:** `/projects` gets the two sections and an always-visible "New project" button (also in the empty state of both sections: "Create your first project" for Yours; "Projects other people add you to appear here" for Shared). The sidebar header becomes a project switcher grouped Yours / Shared; the label inside a shared project is the project name plus the role chip, never the viewer's own workspace name. Fix the UI role fallback so off-project pages use "owner only for Your section", otherwise no Manage group.

Whether to show who shared a project ("Shared by Priya"): it needs an owner display name in `SessionProjectSummary`. Members already see the people list of that project **[I]**, so it is low risk but it is a contract change; recommended as phase 2 (decision 6).

### 3.5 Does the workspace concept stay visible

No. Keep the table and API names. In the UI remove "workspace" from visible copy (rail header, `/projects` eyebrow "Workspace portfolio", settings copy that says "workspace account"). Say "Your projects" and "Shared with you". Reason: with one hidden workspace per person it carries no meaning for users, and a second visible concept invites questions like "which workspace am I in".

### 3.6 Permissions language

| Today | Target UI wording | Internal |
|---|---|---|
| "Workspace owner" | "Project Owner" (for a project you created) | unchanged: workspace owner |
| "Owner access covers every board" | keep | unchanged |
| "Only workspace owner can archive projects." (API error text) | "Only the project Owner can archive projects." | text only |
| FEATURE_SPEC role table column "Workspace owner" | "Project Owner (owns the project's workspace)" and add a line "Every account owns one personal workspace" | docs only |
| FEATURE_SPEC line ~49 "Invitee's initial screen..." | "Everyone's initial screen: Yours and Shared with you" | docs only |

Consequence to state plainly: ownership is per workspace, not per project. If Shubham owns three projects in his workspace, he cannot hand one to Priya; transfer moves all three. Per-project ownership transfer would need a "move project between workspaces" operation (large, touches every `workspace_id` denormalised column). Out of scope for the beta (decision 7).

---

## 4. Case matrix

Legend: **Now** = verified current behaviour. **Target** = proposed. **Chg** = what must change: API, DB, UI, CON (contracts), TEST, DOC, none. **[V]** verified, **[I]** inferred.

### 4.1 Join paths

| Case | Now | Target | Chg |
|---|---|---|---|
| **A. Own Google sign-in, no invite** | Personal workspace created at first sign-in; `/projects` shows "New project" **[V]** | Same, plus Yours/Shared sections and a first-run "Create your first project" empty state | UI |
| **B. Invited first, then signs in** | Sign-in creates workspace (before accept); accept adds membership in inviter's workspace; lands in the single shared project, no hub **[V]** | Same data, but landing for a user with 1 shared and 0 own projects should go to `/projects` the first time or show a one-line "You can also create your own projects" banner; ensure workspace again at accept | UI, API (ensure helper) |
| **C. Has own projects, later invited to another's** | Membership added; both appear in one flat list; landing goes to `/projects` (2+ projects) **[V landing.ts:12-14]** | Two sections; sidebar switcher; role chip; label inside shared project is the shared project's name, not own workspace | UI |
| **D. Invited to several projects by different people** | Several memberships, possibly in several workspaces; flat list; portfolio fetches boards of all **[V]** | Group Shared by project; (phase 2) by sharer; load boards lazily when the list is long | UI, later API (pagination/lazy) |
| **E1. Invited as Manager** | Can create boards in that project, but cannot see the new board until Owner grants it **[V]**; cannot create projects in that workspace (404) but can in own | Same permissions; decision 1 (auto-grant creator) | API if decision 1 = yes, TEST |
| **E2. Invited as Member** | Cannot create boards (403); can create own project **[V]** | Same; UI hides "New board" (already) and explains "Ask a Manager or Owner" | none / UI copy |
| **E3. Invited as Viewer** | Read-only; can create own project **[V]** | Same | none |
| **F1. Invitation revoked** | Accept returns `INVALID_INVITATION` **[V]** | Same; accept screen offers "Go to your projects" and "Create a project" | UI |
| **F2. Expired** | `INVITATION_EXPIRED`, status flipped **[V]** | Same | UI copy |
| **F3. Re-sent** | Token rotated, old link dead **[V resend 439-444]** | Same | none |
| **F4. Accepted twice** | Second link attempt: `INVALID_INVITATION`; same request replay: stored answer after membership re-check **[V]** | Same | none |
| **G. Removed from a project after joining** | Membership `removed`; board grants deleted by trigger; project drops from list; web shows "removed" page **[V trigger in migration 0007; project-access.ts referenced in project-view.tsx:49]** | Same; own projects unaffected; landing falls back to `/projects` where Yours remains | none; TEST that own projects survive |
| **H. Role changed later** | Takes effect next request; Manager to Member: cannot create boards **[I members.ts PATCH not read in detail]** | Same | none; TEST |
| **I. Signs in with a different Google account than the invited email** | Accept returns 403 `EMAIL_MISMATCH`; the second account still gets its own personal workspace and can create projects **[V]** | Same; screen already offers "switch account" (accept-screen.tsx switchAccount) | none |
| **J. Invited email already belongs to an existing user** | Sign-in reuses the user; membership added to their account; their own workspace unchanged **[V upsert on email]** | Same | none |

### 4.2 Actions by situation

| Action | In own project (Owner) | In someone else's project: Manager | Member | Viewer | Notes |
|---|---|---|---|---|---|
| Create own project | Yes now **[V]**; target: first-class button | Same | Same | Same | Quotas needed |
| Create board | Yes **[V]** | Yes **[V]**, but invisible until granted **[V]** | No (403) **[V]** | No **[V]** | Decision 1 |
| Invite people | Yes, any role **[V spec]** | Member/Viewer only **[V spec]** | No | No | unchanged |
| Create buttons / empty states | Target: always show New project; New board gated by role | Same | Hide New board, explain | Same | UI only |
| Archive / reopen project | Owner only **[V]** | No | No | No | unchanged |
| Delete project | No route (nobody can) **[V]** | No | No | No | later scope |
| Leave a project | Owner cannot leave **[V]** | API yes, **no UI** **[V]** | same | same | Add UI (task U5) |
| Transfer ownership | API moves whole workspace; no UI **[V]** | No | No | No | Decision 7 |
| Delete account | No route **[V]** | | | | later scope; see 5.5 |
| Trash | Owner/Manager **[V trash page filter]** | Manager yes | No | No | unchanged |

### 4.3 Cross-cutting by case

| Surface | Now | Target | Chg |
|---|---|---|---|
| Notifications and activity scope | Notifications are per user and respect board grants **[V notifications.ts:73-87]**; project activity per project; Owner workspace feed `GET /workspaces/:id/activity` is Owner-only for that workspace **[V activity.ts:76-94]** | Unchanged. An invitee's own workspace feed contains only their own projects. | TEST that a member's feed excludes the inviter's workspace |
| My tasks / mentions across projects | Calls `listMyTasks` once per open accessible project **[V rail.tsx:70-73]** | Same data; add quota awareness (N own projects + M shared = N+M calls) | UI later: one aggregate endpoint |
| Search | Board-scoped only (search button appears only on a board) **[V rail.tsx boardHref]** | Unchanged; no cross-project search | none |
| Sidebar / switcher | Wrong label inside a shared project; Manage group wrongly shown off-project **[V]** | Grouped switcher, label from the project | UI |
| Archive | Own projects: Owner; shared: not allowed | unchanged | none |

---

## 5. Security, abuse and tenancy risks

### 5.1 Authorization impact

- No authorization rule is loosened. Project creation already requires `owner_id = actor.id` **[V]**; the new workspace-less route resolves the workspace server-side and ignores any client-supplied workspace. Everything in someone else's project still goes through `resolveProjectRole` / `acquireWriteGrantLock` **[V]**.
- The route list changes by one (`POST /api/v1/projects`), possibly minus `POST /api/v1/workspaces`. If the generated authorization matrix (SECURITY_ROADMAP S2) exists or lands, the new route must appear with these rows: stranger (401), any signed-in user (201 in own workspace), body with a foreign `workspaceId` (rejected or ignored), replay with same key (same answer), over quota (429/409).
- `rbac01-matrix.test.ts` and `prj01-projects.test.ts` need new cases (7.4).

### 5.2 Leakage

| Risk | Status |
|---|---|
| Invitation link reveals project name before accept | Not today **[V accept-screen.tsx]**. Keep. |
| Wrong email accept reveals project | Generic 403 `EMAIL_MISMATCH` **[V]**. Keep. |
| `GET /api/v1/workspaces` returns the sharer's workspace name (e.g. "Priya's Workspace") to every member | **[V]** workspaces.ts:140-147. Unused by web. Restrict to owned workspaces or remove. |
| Workspace name derives from display name, so it exposes the owner's name | Hidden once workspace is not shown in UI **[I]** |
| Switcher listing | Built from `accessibleProjects` only; never from workspace listing. Test required. |
| Notifications / activity | Already scoped by user and board grants **[V]** |
| Sidebar shows viewer's own workspace name inside another's project | Cosmetic wrong label, no cross-user data **[V]**; fix in UI |
| Off-project UI shows Manage group for Viewer | UI-only, server enforces **[V code read]**; fix |

### 5.3 Spam and abuse (nothing limits creation today **[V]**)

Existing building block: `consumeWindow` in the same transaction, fail closed, as used for invitations **[V rate-limit-postgres.ts:76-105]**. Per-IP buckets exist only for auth, invite, import, upload **[V rate-limit.ts:56-76]**; docs mention a soft Cloudflare binding of 60 writes/min that did not enforce on UAT **[V RATE_LIMITING.md]**.

Recommended beta numbers (conservative; raise on evidence):

| Limit | Value | Mechanism |
|---|---|---|
| Owned workspaces per user | 1 (close public create) | route removal / helper |
| Owned projects per user (active + archived) | 25 | count under `FOR UPDATE` on the workspace row, 409 `QUOTA_EXCEEDED` |
| Boards per project | 25 | count under project row lock, 409 |
| Boards per user across own projects | 100 | same |
| Project creations | 5 per minute and 30 per hour, per user | new `project-create`, `project-create-hour` window buckets |
| Board creations | 10 per minute and 60 per hour, per user | `board-create`, `board-create-hour` |
| Pending invitations per project | 50 | count in the invite transaction (existing rate limits stay: 20/min, 200/h per inviter) |
| Active members per project | 50 | count in accept and invite |
| Projects a person may belong to as non-Owner | 50 | count in accept |
| Total projects returned in session | paginate beyond 100 | `getAccessibleProjects` has no limit today **[V rbac.ts:117-170]** |

The existing create route takes `FOR SHARE` on the workspace row **[V]**; a count-and-insert quota needs `FOR UPDATE` (or an advisory lock) or two parallel creates can both pass. Idempotency replay must be answered **before** quota checks so a lost-response retry never 409s.

### 5.4 Tenancy assumptions

| Assumption | Where | Risk | Fix |
|---|---|---|---|
| "The first owned workspace is the right one" | projects/page.tsx:75; active-project.ts:23 (`ownedWorkspaces[0]`) | After transfer a user owns two; create goes to the alphabetically first | New workspace-less route; UI stops using index 0 |
| "Owning any workspace means Owner everywhere off-project" | active-project.ts:32-34 | Every user sees Owner-level nav | Use per-project role only |
| Sorting owned workspaces by name | rbac.ts:103 | Non-deterministic "primary" | `ORDER BY created_at, id` for the primary |
| Server queries | They filter by `project_id` plus `workspace_id` ancestry (`verifyProjectAncestry`, composite FKs) **[V rbac.ts:202-285; migration 0003]** | A user who owns W1 and is a member in W2 is handled because roles are derived per project, not per user-workspace. I found no server path that assumes one workspace per user. Searched `LIMIT 1` / `workspaces[0]` in apps/api/src: only the sign-in check, which needs "at least one". | TEST with a two-workspace user |
| Idempotency receipts scoped `workspace`/`actor`/`project` | projects.ts, workspaces.ts | Fine for a workspace-less route if scope is `actor` | use `actor` scope |

### 5.5 Orphans and removal

- Removing a member clears board grants atomically (trigger) **[V migration 0007]**; the user's own projects are untouched (separate workspace) **[I]**.
- Owner cannot leave; no delete exists, all FKs are RESTRICT **[V]**. So an Owner who abandons a project leaves members with a live project and no admin. Mitigation for the beta: document, and keep transfer-ownership (API exists) as the exit.
- Account deletion does not exist. When it is built it must first transfer or archive owned workspaces and handle `activity_log.actor_id`, comments, notifications (all RESTRICT) **[V migrations]**. Out of scope but a blocker for "delete account" in the matrix.
- A user who transferred away their only workspace has zero workspaces until the next sign-in; the new ensure helper on create-project closes this.

---

## 6. Migration and compatibility

**Data (UAT and production).** I did not and may not query any database. From the brief: production has 0 users; UAT has a few invitees, some possibly without a workspace. **[I]**. Users with no workspace can exist only via dev-login, transferred-away ownership, or any pre-workspace-code sign-in **[I]**; a Google invitee who signed in after the workspace code shipped has one **[V code]**. Deployment should run a read-only count first: `users` left-anti-joined to `workspaces` on `owner_id`.

**Schema.** No required schema change for the recommended model. Optional: a nullable `workspaces.kind` or `is_personal` flag (decision 4) and a quota-friendly index on `projects(workspace_id)` which already exists **[V idx_projects_workspace]**.

**Backfill (idempotent, additive).** One migration `0018_personal_workspace_backfill.sql`: for each user with no owned workspace insert `ws_<id>` named `<display_name>'s Workspace`, UTC, version 1. Guard with `NOT EXISTS (SELECT 1 FROM workspaces WHERE owner_id = u.id)`; a second run changes nothing. Generate ids deterministically from the user id (`'ws_' || md5(u.id)`) with `ON CONFLICT (id) DO NOTHING` so re-runs and concurrent app sign-ins cannot duplicate. Keep it out of the embedded migration runner path until the ensure helper ships, or ship both together.

**Compatibility.** Old route stays. New contract fields (if any, such as `ownerDisplayName` or `isShared`) are optional additions to `sessionProjectSummarySchema`. Older cached web bundles keep working because `ownedWorkspaces` is unchanged.

**Rollback.** Code: redeploy the previous Worker and Pages; the new route disappears; data created through it is ordinary projects in ordinary workspaces. Backfilled workspaces are empty and harmless; they can stay. No destructive step exists. Per BACKEND_REVIEW_GATE.md the backend part needs an independent review before closure.

**Existing invited users.** They keep every membership. They gain a visible Yours section and Create button. Nothing to re-invite.

---

## 7. Implementation plan and tests

Order: B1 and A1 first, then B2/B3, then U1-U5, D1 last. Sizes: S under half a day, M about a day, L multi-day.

### 7.1 Tasks by owner

| # | Owner | Task | Files likely touched | Size | Depends on |
|---|---|---|---|---|---|
| A1 | Architect | Decide open decisions 1, 4, 5, 7; update FEATURE_SPEC role table and line ~49, FEATURE_CHECKLIST (ACC-04, ACC-06, PRJ-01/02), board-access decisions note if decision 1 = yes; define contract change (`POST /api/v1/projects`, optional summary fields) | docs/FEATURE_SPEC.md, docs/FEATURE_CHECKLIST.md, docs/features.tsv, packages/contracts/src/projects.ts, auth.ts | S | none |
| B1 | Backend | `ensurePersonalWorkspace(client, user)` helper with advisory lock; use in Google callback; call in invitation accept; deterministic primary workspace lookup | apps/api/src/adapters/workspaces-personal.ts (new), http/routes/google-auth.ts, adapters/invitations.ts, adapters/rbac.ts (ordering) | M | A1 |
| B2 | Backend | `POST /api/v1/projects` (workspace-less, `actor` idempotency scope), keeps old route; quotas and rate buckets for project/board creation; `QUOTA_EXCEEDED` error code | http/routes/projects.ts, http/routes/boards.ts, adapters/boards.ts, services/rate-limit.ts, adapters/rate-limit-postgres.ts, packages/contracts (error code, input) | L | B1 |
| B3 | Backend | Close or restrict `POST /api/v1/workspaces`; restrict `GET /api/v1/workspaces` to owned | http/routes/workspaces.ts | S | B1 |
| B4 | Backend | If decision 1 = yes: creator Manager gets a `board_grants` row for their new board (only for that board; grant administration stays Owner-only) | adapters/boards.ts, adapters/board-grants-foundation.ts | M | A1 |
| B5 | Backend | Migration 0018 backfill (idempotent); migration test | database/migrations/0018_*.sql, embedded-migrations.ts, test/b14-migration style test | S | B1 |
| B6 | Backend | Member, invitation count caps (50/50/50) | adapters/invitations.ts | S | B2 |
| U1 | UI | Projects page: Yours and Shared with you sections, role chip, always-visible New project, new empty states, switch to `api.createProject()` without workspace id | app/projects/page.tsx, lib/api.ts, lib/portfolio.ts | M | B2 (or old route first) |
| U2 | UI | Sidebar: project switcher grouped Yours/Shared, correct label, drop `ownedWorkspaces[0]`, fix off-project role fallback and Manage group, remove "workspace" copy | components/shell/rail.tsx, lib/active-project.ts, app/settings/page.tsx | M | U1 |
| U3 | UI | Landing: first-run for B-case (shared only, no own project) | lib/landing.ts, functions/_middleware.ts (mirror) | S | U1 |
| U4 | UI | Quota and error messages for `QUOTA_EXCEEDED` / 429 | lib/errors.ts, error-codes.ts | S | B2 |
| U5 | UI | Leave project action (confirm dialog, API already exists) | app/settings/page.tsx or project page, lib/api.ts | M | none |
| D1 | Deployment | Read-only count of users without a workspace on UAT; apply 0018 to UAT; deploy Worker then Pages; verify with one invitee account; production only after UAT sign-off | docs/UAT_DEPLOY.md | S | B5, U2 |

### 7.2 Dependencies and order

A1 -> B1 -> (B2, B3, B4, B5) -> B6; B2 -> U1 -> U2, U3, U4; D1 last. U5 independent.

### 7.3 Acceptance criteria

1. A user created by any path (Google first, Google after invite, invite accept, dev-login in tests) has exactly one personal workspace after their first project create; double concurrent sign-in yields one.
2. An invitee as Member or Viewer can create a project and a board in their own workspace and is Owner there; they still cannot create a board or project in the inviter's project/workspace.
3. `/projects` shows Yours and Shared with you, the Create button is visible with zero shared projects, zero own projects, or both; sidebar label never shows an unrelated workspace.
4. Quotas return 409 `QUOTA_EXCEEDED` or 429 with `retryAfterSeconds`, never partial data; idempotent replays are not blocked by quotas.
5. No existing authorization test changes outcome.
6. Docs updated; independent backend review recorded per BACKEND_REVIEW_GATE.md.

### 7.4 Test plan

Positive:
- Invitee (each of Manager, Member, Viewer) creates own project via new route; response role is owner; appears under Yours.
- Idempotent replay of project create returns the same project.
- Ensure helper under concurrency (two parallel callbacks) creates one workspace.
- Backfill run twice: second run inserts 0 rows.

Negative / isolation:
- Member and Viewer get 403 on `POST /projects/:id/boards` in the shared project; Manager gets 201.
- Member/Viewer cannot see boards without a grant in the shared project.
- Body-supplied foreign `workspaceId` is ignored or rejected; project always lands in the caller's own workspace.
- `POST /workspaces/<inviter workspace>/projects` by an invitee still 404.
- Two-workspace user (after transfer): create goes to the deterministic primary; roles in shared projects unaffected; session lists both correctly.
- Cross-project isolation: user A's own project and A's shared membership never leak B's other projects, names, member lists, notifications or activity.
- Accept with wrong email 403; revoked/expired/used 400; owner accept `ALREADY_MEMBER`.
- Removed member keeps own projects, loses shared project and grants.
- Quota: 26th project, 26th board, 6th project in a minute, 51st pending invite; replay at the cap still returns the original response.
- Web: component tests for empty states (zero own/zero shared, own only, shared only, both), switcher grouping, no Manage group for Viewer off-project.

---

## 8. Open decisions (recommended default first)

| # | Decision | Recommendation |
|---|---|---|
| 1 | Should a Manager who creates a board automatically get access to it? Today they cannot open their own new board until the Owner grants it. | **Yes, creator gets a grant for that board only.** Owner-only grant administration for everyone else stays. Needs the 27 Oct decision note updated. |
| 2 | Hub vs landing for a person with shared projects only | Show `/projects` the first time with Create visible, then remember last location |
| 3 | Beta quotas (25 projects, 25 boards per project, 5/min and 30/h project creates, 50 members) | Accept section 5.3 numbers |
| 4 | How to keep "one personal workspace": helper plus advisory lock only, or a `kind` flag with partial unique index | Helper plus lock for the beta; revisit the flag if transfer is used |
| 5 | Close `POST /api/v1/workspaces` | Close it (web does not use it) |
| 6 | Show "Shared by <owner name>" on shared projects | Phase 2; needs contract field |
| 7 | Per-project ownership transfer and "move project" | Not in beta; transfer stays whole-workspace and UI-less |
| 8 | Add Leave project UI now | Yes (API ready, small) |

---

## 9. What I could not verify

- Nothing was run: no tests, no browser, no database. UI behaviour (landing, rail label, Manage group) comes from reading code only.
- Actual UAT user rows (who has a workspace) cannot be known without a database read; deployment must check.
- `members.ts` PATCH/DELETE role-change and removal details were not read line by line (H and G rows rely on the trigger and spec); revoke-invitation internals only skimmed.
- Whether a generated route-authorization matrix test exists outside `apps/api/test` is unknown; I found only the hand-written matrix.
- Whether Cloudflare/Pages middleware (`functions/_middleware.ts`) mirrors `landingFor` exactly was not read; the comment in landing.ts says it does.
- `GET /api/v1/projects` pagination limits (50 default, 100 max) apply to a separate list; whether the web uses it versus `session.accessibleProjects` (unbounded) for the portfolio was not traced beyond portfolio.ts.
- No performance measurement of the per-project My tasks and portfolio fan-out at 25+ projects.
