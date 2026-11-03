# Board paging, canonical Move and People permissions — raw handoff

**Actions.** Implemented the frozen `ui-board-repair-1` slice and its recorded People-directory amendment. [Structured record](ui-board-implementation.json) binds 32 current web source/test files, including inherited comment dependencies. No score or feature approval.

**Why and options.** A column with31 cards must not pretend its first15 cards are the whole column. Cursor loading asks the server for the next small page; canonical placement asks the server which cards truly sit before/after the chosen target. Downloading all cards would be simpler initially but grows response size and memory. Current counts come from the server rather than the loaded page length.

**Evidence and limits.** Web tests262/262, production build19/19 pages with type validity, standalone typecheck and whitespace check pass. Preserved intermediate failures are listed below. Root has separate Chrome/localAPI/PostgreSQL diagnostics for off-page cards/search and directory policy; they remain moving-source diagnostics, not final immutable-target acceptance.

**Next / your input.** Root runs final browser cases, assembles backend evidence and obtains independent full-target review. Invitation delivery/retained keys, remaining cursor feeds/My tasks project-only scope, imports/results and Google-avatar/workspace preferences are next explicit slices. UAT follows local gates and authorized deployment. No action needed.

## Implemented

- Server title, priority (including existing none), single-assignee and exact due filters; title typing is debounced and outdated reads consume AbortSignal. No seven-day claim for upcoming/Aftertoday.
- Per-column Load more uses actual opaque cursor and same original server filters. Page composition is canonical by position/ID, deduped by ID/version and bound to board snapshot/structure/calendar/filter generation. Actual full matching/total counts remain distinct from loaded arrays.
- Same-board previous data keeps drawer/form components mounted while changing filters; pending result is explicitly labeled. Stale cursors offer in-place board list reload without clearing drafts.
- Quick-add title/priority now live above individual columns so column-filter unmount/structure changes retain drafts. Missing original columns expose retained title/priority with deliberate destination selection; unknown operations cannot silently switch intent. Browser unload protects unsaved drafts.
- Drag resolves a visible before/after anchor through the actual placement endpoint. Visible Move supports first/last/before/after and a paginated unfiltered reference list. Drawer status movement also uses canonical last placement. Filtered drag remains disabled.
- Board archive/reopen uses shared confirmation and stable original request identity with expectedVersion=board.snapshotVersion. Owner/Manager archived discovery uses confirmed includeArchived=true and existing Board[].isArchived. Project archived state disables lifecycle/settings/create controls.
- Owner-only board name/description editing retained. Manager People controls cannot promote Manager or change/remove self,peer Manager,Owner; protected rows explain the rule.
- Latest user policy: full People directory and context nav are Owner/Manager only. Member/Viewer direct pages do not enable directory reads, suppress old cached rows/emails and show permission state; board-scoped assignee/mention pickers remain allowed.
- Retained-history column refusal has plain no-action copy; it does not approve or close BRD-06.
- No API/MCP priority-none default change, shared-contract/backend edit, dependency install, commit or deployment by this agent.

## Actual local commands

- `npm run test --workspace @flowboard/web` — exit0. 262/262 passed; prior comment/command regressions remain in the suite. [Raw log](ui-board-web-tests-final.log).
- `NEXT_DIST_DIR=.next-build npm run build:web` — exit0. Optimized production build and type validity passed;19/19 pages rendered. [Raw log](ui-board-build-final.log).
- `npm run typecheck:web` — exit0. Final standalone web typecheck, process result confirmed separately. [Raw log](ui-board-typecheck-final.log).
- `git diff --check -- apps/web` — exit0. No whitespace errors.

## Preserved failed attempts

- [ui-board-red-api.log](ui-board-red-api.log): Missing cursor/placement methods reproduced before implementation.
- [ui-board-red-column-copy.log](ui-board-red-column-copy.log): Retained-history refusal fell back to a fake reload remedy; fixed with explicit no-action copy.
- [ui-board-red-pages.log](ui-board-red-pages.log): New helper scaffolding was absent. This is an availability failure, not behavioral red proof.
- [ui-board-red-directory-policy.log](ui-board-red-directory-policy.log): New directory-policy exports were initially absent; not claimed as behavioral red proof.
- [ui-board-red-archived-client.log](ui-board-red-archived-client.log): Actual URL assertion failed because archived option was ignored; fixed explicit includeArchived=true serializer.
- [ui-board-typecheck-people.log](ui-board-typecheck-people.log): Intermediate misplaced role-options replacement referenced unavailable controls; corrected directory filter options.
- [ui-board-typecheck-archived.log](ui-board-typecheck-archived.log): Intermediate optional stats projection dereferenced null; corrected explicit pending/unavailable counts.
- [ui-board-typecheck-draft-state-failed.log](ui-board-typecheck-draft-state-failed.log): Draft lift spread repeated title/priority defaults; corrected fallback object spread.
- [ui-board-build-draft-state-failed.log](ui-board-build-draft-state-failed.log): Same draft-state type error caught by production build; fixed, all final gates rerun.

## Open verification and remaining scope

- This is implementation/local verification evidence, not independent review approval or feature closure. Final immutable full-product source review and integrated acceptance still required.
- Root Chrome156 + real local API/PostgreSQL diagnostics in raw/browser-board-roles-1/results.json passed off-page card24 continuation/title search and Owner/Manager-only People directory requests. Artifact labels itself moving-source synthetic diagnostic, not final-target acceptance.
- Root still needs final-target canonical before/after/last placement, stale cursor/role/conflict, archived discovery/reopen, quick-add draft-through-filter, keyboard/focus and narrow-view browser cases.
- Lifecycle backend owner is responsible for bounded placement SQL, snapshotVersion OCC, soft-column history preservation and paged key/excerpt projection; this UI report does not independently approve those changes.
- Move Undo still uses ordinary move/latest cache and needs explicit CRD-12 repair. Field Save plus status move remains two operations with partial-outcome handling needed (UI-09).
- Full cross-project/navigation draft persistence and feed/import/profile/workspace preference gaps are subsequent slices. Card date-label helper still uses browser-local day even though server filter/counts use workspace day; timezone display needs the later profile/preferences slice.
- Unknown command outcomes deliberately retain original input/key; broader expired-receipt/user-driven resolution policy remains final acceptance work.
- Next-generated next-env.d.ts/tsconfig paths were left for root runtime coordination; no blind revert of .next-e2e state.

The all-98 discovery report and earlier comment manifest remain historical snapshots; this incremental handoff does not automatically check any generated feature box or replace fresh backend review evidence.
