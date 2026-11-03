# Bounded comment and quick-add UI implementation

**Actions.** Implemented the frozen `ui-comment-repair-1` slice in 13 web source/test files. Exact hashes and observed commands are in [ui-comment-implementation.json](ui-comment-implementation.json). This is a raw implementation handoff, not feature closure, a score or independent approval.

**Why and options.** A browser can lose the reply after Flowboard saved a comment. Retrying must send the same operation key and original text/mention offsets, even if a later board poll changes versions. A retained command keeps that request unchanged until a successful resolution; a later sign-in refusal cannot prove that the earlier save failed; guessing a fresh key could post twice. Editing is enabled again after a definitive refusal on the first attempt, or after the original request is resolved. No database or API priority-default contract was changed.

**Evidence and limits.** Final web tests pass 250/250; optimized Next build passes 19/19 pages with type validity; web typecheck and diff whitespace check pass. Preserve the failed initial logs: missing cursor forwarding, scaffolding absence, a real sync-failure cleanup regression, and three legacy source-pointer assertions all have explicit disposition in JSON. API tests use a controlled transport model rather than a real backend; no browser/integrated or UAT pass is claimed.

**Next / your input.** Root runs the real local browser → API → isolated PostgreSQL workflow on the final assembled target, resolves any findings, obtains independent review and creates source-bound feature handoffs. Hosted UAT checks follow local gates and deployment. No action needed from the user for this handoff.

## Implemented behavior

- Retained command snapshots original payload and operation key through transport, 408 and 5xx uncertainty; later authorization/validation refusals cannot erase an earlier unknown outcome. In-flight submissions share one request. A definitive refusal on the first attempt permits intentional edit/new operation.
- Quick-add requires explicit priority and resolves original uncertain operation before editing/cancelling or selecting another column; original board version/input retained.
- Comments and card history use opaque cursor envelopes, load-next controls, dedupe and deliberate stale-cursor list reset without deleting drafts.
- Author-only versioned comment edit; author/Owner/Manager delete with confirmation, pending retry and immediate hidden-body tombstone rendering; Viewer and other Member moderation unavailable.
- Comment create/edit drafts and in-flight operation state retained in actor/card-scoped tab memory across tabs, refetch and card/project remount. Before-unload prompts on unsaved text.
- Mentions preserve actual UTF-16 spans for edits; IME key handling avoids accidental picker choice/quick-add. Drawer discussion tab arrow/Home/End handling and one tab stop; mutation errors use focusable accessible notes.
- Typed edit/delete/comment/activity API helpers; API/MCP priority-none contracts untouched.

## Actual local checks

- `node --test apps/web/test/comment-api.test.ts` — exit 1. Expected cursor forwarding assertion failed on original client, after removing unsupported Node parameter-property syntax from ApiError. [Raw log](ui-comment-red-api.log).
- `node --test apps/web/test/comment-state.test.ts` — exit 1. New helper module initially absent; scaffolding failure, not a behavior assertion. This log is not claimed as full red-phase behavioral proof. [Raw log](ui-comment-red-state.log).
- `node --test apps/web/test/comment-state.test.ts` — exit 1. Synchronous callback failure left retained command stuck; regression reproduced and then fixed. [Raw log](ui-comment-red-sync.log).
- `npm run test --workspace @flowboard/web` — exit 1. 245/248 passed; three legacy mention source-text assertions referenced former inline component. Equivalent checks were moved to extracted component paths, and full-name tooltip preserved. [Raw log](ui-comment-web-tests.log).
- `npm run test --workspace @flowboard/web` — exit 0. 250/250 passed; 11 new regression tests (9 state/command tests and 2 API boundary tests). [Raw log](ui-comment-web-tests-final.log).
- `NEXT_DIST_DIR=.next-build npm run build:web` — exit 0. Next.js optimized build, type validity, 19/19 static pages passed. [Raw log](ui-comment-build-final.log).
- `npm run typecheck:web` — exit 0. Final web tsc --noEmit. Check process exit is separately confirmed before parent relies on this result. [Raw log](ui-comment-typecheck-final.log).
- `git diff --check -- apps/web` — exit 0. No whitespace errors.

- `node --test apps/web/test/comment-state.test.ts` — exit1 in [unknown-then-auth refusal red log](ui-comment-red-auth-after-unknown.log); the real assertion caught an original-key reset after401 and was fixed before the250/250 final pass.

## Open verification limits

- API boundary tests replace fetch with a synthetic transport/receipt model. They prove emitted original payload/key and client behavior, not real PostgreSQL receipt correctness.
- Browser keyboard, assistive technology, focus, paging/draft/error transitions, true post-commit response loss and real HTTP permission behavior still require root integrated run.
- Current-tab drafts are intentionally not persisted to localStorage or restored after a confirmed hard reload; before-unload warns. No offline writes.
- No code outside apps/web changed by this agent except role-owned review reports/logs. Root and other agents are concurrently changing backend/contracts/governance.
- Other discovery findings (board/filter/placement/People/archive/import/session and wider accessibility) remain subsequent bounded slices.
- Next rewrote next-env.d.ts and tsconfig during isolated build; only those generated changes were restored to base before final typecheck. Root Next dev may rewrite generated paths again.

## Ownership and incidental shared-dialog text

Existing shared card close/delete confirmation now distinguishes retained comment drafts and names card/24h trash window while this shared dialog was touched. No deletion semantics changed.

No dependency installation, real credentials, cloud access, deployment, commits, application governance update or score was performed. The all-98 discovery matrix remains historical source discovery at the original SHA; this bounded implementation does not automatically mark those rows done.
