# Own projects and roles: accepted decisions (2026-10-31)

Status: **accepted by the user in chat on 2026-10-31.** Source research: [own-projects-and-roles-cases-2026-10-31.md](own-projects-and-roles-cases-2026-10-31.md) (read-only, from code reading; not run). Edge-case review: [own-projects-edge-cases-2026-10-31.md](own-projects-edge-cases-2026-10-31.md) (pending; where it is stricter or clearer on limit rules, it wins, and the Architect confirms any conflict with the user).

## The rule in one line

Everyone can create their own projects and boards, however they joined. Inside someone else's project, what they may do depends on their role there: Manager can create boards; Member and Viewer cannot.

## Decisions

1. **Creator access.** A Manager who creates a board automatically gets a grant for that board only. Grant administration for everyone else stays Owner-only. (Amends [board-access-decisions-2026-10-27.md](board-access-decisions-2026-10-27.md).)
2. **Landing.** A person with shared projects only sees `/projects` the first time, with Create project visible, then the last location is remembered.
3. **Limits (replace the research report's 25/25), set by the user:**
   - at most **3 owned projects per user**, irrespective of how they joined or their role elsewhere;
   - at most **5 non-archived boards per project**, irrespective of role (a Manager's board in someone else's project uses that project's 5);
   - kept: 50 members per project, 50 pending invitations per project, 5 project creates per minute and 30 per hour per user.
   - Projects a user is only a member of never count toward their 3, so an invitation can never be blocked by it. Archived and trashed projects and boards do not count. Reopening or restoring while at the cap is refused. Existing over-limit data is grandfathered: new creates are blocked, nothing is deleted. Limits are constants with environment overrides, not a hardcoded allowlist.
4. **One personal workspace per person** by helper plus advisory lock for the beta; a `kind` flag with a partial unique index is revisited if ownership transfer is used.
5. **`POST /api/v1/workspaces` is closed**; `GET /api/v1/workspaces` is restricted to owned workspaces.
6. "Shared by <owner name>" on shared projects: phase 2.
7. Per-project ownership transfer and "move project": not in the beta. Transfer stays whole-workspace and without UI.
8. **Leave project** UI: yes, now (the API exists).

## Visible model

Projects page with **Yours** and **Shared with you** sections, a project switcher with a role chip, an always-visible Create project button, and no visible word "workspace".

## Owners and order

Backend: B-17 contract and helper, B-18 limits and `POST /api/v1/projects`, B-19 creator grant, B-20 workspace routes, B-21 backfill migration 0019 (0018 is the first and last name feature), B-22 member and invitation caps. UI: U1 to U5 after the B-17 contract. Deployment: read-only count of users without a workspace on UAT, then migrations and deploy, UAT first. Backend closure still needs [BACKEND_REVIEW_GATE.md](../../../BACKEND_REVIEW_GATE.md).
