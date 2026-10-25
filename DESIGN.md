# Flowboard design direction

Status: reference-informed exploration, not accepted visual design or implemented components. Updated 2026-10-26.

## Source and ownership

All originals and their checksums live in [docs/references](docs/references/README.md). UI owns implementation in apps/web after the shared contract and first visual flow are ready. Backend also reads the reference catalogue to understand visible states, counts, metadata and detail-loading needs. Reference business content never expands scope.

## Direction to explore

The newest reference suggests a quiet light workspace: slim left navigation, readable task heading, a broad lifecycle summary, pale column surfaces, white cards, compact metadata and restrained teal accents. Earlier references show dark density and light column summaries. Preserve these alternatives; do not declare dark mode, an AI-agent navigation system, financial metrics or workflow automation accepted.

Proposed initial vibe: calm, precise and easy to scan. Favor layout and typography over decorative effects. Card title is strongest, then assignee/priority/date and comment/activity metadata. Large boards use horizontal scrolling with clear affordances; details use a focus-managed dialog/drawer suitable for viewport size.

## Tentative tokens

These are proposed starting values, not sampled brand assets or approved tokens.

| Token | Proposal | Reason |
|---|---|---|
| Font | system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif | No external font request; broad OS support |
| Canvas / column / card | #F7F9FA / #EFF3F4 / #FFFFFF | Quiet separation of board layers |
| Text / secondary | #18262D / #52636D | Clear hierarchy; verify contrast at actual sizes |
| Accent | #0F766E | Teal cue from latest reference, pending review |
| Border | #D7DFE3 | Subtle grouping and control edges |
| Radius | 8px controls, 12px cards | Consistent compact geometry |
| Spacing | 4px base; 8/12/16/24px common steps | Predictable density |

## Components and states

Board shell, workspace/project switcher, column header/count/settings, task card, quick add, filter bar, card dialog, assignee/mention picker, comments/activity, Move menu, confirmation and notification inbox. Summary counts must have a defined denominator and filter scope; never infer progress percentage from a column name.

Each component needs loading, empty, error, disabled, pending and permission states where applicable. A stale move shows a recoverable conflict and canonical state, not a false success. Support long titles, duplicate names, emoji, no assignee, multiple assignees and overdue dates.

## Interaction and performance

Provide visible click/tap Move as well as keyboard support and drag. Preserve focus; announce movement; never rely on color alone. Dialogs manage focus, labels, Escape and unsaved drafts. Mention selection must respect IME input and ordinary editing.

Lazy-load detail content, paginate board/comment data and measure rendering with realistic card counts. Consider virtualization only after profiling; test drag, focus and screen-reader behavior with it. Bundle size and interaction latency get measured budgets rather than assumptions.

## Pending design review

- [ ] Choose final light/dark direction and accent.
- [ ] Review one board + card dialog + Move + comment flow.
- [ ] Agree desktop/narrow viewport behavior and card density.
- [ ] Verify contrast, keyboard, click/tap alternatives, zoom and reduced motion in implementation.
- [ ] Record approved tokens/components here before scaling UI work.

## Required screen flows v0.3

Follow [FEATURE_SPEC.md](docs/FEATURE_SPEC.md) for detailed behavior. Project navigation shows only owned/granted projects. Owner sees all owned projects; Manager is labeled inside the current project. People/settings/import/trash actions follow the Owner/Manager permission matrix.

Screens to design and implement after corresponding backend handoff: sign-in/invitation states; projects and project setup; project board list; board/search/filters and counts; card popup with fields and separate Save/Post/Upload; private image gallery; chronological card activity and owner cross-project feed; project people/pending invitations; 24-hour trash with exact deadline and restore destination; Excel template/download/upload/preview/mapping/error/confirm/result states; My tasks; inbox; archive/reopen settings.

Card Delete is Owner/Manager only and explains the 24-hour recovery period. Popup shows title, description, priority, date-only due date, project-eligible assignees, comments, images and activity. Uploading/posting must not accidentally save form drafts. File/upload errors stay specific; expired restore never looks successful. The seven-column import template has blank Cards and separate Instructions/examples.

Visual exploration may proceed before backend completion, but production UI implementation for each feature follows its verified API/evidence handoff. UI updates its own evidence and regenerates the central checklist; it must not mark a fixture-only screen integrated.
