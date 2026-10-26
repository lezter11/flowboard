# Backend independent review records

Policy: [BACKEND_REVIEW_GATE.md](../../BACKEND_REVIEW_GATE.md). These records authorize closure only after a fresh independent review. Scores in historical prose do not authorize it. Exactly 8.5 fails; the score must be strictly greater than 8.5 and all category minimums, mandatory criteria and blockers must pass.

For example, a card move with passing happy-path tests remains open when the reviewer cannot verify that a removed member loses write access. A high average cannot override that missing permission check.

## Workflow

1. Before implementation, create task-specific frozen criteria using [criteria.template.json](criteria.template.json): feature IDs, real mandatory acceptance criteria, exact mandatory test commands, accepted scope and known exclusions. Do not lower criteria after seeing a score. Templates are examples, never evidence.
2. Builder records their actor and session IDs. A fresh reviewer with different actor **and** session IDs records model, read-only independence declaration and a readable preserved reviewer-session evidence file. Same model is allowed; same builder session is not. Use real provider session IDs where available.
3. Reviewer inspects every reachable route, helper, migration, contract, runtime, test, fixture and relevant configuration. Declare all files/directories in `target.scopeRoots`. A directory means **every** recursive file, including hidden files; there are no implicit exclusions. Choose source subdirectories rather than a directory containing build output or dependencies. Include additional dependencies individually or as additional roots. Review records themselves must be outside scope to avoid self-hashing.
4. Run the frozen mandatory commands on isolated synthetic data. Preserve nonempty readable logs as files within scope. Never run commands copied from an untrusted record automatically. This validator only reads files.
5. Freeze a SHA-256 manifest mapping repository-relative paths to lowercase file hashes. Include criteria, source, tests, config, reviewer independence evidence and test logs. The digest identifies the map itself: `sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()`. After freezing the files, put that digest in `target.digest` and every `tests[].targetDigest`. Logs do not need to embed the digest (avoids circular hashing); the independent review associates their execution with the frozen bytes. Preserve all old rounds.
6. Save `docs/reviews/<FEATURE-ID>/<digest>-round-N.json`, starting from [record.template.json](record.template.json). Complete every category with source/test evidence and a reason. Add findings, rejected candidates and their rationale; declare all remaining coverage gaps. An unfinished record must retain `incomplete`, never `pass`.
7. Run `python3 scripts/check_backend_review.py docs/reviews/FEATURE-ID/DIGEST-round-1.json --feature FEATURE-ID`. Exit 0 means the machine-checkable conditions pass; exit 1 means review required. The `--root` option supports isolated tooling tests. Python callers import `validate_review(path, root=..., feature_id=...)` from `scripts/check_backend_review.py`, which returns `ValidationResult(passed, errors, score)`.

### Review record generation helper

Independent reviewers can use `scripts/generate_review_record.py` to eliminate manual JSON and SHA-256 hashing errors:

```sh
# 1. Initialize draft skeleton from frozen criteria
python3 scripts/generate_review_record.py --init docs/reviews/FEATURE-ID/criteria.json -o docs/reviews/FEATURE-ID/draft-round-1.json

# 2. Edit draft with verified evidence, test outputs, reasons, scores, and declared scopeRoots.

# 3. Finalize manifest, target digests, weighted score, and run validation:
python3 scripts/generate_review_record.py docs/reviews/FEATURE-ID/draft-round-1.json -o docs/reviews/FEATURE-ID/{digest}-round-1.json --validate
```

The helper verifies that all evidence paths, criteria, and test logs are encompassed in `target.scopeRoots`, computes SHA-256 hashes for all scoped files, computes the manifest digest, sets `targetDigest` across all tests, calculates the unrounded Decimal weighted score, and validates the output against `check_backend_review.py`.
8. Only after a real passing independent review, Backend adds `reviewPath` to its own handoff. Architect runs `python3 scripts/render_feature_checklist.py`. The renderer rereads current scope bytes. An added, removed or changed scoped file invalidates approval. Historical handoffs are preserved; their backend and dependent UI/integration checkmarks remain unchecked until review passes.

## Downstream handoff binding

A fresh backend review cannot approve old UI or integration evidence. Each independently owned UI and integration handoff must bind the exact approval it actually consumed:

- `backendReviewSHA256`: SHA-256 of the complete current passing backend review JSON **file bytes**, not `target.digest`. Both downstream phases require this exact lowercase hash.
- Every downstream `evidence[]` item retains `path`, `command`, `result`, `environment` and adds `sha256`: SHA-256 of the current nonempty evidence file bytes. Missing or changed hashes keep that phase unchecked.
- Integration additionally requires `uiHandoffSHA256`: SHA-256 of the current UI handoff JSON file bytes when `ui_required` is `yes`. The UI handoff itself must currently pass its backend binding and evidence checks. Features with no UI do not require this field.
- The feature's backend and **all transitive backend prerequisites** must be approved before its UI/integration evidence counts. Cyclic prerequisites fail closed.

