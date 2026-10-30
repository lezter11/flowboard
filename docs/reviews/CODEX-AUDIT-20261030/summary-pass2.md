# Pass 2 audit summary

**Target:** `chore/baseline-2026-10-28` at `36dfb3a4172ca5cc910c6c6503b4efd641031e35`.

## Result

**Current findings: 0 critical, 0 high, 3 medium, 0 low.** Six of the eight findings from the first pass are fixed. FB-AUD-04 (dependency advisories) and FB-AUD-06 (broad database role recorded as open) remain. New FB-AUD-09 confirms that delivered invitation outbox rows retain the recipient email and template fields after the token is removed.

The complete target test suite passed on disposable PostgreSQL 17.11: **744/744 tests passed, 0 skipped**. The 930-cell authorization matrix ran against the mounted target routes and disposable database. It found no cross-project data in the tested fixture. Of the 584 cells whose status was not 401/403/404, 467 returned no substantive data; 117 carried data such as expected health responses, templates, and authorized project/board reads. Many write cells used intentionally invalid empty payloads and therefore stopped at 400/422 before exercising write authorization. See the full per-cell record in `route-authorization-matrix-pass2-execution.json`.

The UAT probe used only anonymous GETs and stayed below the 60-request limit. Pages entry redirects were no-store and carried the sampled HTML security headers. API errors were no-store and returned 401/404 for the guessed resources. The deployed UAT build could not be tied to this commit, and no signed-in UAT/browser check was performed.

## Five risks to address

1. **Production dependency advisories remain.** The locked production tree has one moderate and one high advisory; the full dependency tree has five total. Fix and retest before production.
2. **Invitation delivery retains personal/template data.** After a successful send, the outbox keeps recipient email, project name, inviter name, role, and expiry. Scrub settled payloads to a minimal receipt before production.
3. **The runtime database role is still an open question.** The repository roadmap says one broad role and no RLS. Verify the actual Worker role and reduce its privileges before production.
4. **Hosted storage and authorization are not fully proven.** Local fake R2 tests pass, but no signed-in UAT image upload/read/delete or real-bucket access-policy check was allowed in this pass.
5. **The route matrix is broad but not a write-permission proof.** It covers every mounted route and identity, yet invalid write bodies often fail validation first. Follow with valid negative write requests for every protected route using synthetic accounts, then bind the evidence to the release commit.

## Production decision

**Do not treat this pass as production approval.** Resolve FB-AUD-04 and FB-AUD-09, verify and restrict the UAT/Worker database role, and run signed-in integration checks for the deployed Pages proxy and real private R2 bucket. None of these findings was changed or deployed during the audit.

## What can wait

Database sharding, read replicas, partitioning, and a broad load/`EXPLAIN ANALYZE` study can wait until representative production-like volume exists. Accessibility and visual review of the new UI should happen before UI release, but they are outside this backend/security pass.

**Detailed evidence:** [findings-pass2.md](/Users/shubham/Documents/Flowboard/docs/reviews/CODEX-AUDIT-20261030/findings-pass2.md) · [coverage-pass2.md](/Users/shubham/Documents/Flowboard/docs/reviews/CODEX-AUDIT-20261030/coverage-pass2.md) · [manifest-pass2.json](/Users/shubham/Documents/Flowboard/docs/reviews/CODEX-AUDIT-20261030/manifest-pass2.json)
