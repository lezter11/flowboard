# Production backup and rollback strategy (2026-10-31)

Status: **adopted by the Architect on the user's instruction; the first backup under it was taken for D-24.** Scope: production only. UAT may skip all of it. Facts checked on 2026-10-31 (read-only): Neon project `flowboard-prod`, Postgres 18, **history retention 6 hours**, **10 of 10 branches used** (the plan's branch limit, from the Neon plan rules, not re-verified against Neon's current docs), R2 images bucket `flowboard-images-prod` (private, empty at the time).

## The promise and the one real risk

Promise: a rollback of the **software** never touches the **data**. Boards, cards, comments, images and members stay as the users left them.

Why that holds: the code (Cloudflare Worker and Pages) and the data (Neon PostgreSQL and R2) live in different places. Rolling the Worker back to an older version only changes which code answers requests; the database is not part of that step.

The one real risk is the **database structure** (a migration that renames, drops or reshapes something). If a migration breaks the old code, rolling the code back is not enough. So the rule below keeps every migration safe for the previous version.

## The rules (in order of importance)

1. **Expand, then contract.** A release may only *add* things (tables, columns that are nullable or have defaults, indexes). Anything destructive (drop, rename, type change, NOT NULL on existing data) waits until at least **two releases after** the code stopped using it, and ships alone with its own backup and review. Every migration must be idempotent (a second run changes nothing) and must work with the previous release's code. A migration that fails that test does not ship.
2. **Code first rollback.** If something is wrong after a deploy, roll the code back first. It takes about a minute and loses nothing:
   - Worker: `npx wrangler rollback <previous-version-id>` from `apps/api` (top level is production), or redeploy the recorded version.
   - Pages: promote the recorded previous deployment in the Cloudflare dashboard (Pages, `flowboard-app`, Deployments, previous one, Rollback).
   - The deploy record always lists both ids (see `docs/UAT_DEPLOY.md`).
3. **Never restore the database over production to undo a bad release.** A full restore throws away everything users did after the backup. Use it only for real data loss or corruption, and then prefer the surgical restore below.
4. **Forward fix beats restore.** If data is wrong but the structure is fine, correct the rows with a reviewed SQL script, not a restore.

## Backups, from fastest to most durable

| Layer | What it is | Protects against | Limit today |
|---|---|---|---|
| A. Pre-deploy branch | A Neon copy-on-write branch of `production`, created right before every production deploy: `production-backup-<date>-<deploy id>-pre`. Instant, shows production exactly as it was. | A bad migration or a bad write during the deploy window. | **10-branch limit is full**; each new backup needs an old UAT backup deleted first (see Housekeeping). |
| B. Point-in-time restore | Neon keeps the change history, so you can branch from any moment inside the window. | Mistakes noticed within hours (a bulk delete, a bad script). | **Only 6 hours** on this plan. A paid plan has a longer window; check the current plan and price in the Neon console before choosing. |
| C. Off-platform dump (recommended next) | A nightly `pg_dump` of production, encrypted, stored outside Neon (for example in a separate private R2 bucket `flowboard-backups-prod`, 30 days kept). | Neon account problems, an accidental project deletion, anything older than the history window. | Not built. Needs the **read-only database role** (the role split) so the dump job cannot write, and a scheduler (a GitHub Actions workflow is the simplest). |
| D. Image files | Images live in the private R2 bucket. The app already uses a 24-hour trash and a deferred storage-deletion queue, so a deleted card's images are not removed instantly. | Accidental card or image deletes (inside 24 hours). | R2 has no built-in versioning on this setup. A second bucket copy is optional, later. |

## Every production deploy, the checklist

1. **Before:** the release is merged and the tests are green; no destructive migration; the previous Worker and Pages ids are recorded; production Hyperdrive caching is confirmed **off**; the Architect takes the branch backup A (name above) and records its id.
2. **Migrations** (if any) run first and are additive; read the row counts before and after.
3. **Deploy** the Worker, then Pages, from a clean checkout of the exact commit (never the shared working folder).
4. **Smoke test** unauthenticated: health, security headers, 401 behaviour, a scheduled run ending `ok`.
5. **Monitor for 15 minutes:** live logs (errors, exceptions, slow calls), database sessions and lock waits, the first real user actions.
6. **Decide:** healthy, so keep it; unhealthy (health not 200, errors above normal, or users blocked), so roll the code back (rule 2) at once, then investigate. Data is untouched either way.
7. **Record:** the deploy log gets the ids, the backup branch, the result, and what was not verified.

## If data is lost or corrupted (rare), the surgical restore

Goal: get the affected rows back **without** losing what users did since.
1. Stop the damage (roll back the code or pause the job that caused it).
2. Create a **new branch** from the backup or from a point in time before the damage. Do not touch production yet.
3. Compare: identify exactly which rows are missing or wrong (for example the boards, cards or comments of one project).
4. Copy only those rows from the restored branch back into production in one reviewed transaction, with row counts checked before and after.
5. Only if the whole database is unusable: a full restore, with a written decision from the Owner, because everything after the backup point is lost and users must be told.

## Housekeeping and ownership

- **Retention:** keep the last 3 production backup branches and the one from the last major release; delete older ones. UAT backups are disposable; keep at most 2.
- **Branch limit:** with the limit full, delete the oldest UAT backups to make room. **Deleting a branch is irreversible, so the owner or a person with explicit permission does it.** An automated session may be blocked from doing it.
- **Restore drill:** once a month, restore the latest backup to a new branch, time it, check row counts against production, and delete the test branch. A backup never restored is not yet a backup (this is item S14 of `docs/SECURITY_ROADMAP.md`).
- **Passwords:** never print or store a connection string; creating a branch prints one, so filter the output (this once leaked; the password was rotated).
- **Hyperdrive caching** on production must stay **disabled** (it caused stale reads: a new project showing "no access", a name save that hung, repeated card conflicts).

## Decisions for the owner

1. **Neon plan:** move production to a plan with a longer history window and more branches before real customers arrive (recommended). Until then, backup A is the only safety net beyond 6 hours.
2. **Off-platform nightly dump (layer C):** recommended; needs the read-only role and a scheduler.
3. **Who may delete old backup branches:** the owner, or grant an automated session explicit permission per run.