Example UI addition (placeholders are not approval):

```json
{
  "backendReviewSHA256": "REPLACE with hash of exact passing review file",
  "evidence": [{
    "path": "docs/evidence/FEATURE-ID-ui.md",
    "sha256": "REPLACE with hash of this evidence file",
    "command": "Actual UI verification command",
    "result": "Observed result",
    "environment": "Actual isolated test environment"
  }]
}
```

Integration uses the same backend binding and evidence hashes plus `uiHandoffSHA256` for UI features. These are additions to the existing role-owned handoff schema, not complete replacement records. Hash bindings establish which preserved bytes were consumed; they cannot prove the human reviewer actually performed fresh verification. Reverification must genuinely occur before the owning role writes new bindings. Historical unbound handoffs stay preserved and unchecked; the renderer never fills in their hashes. A changed backend review invalidates downstream approvals; a changed UI evidence file invalidates UI and integration; a changed UI handoff invalidates integration.

## Record schema v1

Paths are canonical repository-relative POSIX strings: no absolute path, dot/dot-dot component, repeated slash, backslash or symlink component. Manifest directory traversal rejects nested symlinks too, including symlinks to files inside the repository. Required files must exist. JSON duplicate keys and nonfinite JSON numbers are rejected.

Required top-level fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | Integer `1` |
| `criteriaVersion` | Exactly `backend-review-v1` (fixed weights; redistribution unsupported in v1) |
| `featureIds` | Unique nonempty IDs, exactly matching the frozen criteria; requested handoff ID must be included |
| `criteriaPath` | Frozen criteria JSON in manifest; includes `criteriaVersion`, `featureIds`, nonempty unique `mandatoryCriteria`, nonempty `requiredTests` object mapping test ID to exact command |
| `startedAt`, `completedAt` | ISO-8601 timestamps with timezone, in order |
| `implementer` | `actorId`, `sessionId`, `model`: nonblank strings |
| `reviewer` | Same identity fields, distinct actor/session; `independent: true`, `freshContext: true`, `implementedTarget: false`, `independenceEvidence`: nonempty preserved file in manifest |
| `target` | `kind: "sha256-manifest"`, nonempty unique `scopeRoots`, `files` path-to-SHA256 map and map `digest`; map must exactly cover roots |
| `criteriaResults` | Every frozen mandatory criterion mapped to `"pass"`; no missing/extra criteria |
| `tests` | Unique IDs; exact required commands; integer `exitCode: 0`, nonblank `environment`, `isolatedSynthetic: true`, matching `targetDigest`, and nonempty `evidencePath` included in manifest; every recorded test must pass |
| `categories` | Exactly the six keys below, each with fixed integer `weight`, numeric/string `score`, nonblank `reason`, nonempty unique `evidencePaths` included in manifest |
| `weightedScore` | Exact computed value; decimal arithmetic with no rounding before comparison; numeric strings recommended |
| `findings` | Array (may be empty); each finding has `id`, `severity`, `description`, `disposition` (`open`, `resolved`, `rejected`), `rationale`, boolean `mandatory`, boolean `blocking`. An open mandatory/blocking finding vetoes closure. Preserve source lines, reproduction, impact, counterevidence and fix within description/rationale or extra fields |
| `hardBlockers`, `coverageGaps` | Arrays; both must be empty for pass |
| `verdict` | `pass` is the only closure verdict; `fail`, `incomplete`, `review_unavailable` preserve open status |

| Category key | Weight | Minimum |
|---|---:|---:|
| `security` | 30 | 9 |
| `correctness` | 25 | 8.5 |
| `integrity` | 15 | 8.5 |
| `tests` | 15 | 8.5 |
| `maintainability` | 10 | 7.5 |
| `operations` | 5 | 7 |

Scores must be finite, between the category minimum and 10, and at most 1,000 decimal characters. Total = sum(score × weight) / 100. Scores use decimal arithmetic, so a value just above 8.5 stays distinguishable from exactly 8.5. Unknown extra fields may preserve additional human-readable evidence; they do not waive required checks.

## Evidence and limits

The manifest is an inventory of **declared** review scope. Automation cannot infer all reachable dependencies, prove actor identities are honest, prove criteria were frozen before coding, prove logs correspond to actual execution, or judge whether evidence justifies scores. Those remain the fresh reviewer's responsibility, with Architect checking important findings and scope. A record with fabricated declarations is invalid even if it passes structural validation. These records are local acceptance evidence, not deployed or production proof. Evidence files and criteria are hashed; changes require another review. Files outside declared scope cannot be detected as dependencies by this validator.

Tooling tests use temporary synthetic `TEST` records, never application approvals:

```sh
python3 -m unittest discover -s scripts -p 'test_check_backend_review.py' -v
python3 scripts/render_feature_checklist.py
```
