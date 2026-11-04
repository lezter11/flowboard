# Independent hosted MCP UI / Pages review outline

Reviewer: `/root/hosted_mcp_ui_review`, a fresh read-only reviewer that did not implement this feature. Prepared 2026-11-04 before final source hold. No verdict, score or acceptance claim is made here.

## Scope and boundaries

Product source is read-only. Only this review directory is reviewer-owned. Existing UAT `d1c81f4`, cloud resources, credentials and real user accounts are excluded. Backend API-only round 2 approval does not approve later safe-next, Google, UI or Pages changes. Preserve every failed run and final before/after target hashes.

Criteria: `RULES.md`, `BACKEND_REVIEW_GATE.md`, `docs/HOSTED_MCP_SPEC.md`, `docs/HOSTED_MCP_PLAN.md`, and `docs/reviews/HOSTED-MCP-20261104/ui/ACCEPTANCE_PLAN.md`. Required behavior remains fixed before review; no scoring moving source or weakening criteria to pass.

## Independent trace and adversarial cases

1. Consent entry: exactly one 43-character opaque request handle, signed-out privacy, safe Google/error/name continuation and no offsite next path.
2. Consent identity: unverified client name treated as inert text; client/callback origins visible; exact action and lifetime claims; explicit blank project selection and no automatic broad grant.
3. Decisions: selected project only, latest page's CSRF, deduplicated pagination retaining selection, deny without project, single submit and safe unknown outcome on interrupted POST.
4. Identity changes: account/session swap clears prior client/project content and prevents stale decision; revoked/expired/consumed browser-bound requests fail closed.
5. Personal Connections: all roles and no-project accounts can reach it; safe fields and truthful null usage; own disconnect confirmation, Escape, focus restoration, 204 handling and safe failure.
6. Credential privacy: no credential/code/verifier/state or raw error rendering, persistent browser storage or diagnostic artifacts; no remote metadata/logo/script fetch from client values.
7. Runtime: built static export through actual Pages Functions; exact well-known paths avoid auth/SPA fallback; service binding preserves canonical public URL, cookie handling, no-store and query bytes.
8. Accessibility and narrow screens: labels and keyboard operation, visible focus, dialog semantics, Escape, 320px and 200% zoom with long untrusted names; no clipped decisions.
9. Regression boundary: root/main reviewer owns complete 14-command and existing feature-delta gates; UI reviewer reports its own focused commands/counts only, without implying complete suite coverage.

## Evidence plan

Wait for explicit root final source hold and complete source manifest. Independently trace source/dependencies, then run focused frontend/Pages checks. Use an isolated local browser and disposable synthetic database only if needed. Coordinate database/build/browser ports with main reviewer; never run destructive reset suites concurrently against one database. Record safe path/method/status, structural request facts, assertion outcomes, console counts, screenshots before callback and cleanup. Do not retain HAR, raw request headers, callback queries or secrets.

Runtime browser evidence must distinguish actual mounted API/Pages behavior, synthetic provider exchange, browser-intercept fixtures and untested real Google/Claude behavior. The configured DevTools MCP is unavailable; installed isolated Playwright is the local fallback. Review rubric is the unchanged six-category gate; whole-feature auditor owns the combined release verdict.

## Final report contents

Exact target/digest; reviewer independence; criteria and checked scope; exact commands/exits/counts/environment; findings with severity, path/line, reproduction, impact, counterevidence and fix; rejected candidates; gaps and actual runtime limits; immutable round record. Any held-source change invalidates the affected review.
