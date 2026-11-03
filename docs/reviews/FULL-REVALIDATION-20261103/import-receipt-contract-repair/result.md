# Import response repair — implementation evidence, not approval

Invalid previews and cleaned receipts are distinct response forms. Valid new/created/already-imported/skipped rows retain existing strict source limits. Invalid/conflicting rows may contain the bounded missing or oversized raw values the user needs to correct, with nonempty field errors. Explicit `contentRedacted:true` rows contain null removed fields, empty recipients/errors, and only row number/outcome/card reference. Database cleanup still clears original content; no secret is restored or replaced with an invented External ID.

The UI explains retention and labels a retained card link “Open card from row N”, rather than rendering an empty link or pretending a removed priority was “none”. Existing unredacted wire rows may omit contentRedacted for compatibility; current producer emits false explicitly.

`red-tests.log` preserved6failures; two early test setup errors used the wrong cancellation envelope and delete route. Those were corrected to the actual ImportCancelResponse and POST `/cards/:id/delete`, without changing application behavior. `red-tests-2.log` then reproduced all6 contract/privacy failures on the correct mounted flow. `green-tests.log`:6/6,0skips, exit0, explicit disposable PostgreSQL17.11-alpine55931. These include invalid raw fields blocked from commit, real committed cleanup, cancelled/expired GET, per-card purge redacting one row only, and no private field leakage.

Whole API/MCP typecheck and web typecheck both exit0. Combined contract/import-state/error-catalogue command:156/156,0skips, exit0 (overlaps the2 contract cases above; totals are not added as unique coverage). OpenAPI regenerated. Root retained browser flow is being strengthened to parse the actual cleaned response and click its safe named card link; that new browser assertion is not yet executed.

Prior independent import round2 remains FAIL. Final held source, complete gates and independent round3 are still required. This file is builder evidence, not a score, feature closure, UAT or production approval.
