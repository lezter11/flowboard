# Round 4 audit summary

**Target:** `99ae250d1c1f6fddf7747bd5676a7234abf72a11` on a clean detached worktree. **Findings:** 0 critical, 1 high, 1 medium, 1 low.

## Top risks

1. **Ownership transfer is still live.** A valid Owner can transfer an entire workspace to any existing account. This contradicts the Round 4 requirement that the endpoint be disabled and bypasses the new owner's project quota. The local account-lifecycle integration test expects and confirms HTTP 200. Disable the route before further release work.
2. **Production dependency advisories remain.** The current lockfile has a high PostCSS advisory and a moderate Next advisory in the production dependency tree. The all-dependency audit also reports high Undici advisories. Review and update before public launch.
3. **Secret scan is inconclusive.** Gitleaks reported 249 redacted generic-key detections in both the frozen tree and available Git history. This audit did not inspect or reveal the detected values and cannot certify that the repository/history is clean.
4. **The shared-project header can show the wrong workspace.** The UI falls back to the user's first owned workspace when the active project's workspace is shared. This is a context-label error, not an API access bypass.
5. **Full API and deployment acceptance remain unverified.** Focused API tests passed, but the full API suite was interrupted. Signed-in UAT flows were not run; the deploy log's latest Pages commit is older than this audit target.

## What blocks production

- Disable `POST /api/v1/workspaces/:workspaceId/transfer-ownership` or implement a reviewed, consent-based flow with serialized quota enforcement.
- Triage the redacted secret-scan detections without publishing values, remediate confirmed credentials if any, and update vulnerable dependencies.
- Finish the full API suite and the owner checklist for signed-in behavior. Confirm UAT build provenance against an exact commit before treating UI behavior as deployed evidence.

## What can wait

- The shared-workspace breadcrumb correction is a low-severity UI fix.
- The no-grant/role matrix can be expanded into valid per-route request bodies after the ownership-transfer blocker is resolved.
- Query-plan, accessibility, and import/image adversarial checks remain open but did not produce a confirmed defect in this pass.

## Evidence boundary

This review used a detached worktree and a disposable PostgreSQL 17.11 database on localhost port 55801. The base handover and `RULES.md` were read after probing rather than before, as their read order asks; this process limitation is recorded in `coverage.md`. It made four successful anonymous UAT requests plus three failed requests to an incorrectly guessed hostname. No signed-in UAT, production service, production database, or Cloudflare secret was accessed. Test and coverage details are in `coverage.md`; exact reproductions are in `findings.md`.
