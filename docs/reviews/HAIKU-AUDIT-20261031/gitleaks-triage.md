# Gitleaks triage (Haiku audit, 2026-10-31)

Scope: the 249 redacted `generic-api-key` detections that Round 4 Codex reported but did not open. This is a read-only triage. No secret values are printed or copied here. Findings are described by file path, line number, rule and classification only.

Method:
- Gitleaks 8.30.1 ran on the working tree with `--no-git --redact` and wrote `docs/reviews/HAIKU-AUDIT-20261031/gitleaks-worktree.json`. It found 252 detections, all `generic-api-key`.
- Git history was checked against the existing Codex report `docs/reviews/CODEX-AUDIT-20261031-D/raw/gitleaks-history.json` (249 detections). Each history hit was looked up in its own commit by file and line, and classified by the line's shape (never the value).
- Each detection was classified by the shape of the line it sits on: a `"<path>": "<64 hex>"` manifest entry, a test `Idempotency-Key` header, a cookie or build-output key, or other.

## Summary counts

| Class | Count |
|---|---|
| False positive | 244 |
| NEEDS HUMAN REVIEW | 8 |
| Total (working tree) | 252 |

- Tracked by git: 246. Untracked (gitignored build output): 6.
- Git history scan: 249 detections in the same classes. The only non-false-positive items in history are the two cookie-log lines (commit 8daeb29b7a) and the test fixture line (commit 3272cfb263). The six `.next` items are not in history.
- Tracked files that are not tests or docs: `design/flowboard-ui/reviews/*-manifest.json` (2 detections). These are SHA-256 manifests, classified as false positive.
- The working-tree count (252) differs from the Codex count (249). The six `apps/web/.next` items are untracked build output. This report does not establish the exact cause of the difference beyond that.

## Group table

| Path pattern | Rule | Count | Classification | Reason |
|---|---|---|---|---|
| `docs/reviews/**` (manifests and review artifacts, e.g. `*/auth.ts`, `*/API.md`, `*/board-access.test.ts`) | generic-api-key | 219 | False positive | Each line is a JSON entry mapping a source path to a 64-character SHA-256 content hash. Manifest hashes, not credentials. |
| `apps/api/test/*.test.ts` (brd01-brd07 8, inv01-inv03 7, com-del 4, prj01 1, imp01-imp06 1) | generic-api-key | 21 | False positive | `Idempotency-Key` header literal in test requests. Test header value, not a credential. |
| `design/flowboard-ui/reviews/*-manifest.json` (tracked) | generic-api-key | 2 | False positive | Same SHA-256 manifest shape as the docs manifests. Tracked, but a design review manifest, not source code. |
| `docs/research/product-research.md` | generic-api-key | 1 | False positive | `Idempotency-Key` example in a research document. |
| `packages/contracts/test/contracts.test.ts:114` | generic-api-key | 1 | False positive | String literal inside a test file. It is not placeholder-named and has no known live-provider prefix, so it is classified as a fixture with low concern. |
| `docs/reviews/BOARD-ACCESS-DELTA-20261028/reviewer-probes.log` | generic-api-key | 2 | NEEDS HUMAN REVIEW | See review list item 1. |
| `apps/web/.next/**` (untracked, gitignored) | generic-api-key | 6 | NEEDS HUMAN REVIEW | See review list item 2. |

## NEEDS HUMAN REVIEW list

1. `docs/reviews/BOARD-ACCESS-DELTA-20261028/reviewer-probes.log:4` and `:5` (tracked, in history at commit 8daeb29b7a). The line holds a 48-character `flowboard_oauth_state` cookie value from a probe run. The cookie is set with Max-Age=600, so it is almost certainly expired. It is still a real-looking cookie value in a tracked file. Action: confirm it is expired or never valid, then redact the value in place. Rewrite history only if the value is live.
2. `apps/web/.next/` (untracked, gitignored by `.gitignore` line 21, not in git history). Six detections:
   - `apps/web/.next/prerender-manifest.json:418` and `:419` (preview-mode signing and encryption keys)
   - `apps/web/.next/cache/.previewinfo:1` (two detections, preview-mode keys)
   - `apps/web/.next/cache/.rscinfo:1` (encryption key)
   - `apps/web/.next/server/server-reference-manifest.json:1` (server-action encryption key)
   Why: these are Next.js build-time keys, generated randomly per build. They are not a source credential, but they are real key material on disk. Action: confirm `.next/` was not uploaded or shared as a deploy artifact, and rebuild if it was.

## Notes

- The raw gitleaks JSON `docs/reviews/HAIKU-AUDIT-20261031/gitleaks-worktree.json` was written under the path the task allowed. Its Match and Secret fields are redacted.
- No value was printed, quoted, or written to this report. Checks used only key names, line numbers, value length and character class.
- Not verified: whether any `FP` hash or header value matches a live system, and whether the `.next` artifacts were ever published.
