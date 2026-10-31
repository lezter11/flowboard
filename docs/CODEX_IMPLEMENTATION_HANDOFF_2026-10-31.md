# Codex implementation handoff: own projects and roles, backend completion (2026-10-31)

Audience: Codex acting as the **implementer** of the unfinished backend work. This is not an audit. A different, fresh Codex session audits afterwards with `docs/CODEX_AUDIT_BRIEF_ROUND4.md`; the implementer must not audit its own work (`BACKEND_REVIEW_GATE.md`).

## Read first, in this order

1. `AGENTS.md` and `RULES.md` (repo rules, teaching format not required for you; keep commit messages plain).
2. `docs/handoffs/proposals/own-projects-backend-handover-2026-10-31.md` (what is committed, what is uncommitted and untested, what is not started, section 6 = Architect answers).
3. `docs/handoffs/proposals/own-projects-decisions-2026-10-31.md` (accepted decisions and the limits).
4. `docs/handoffs/proposals/own-projects-edge-cases-2026-10-31.md` (section 2 is the binding limit rules; section 3 lists 31 findings, which are hypotheses from code reading and not run; confirm each in code before acting).
5. `docs/handoffs/proposals/own-projects-and-roles-cases-2026-10-31.md` (sections 3, 7, 8).

## The goal in plain words

Everyone can create their own projects and boards however they joined; in someone else's project, role decides: Manager can create boards, Member and Viewer cannot. Hard limits (all approved by the user): 3 active owned projects per user; 5 active boards per project whoever made them; backstop 20 owned projects and 25 boards per project including archived; 50 active members (Owner excluded); 50 pending invitations; 5 project creates per minute and 30 per hour per user. Memberships never count toward a user's 3. Over-limit existing data is grandfathered (block new creates and reopens, never delete). A Manager who creates a board gets a grant for that board only.

## Current state (verify with `git status` and `git log`)

Committed: B-15 `685df94`, B-16 `9cc49a9`, B-17 contract `a66976f`, B-17 helper `e6fb32b`; UI name step `7c36c03` (not yours, do not revert). **Uncommitted, untested B-18 edits are in the working tree (listed in the handover section 2).** The working tree also holds **uncommitted UI work in `apps/web/`** (projects page, quota messages, new-project dialog and others) that belongs to the UI chat: do not edit, stage, stash, reset or commit anything under `apps/web/` or `design/`. Stage files by explicit path only; never `git add -A` or `git add .`; never `git stash`, `git reset --hard`, `git checkout -- <path>` on files you did not write.

## Your work, in this order (one commit per task, run tests before each commit)

1. Review the uncommitted B-18 edits against the handover's "known gaps"; finish and test them; commit as B-18.
2. Backstop totals, `GET /api/v1/session` returning `limits` and per-project `isOwned` (contract exists, route does not fill it yet), docs for the `FB_LIMIT_*` variables (`docs/API.md`, `wrangler` comments).
3. B-19 board-access-decisions amendment line; creator grant tests (only that board; audit row; Owner-only grant administration unchanged).
4. B-20: close `POST /api/v1/workspaces` (410, typed code), restrict `GET /api/v1/workspaces` to owned, disable `POST /api/v1/workspaces/:id/transfer-ownership` (410). Replace the 7 test files and 3 audit scripts that used the closed POST as fixture setup with a fixture helper.
5. B-21: migration `0019` (personal workspace backfill, idempotent, fixed workspace name; `idx_workspaces_owner`; nullable `boards.created_by`) with a migration test proving a second run inserts 0 rows. **Do not apply it to any database.**
6. B-22: member and pending-invitation caps, resend rate limits and expired-invitation refusal, lock order project quota lock then invitation row (F-04), accept into an archived project refused, invite create refused while the inviter has `needsName`, project and board names refuse the B-16 character set (F-17), email strips `\p{Cf}`.
7. Close every blocker and high finding in the edge-case report, or write a one-line dated deferral with a reason in the handover section 4. Never skip silently.

## Required tests (negative ones matter most)

Member and Viewer get 403 creating a board in a shared project, Manager gets 201; an invitee in each role creates their own project via `POST /api/v1/projects` and is Owner there (including an invitee with no personal workspace); the 4th owned project and the 6th board return `QUOTA_EXCEEDED` with the right scope; archive then create works; the backstops refuse after archive cycling; concurrent creates at the cap never exceed the limit (forced interleavings, not random timing; no deadlock with the existing board-row then card-row lock order); idempotent replay at the cap returns the original response; reopen and restore at the cap are refused; double Google callback gives exactly one workspace; body-supplied `workspaceId` is 422; `QUOTA_EXCEEDED.details.current` appears only when the caller may see it; the route-authorization probe inputs cover every new or changed route.

## Rules

- Local Postgres only, on a free port that is not 55432, 55479 or 55492 (those are in use); record port, image and exit code. Run the access suite on (`flowboard_access_test`); state clearly in each commit message and report whether it ran. Typecheck, lint, API and contracts tests before each commit. Report real counts only.
- Never print, paste or commit a secret or connection string. No `git push`, no deploy, no production, no Neon, no Cloudflare calls. The owner or the Deployment chat pushes and deploys.
- Do not change contracts in ways the UI already depends on without telling the owner: the UI builds against `a66976f` shapes (`POST /projects` strict body, `QUOTA_EXCEEDED` envelope under `error.details`, `RATE_LIMITED`, session `limits` and `isOwned`).
- Write a final handover section in the same handover file: commits, finding IDs closed, deferred findings with reasons, exact test counts, migrations to apply (0018, 0019), and what an auditor should attack first. Leave `git status` clean of your own files.

## What happens after you

1. The owner freezes the SHA, applies migrations 0018 and 0019 and deploys to UAT (Deployment chat or the owner).
2. A fresh Codex session runs `docs/CODEX_AUDIT_BRIEF_ROUND4.md` against the frozen SHA and UAT; the owner runs its `needs-owner.md` checklist with two Google accounts.
3. The Architect triages findings, then one production deploy.
