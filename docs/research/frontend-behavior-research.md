# Frontend behavior research and coverage findings

Date: 2026-10-26. Task: check whether Flowboard already has an exhaustive frontend functional list, and fill the behavioral/edge-case planning gap while leaving visual design to the user and Deepseek. No application code, mockup, dependencies or approval records changed.

## Answer from the repository

The existing [features.tsv](../features.tsv) contains 98 **shared product units**, not 98 backend-only features. Its generated [checklist](../FEATURE_CHECKLIST.md) already includes B/U/I evidence gates. Exactly 74 units require standalone frontend handoffs; 24 are backend/foundation controls without a standalone UI. [FEATURE_SPEC.md](../FEATURE_SPEC.md) and [IMPORT_SPEC.md](../IMPORT_SPEC.md) already describe important frontend behavior such as independent Save/Post/Upload, version conflicts, Move alternatives and explicit import confirmation.

The missing layer was a consolidated browser-level acceptance inventory: the concrete sequence of actions, changed state, failure, recovery and test evidence for each control and flow. Cross-cutting concerns were spread between the product/API/design docs rather than presented as stable frontend test cases.

New companion documents:

- [FRONTEND_BEHAVIOR_SPEC.md](../FRONTEND_BEHAVIOR_SPEC.md): state rules, error handling, draft/privacy proposal, unresolved contracts and verification approach.
- [FRONTEND_BEHAVIOR_CHECKLIST.md](../FRONTEND_BEHAVIOR_CHECKLIST.md): 214 stable FE cases in 20 areas; 165 contract-derived cases and 49 proposed engineering safeguards. All 98 existing product IDs, including the 74 UI-required units, have mapped cases. Every case remains unchecked.

These are acceptance subcases, not 214 new product features. Numeric completeness does not imply all future bugs are covered.

## Independent Luna research

Two fresh-context `gpt-6-luna` agents researched in parallel with read-only access:

- `/root/frontend_reliability_research`: browser navigation, session/context isolation, request ordering/cancellation, idempotency/retry, forms/drafts, storage/privacy, files/dates and verification.
- `/root/frontend_flow_research`: product journeys and edge cases mapped to the 98 IDs, including people/invites, board/card/Move, discussion, images, trash, import, feeds and later administration.

Both concluded that the shared feature catalogue covers the product but needs detailed frontend acceptance cases. Both distinguished mockup interactions from API/persistence/authorization evidence. The primary agent reconciled their recommendations against local specifications rather than copying every suggestion as a requirement.

Corrections made during synthesis:

- Do not add notification mark-all/read-all or filters not specified by the existing API.
- Archived boards/projects remain readable to authorized actors; they do not deny image reads merely by being archived. They prevent writes and do not pause trash deadlines.
- Do not promise private draft persistence across explicit logout/account change or hard refresh. Ordinary safe draft retention, session-expiry quarantine and confirmed access loss need distinct rules.
- A browser AbortController does not establish that a server mutation rolled back; lost results must be reconciled.
- Back navigation during import is not proof that the server session canceled. Cancellation before committing and unknown in-progress outcomes are separate states.
- The official workbook includes seven columns, while IMPORT_SPEC allows missing optional headers with defaults. Do not reject every workbook lacking all seven headers.
- Generic card field Save cannot change column ancestry. The mockup's staged status behavior requires an explicit Move sequence or a coordinated contract change.
- API lifecycle shapes already specify serverNow for trash/upload/import and feature-specific status recovery. Follow those documented shapes and validate current shared-schema/handler agreement; do not invent an additional generic operation-status endpoint.

## Gaps now made explicit

| Area | Example of a previously scattered or implicit acceptance case |
|---|---|
| Navigation/history | Reload a shared card URL; use Back after logout; handle wrong/foreign IDs without leaking names |
| Async state | Slow Project A response arrives after switching to Project B; old polling response follows a new successful save |
| Uncertain writes | Server saved the comment, Wi-Fi failed before response, Retry must not post it again |
| Concurrent state | Failed optimistic move must not restore an old board snapshot over a different successful update |
| Draft isolation | Posting a comment must not save dirty card fields; delayed Save must not clear text typed after submission |
| Permissions | Role changes while menus are open; revoked grant with pending write; old invitation must not restore removed access |
| Browser/resources | Storage denied, malformed API JSON, failed script chunk, component exception, canceled file picker, leaked object URLs |
| Time/text | Workspace date versus browser timezone; exact restore boundary; emoji before a structured mention; IME Enter behavior |
| Files/import | Bytes transferred is not finalized upload; preview creates no cards; commit cancellation cannot promise rollback |
| Verification | Real browser clicks + backend state + reload, two isolated identities, fault injection and preserved regression evidence |

## Official technical sources checked

The project requirements above come from local product/API documents. These external sources support browser/test mechanisms; they do not approve Flowboard's implementation or prescribe visual design.

- [MDN: Using Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch): fetch may fulfill for HTTP errors; check response status. AbortController cancels the client request/response handling. The requirement to reconcile possible committed writes is a Flowboard safety inference, not a browser rollback guarantee.
- [MDN: pageshow](https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event): page display/restoration events inform browser Back/Forward tests. Our proposal is to revalidate app-controlled authentication/context state on restored views; previously delivered bytes cannot be recalled.
- [Playwright: Network](https://playwright.dev/docs/network): browser request interception and modification can exercise controlled failure/ordering cases. Such simulations prove client behavior under supplied responses, not real server/DB invariants.
- [Playwright: Isolation](https://playwright.dev/docs/browser-contexts): isolated browser contexts support separate actor/test sessions. Two contexts still need real server/database scheduling for concurrency acceptance.
- [Playwright: Authentication](https://playwright.dev/docs/auth): saved authentication state may contain sensitive cookies/headers. Synthetic test state needs private handling and must not be committed or mistaken for real identity proof.

Framework versions and deployment mode were not selected or installed in this research. Follow the existing [Next.js ADR](../decisions/0003-nextjs-frontend.md) and verify actual selected-version documentation during implementation. Core behavior acceptance is framework-independent.

## Evidence and limitations

Repository inspection found no `apps/web` application and no separate frontend behavior checklist at task start. The two design READMEs explicitly label synthetic/local data and absent real backend verification. No separate Deepseek HTML file was attached or inspected. No browser, application, backend or database tests ran in this documentation task. Backend source was changing in the shared checkout; this work neither modifies nor reapproves it.

Document checks validate unique FE IDs, valid feature mappings, all 98 IDs covered, the 74 UI-required units covered, C/P and priority tags, local links and unchecked status. These are document consistency checks only. An independent read-only Luna pass reviews scope/contract consistency; that is not the backend acceptance gate or security approval.

The independent documentation reader found and the primary agent corrected: an outdated claim that serverNow was missing; ambiguous project-versus-board archive authority; optional import header wording; the classification of proposed frontend setup checks; and missing explicit image-removal confirmation. The reader judged the behavioral coverage sufficient for this planning request. No numerical backend approval or runtime verification is claimed.

Final document consistency run on 2026-10-26 exited 0: 214 unique unchecked FE IDs, 20 groups, 165 C + 49 P cases, 98/98 valid product mappings, 74/74 UI-required mappings, and all relative Markdown links resolved. The independent Luna reader re-read the corrected passages and reported no remaining delivery blocker for these planning documents. This is not a frontend test pass or production-readiness finding.

Implementation remains feature-first and review-gated: agree any P safeguards/missing contracts, consume a current independently approved backend feature, implement corresponding frontend behavior, record actual browser evidence, then perform integration acceptance. The 98 shared IDs and all role-owned approval records remain unchanged by this research.
