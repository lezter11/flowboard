# Independent COM/DEL review — round 4

Target: `ff6da1b4c655f8c5bee89e651111e80653f763a672639d8dee3d0f5241ad270c` (115 files). Reviewer: fresh GPT-6 Luna subagent. No actor/session identifiers were exposed by the agent runtime.

## Result

Fail, 8.38/10. The focused PostgreSQL suite passed 36/36 tests. The reviewer verified all manifest hashes before and after. This scoped review did not establish broader Stage 2 or hosted behavior.

| Category | Score | Minimum |
|---|---:|---:|
| Security and authority | 9.1 | 9.0 |
| Functional/API correctness | 8.2 | 8.5 |
| Data integrity/concurrency | 7.8 | 8.5 |
| Test quality/evidence | 7.8 | 8.5 |
| Maintainability/portability | 8.6 | 7.5 |
| Operations/recovery | 8.0 | 7.0 |

Weighted score: 8.38/10.

Findings:

- Purge-wins is tested sequentially (purge, then restore attempt), while restore-wins uses separate connections and a held row lock. Frozen round-4 criteria require both outcomes against real row locks.
- Outbox source locking/revalidation is present, and delayed delivery after purge is tested, but no concurrent outbox-versus-purge or outbox-versus-comment-delete interleaving is exercised.
- The scheduled callback test calls `worker.scheduled` directly on an empty truncated DB. It does not show a mounted scheduled Worker processing synthetic purge and outbox records.
- `COM-06` describes UI draft/mention-picker behavior in `docs/features.tsv`; that is outside this backend source manifest and should not be treated as a backend implementation defect. The frozen criteria's inclusion of COM-06 is a scope-definition issue.
- The `RULES.md` board-access statement conflicts with the user-provided project-only access instruction and `FEATURE_SPEC.md`/`API.md`; this is a documentation inconsistency, not a separate board-grant requirement for this audit.
