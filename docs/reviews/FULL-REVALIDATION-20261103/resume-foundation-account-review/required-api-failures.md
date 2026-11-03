# Exact required API failure inventory

Executed independently on source635 / digest6f0df7007c67963b3625bd902ed2f13b212064fd73f73c6932a4051718add04c. API process exit1;1761 tests,1750 pass,11 fail,0 skip,0 cancelled. Eleven includes8 leaf failures plus3 failing parent groups; it is not eleven distinct product defects.

| Leaf test | Definition / failure site | Observed | Interpretation / counterevidence |
|---|---|---|---|
| DELETE /api/v1/comments/{commentId} | cookie-mutation-matrix.test.ts:21 / support/route-auth-fixture.ts:74 | No typed body factory for DeleteCommentBodyInput | Matrix never makes this request; fixture still keys DeleteCommentInput. Does not prove route defect or grant its missing cells. |
| DELETE /api/v1/comments/{commentId} / anonymous | route-auth-matrix.test.ts:34 / fixture:74 | Same missing factory | Required authentication cell unexecuted. |
| DELETE /api/v1/comments/{commentId} / expired_session | route-auth-matrix.test.ts:34 / fixture:74 | Same missing factory | Required expiry cell unexecuted. |
| DELETE /api/v1/comments/{commentId} / valid_pat_with_owner_cookie | route-auth-matrix.test.ts:34 / fixture:74 | Same missing factory | Required explicit-PAT capability cell unexecuted. |
| DELETE /api/v1/comments/{commentId} / expired_pat_with_owner_cookie | route-auth-matrix.test.ts:34 / fixture:74 | Same missing factory | Required no-cookie-fallback cell unexecuted. |
| purge: removes only windows that have ended, and a repeat run deletes nothing for them | rate-limit-postgres.test.ts:82 / assertion:91 | current.count2 !=1 | Test seeds a same-key auth window at now-30. When epoch second remainder is30, this equals the canonical current60s window. Atomic consume correctly increments the seeded row. Clock-dependent fixture collision is a supported explanation, not a proven purge defect; the failing assertion happens before purge. Make timestamps deterministically distinct from the live window. |
| node:MyTasks1000-row cursor walk, tied/NULL dates, filters and actual query growth | runtime-validation.test.ts:153 / request/assertion:165 | search422, Unrecognized key titleQuery, expected200 | Strict search schema expects query. A stale test parameter prevents the later assertions; not evidence valid supported search fails. |
| worker:MyTasks1000-row cursor walk, tied/NULL dates, filters and actual query growth | runtime-validation.test.ts:153 / request/assertion:165 | Same422 | Same stale test input on actual workerd. |

Parent failures: generated cookie resource mutation isolation with genuine authorized controls; generated route auth matrix: mounted inventory, every bearer boundary, sessions and real private targets; FND04/UX05 actual Node and workerd protocol, caps,1000-card samples and SQL deadline validation. Preserve all raw logs. No fixture source was edited by this reviewer, and no rerun is substituted for this failure.
