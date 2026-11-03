# MCP repair: ready for dev → UAT testing

**Local acceptance passed:8.98/10, fresh independent round2.** All category minimums pass, with no open mandatory blocker. Architect separately reran the review validator (exit0) and verified the440-file frozen source is unchanged. No push, deployment, signed-in UAT acceptance or production approval is claimed.

Branch: `codex/mcp-uat-hardening`, based on62ce05f49aed3179bf6af97ffb3f5415512ef392. Reviewed source digest: `459b4fa9cdddc4bb9c499572203aaf2334f909a9a69a5ec82372a2a75c14acd4`.

[Passing review record](4a3ccc28fead268148e65d5ee4f5bdef56a921984167dd4e30d909fc0943d84b-round-2.json) · [Independent report](independent-round-2/review.md) · [Frozen criteria](criteria.json) · [Source manifest](source-manifest-round-2.json) · [UAT test plan](UAT-TEST-PLAN.md)

## Actions

All eight original MCP findings are repaired: deny-by-default token routes; metadata-only discovery; project filtering before pagination; stable operation IDs/replay; real Owner token issuance; correct search; reproducible compiled executable/CI; and safe human/credential audit provenance. Credential issuance is bounded with finite default expiry. HTTP calls have validated inputs, deadlines, response caps and safe errors. A date-validation edge case, migration embedding parity and UI error wording were corrected during integration.

Independent round1 failed8.345 because direct board listing still exposed descriptions despite client filtering. The API now explicitly projects its PAT response, and a mounted description/card sentinel test verifies both the restricted token and existing session behavior. [Failed round1](cd1e01b70bbcd8ba1a3cffa4a93edcedd6cd27228af89b75cda10df711061ca2-round-1.json) and all unsuccessful attempts remain preserved. Criteria were not narrowed.

## Why and options

Permissions must control what the server actually sends. Hiding fields inside Claude's client would leave direct API callers able to read them. Narrow server responses fit the current modular monolith; a dedicated company-integration API remains future work. A stable operation ID means a lost reply can be retried without creating a second card. That guarantee lasts seven days in one credential namespace, rather than providing permanent fleet-issue deduplication.

## Evidence and limits

| Final local check | Actual result |
| --- | --- |
| Complete API / disposable PostgreSQL |787passed,0failed,0skipped |
| Contracts |117passed |
| Web unit/regression tests |239passed |
| MCP client |17passed |
| Packed executable / real SDK stdio |1passed |
| Mounted API, Pages proxy and real local workerd probes |22groups passed |
| Independent extra adversarial / authority probes |3+4groups passed |
| Root/web typecheck, MCP/Worker/web builds, UAT-only dry run |exit0 |

That is1,161 reported suite tests plus22 acceptance probe groups; independent reruns are not added to inflate the suite count. Generated authority checks cover103 mounted operations:97 denied outside six explicit capabilities. Separate PostgreSQL connections exercised same-key writes and both revoke/write lock orderings. Test database was disposable PostgreSQL17.11 on loopback55923; actual hosted Hyperdrive remains unverified.

Final builder logs: [raw-round-2](raw-round-2). Independent execution/evidence: [independent-round-2](independent-round-2). Earlier failed test runs, sandbox refusals, fixture mistakes and a model-capacity interruption are recorded honestly, not counted as passes. Scores: security9.1, correctness9.0, integrity9.2, tests9.0, maintainability8.7, operations8.0.

The separately approved sanitized npm advisory check still reports2production-tree advisories (1high/1moderate in Next/PostCSS),5across all dependencies including development tooling. See [reports](raw/npm-advisory-commands.json) and existing SECURITY_ROADMAP. Dependency status is not clean; this is an internal development/UAT candidate. No public company integration or production release is approved. Remote MCP OAuth, installation budgets, durable external-issue identities and credential-management UI remain future work.

## Next / your input

Promote this exact reviewed candidate through dev CI, then the UAT-only environment after authorization. Check migration0020 through the authorized UAT release procedure; no new0021 migration is needed. Follow the signed-in Owner/Member/Viewer, create/retry, scope, audit and revoke cases in the UAT test plan, using synthetic records and locally protected credentials. Source changes or merge conflicts require matching fresh checks/review. Production remains a separate decision. No credentials need to be sent in chat.
