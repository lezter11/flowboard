# Task2 independent frontend acceptance

Date: 2026-10-28

Reviewer: dedicated independent review subagent `/root/frontend_acceptance`, assigned by `/root`. This reviewer did not implement or modify `apps/web` and performed a source review and isolated browser checks of the running production-built preview at `http://127.0.0.1:3001`.

## Decision and scope

**PASS for Task2 pre-integration UI acceptance: 8.8/10. No blocking UX issue found in this bounded review.** The score is strictly greater than 8.5. This accepts the local preview and its explicitly deliberate unavailable states against C1–C5; it does not establish feature integration or deployment readiness.

| Criterion | Score / 10 | Basis |
| --- | ---: | --- |
| C1: Required routes or deliberate unavailable states | 9.0 | Routes and clearly explained unavailable states cover the intended journeys. |
| C2: Board identity and project-scoped combined view | 9.0 | Dynamic board identity is consumed; individual-board filtering and the combined preview stay within the one preview project and its accessible-board allowlist. |
| C3: Honest actions, explicit priority, draft preservation | 9.0 | Local changes are labeled browser-session preview operations; disconnected mutations explain their unavailable state. New-card priority validation retains the draft. |
| C4: Responsive, keyboard and visual usability | 8.0 | Core mobile, keyboard, fullscreen and overlay flows work; residual dark-theme contrast issues remain below. |
| C5: Verification and source-bound review | 9.0 | Independent typecheck, source inspection, recorded production-build evidence and real-browser checks support this bounded acceptance. |
| **Equal-weight average** | **8.8** | `(9.0 + 9.0 + 9.0 + 8.0 + 9.0) / 5 = 8.8` |

**C6: UNVERIFIED — Task3 live integration.** No live API, synthetic PostgreSQL integration, authorization enforcement, conflict handling or release acceptance is established by this report. Production deployment remains a separate stage after integrated acceptance.

## Exact reviewed target

The target contains **37 files** under `apps/web`. The digest excludes files whose path contains a `node_modules` or `.next` component and excludes files named `tsconfig.tsbuildinfo`. It includes configuration files and `next-env.d.ts` alongside source.

Manifest digest (SHA-256):

`f049ccfd3c10978be16f54b472c0390d114cd97dcf39d2a019da8f5290048520`

The reviewer computed this value from the checkout during review using the exact method below, from the repository root. Each file is hashed as raw bytes. Entries are ordered by Python's sorted `Path` order. The compact JSON array uses sorted object keys and UTF-8 encoding; paths are repository-relative POSIX paths on this checkout.

```python
from pathlib import Path
import hashlib
import json

files = sorted(
    x for x in Path('apps/web').rglob('*')
    if x.is_file()
    and not any(n in ('node_modules', '.next') for n in x.parts)
    and x.name != 'tsconfig.tsbuildinfo'
)
entries = [
    {'path': str(x), 'sha256': hashlib.sha256(x.read_bytes()).hexdigest()}
    for x in files
]
digest = hashlib.sha256(
    json.dumps(entries, sort_keys=True, separators=(',', ':')).encode()
).hexdigest()
print(len(entries), digest)
```

This report binds to those reviewed bytes; later changes require a new target digest and appropriately scoped re-review.

## Source and verification evidence

Read `AGENTS.md`, `RULES.md`, `DESIGN.md`, and `docs/reviews/WEB-IMPLEMENTATION-20261028/criteria.json`. Inspected the route inventory and source for project/unavailable pages, settings, people, trash, app shell, sidebar, topbar, board projection, card target, add-card dialog, detail/discard dialogs, and runtime color tokens.

- Independently executed `npm run typecheck:web`: exit 0, TypeScript checking passed.
- Inspected `build.log` in this review directory: Next.js production compilation, type validity, static page generation and build tracing passed. The reviewer did not rerun a build over the running server. Build execution belongs to the builder/parent evidence, rather than an independent reviewer execution claim.
- Inspected `typecheck.log` as supporting recorded evidence; the independent typecheck above was also executed.
- Used a separate temporary in-app browser tab, leaving the user's tab untouched. Reset the temporary viewport override and closed the review tab on completion.

## Direct browser checks

1. Desktop combined preview shows its one-project scope and three source-board groups; switching to Developers Board navigates to `/boards/board_dev` and shows the three developer cards rather than other boards' cards.
2. Dark theme renders the main shell, cards and completed semantics; the residual contrast defects below were visible.
3. Add-card dialog starts with no priority. Entering a title and submitting without priority shows the specific validation message, retains the title and focuses Priority.
4. “Keep draft and close” returns focus to the Add card trigger.
5. At 390×844, the board stacks its columns and keeps visible board actions usable. After the navigation transition settles, the closed mobile sidebar is hidden.
6. Opening mobile navigation focuses its close button; the background becomes inert. Escape closes navigation and returns focus to its trigger. The source also implements the drawer's Tab wrap.
7. Board fullscreen enters and exits successfully at the narrow viewport. The fullscreen board contains the detail/discard portals.
8. Enter on a card opens its detail dialog in fullscreen. Editing its title then pressing Escape opens the nested discard confirmation.
9. “Keep editing” retains the unsaved edit and permits keyboard continuation within the detail dialog. Discarding the edit closes the dialog and returns focus to the original card target.

The parent separately reported its own post-rebuild checks of sign-in/invitation initial visible Tab targets and Save-preview focus return. Those reports informed task context but are not represented here as independently repeated browser checks.

## Nonblocking findings

- `apps/web/src/components/kanban-card.tsx`: the Low priority badge combines `bg-emerald-50` with `text-[var(--dot-completed)]`. In dark mode the latter becomes bright green (`#86e1a4`), leaving LOW weakly contrasted against its pale badge. This was visible on the combined board.
- `apps/web/src/components/board-view.tsx`: the In progress summary count retains `text-blue-600`, producing weak contrast on the dark summary surface. The progress column also retains the hardcoded `bg-[#dceefa]/40 border-sky-200` treatment rather than the theme's progress tokens, creating a conspicuously pale dark-mode surface. These are visual/accessibility refinements; the reviewed core actions remained usable.

These findings reduce C4 and should be addressed before a broader accessibility or polished dark-theme claim. They do not block the explicitly bounded Task2 preview acceptance.

## Limits and next boundary

This was a bounded source and real-browser acceptance check, not a complete screen-reader, reduced-motion, zoom, touch-device or cross-browser audit. Browser-session fixtures are not proof of server authorization or persistence. Unavailable comments, images, invitations, grants, restore and other server operations remain unavailable; the report does not promote them to implemented features.

Task3 must independently verify live integration against backend-reviewed endpoints with isolated synthetic PostgreSQL data, including pending, failure, permission and conflict behavior. No deployment claim is made.
