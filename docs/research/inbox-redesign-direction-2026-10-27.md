# Inbox redesign — direction and implementation research

Date: 27 October 2026. Status: research note for a **design artifact**, not product or backend acceptance. Sources are listed at the end; where a claim is our own choice rather than a cited finding, it says so.

The requested research subagent (Luna) could not run — the provider returned “insufficient account funds” — so this note was assembled directly from primary documentation and product help pages, and the measurements below were taken in the local Chromium artifact.

## The problem with the current surface

The Inbox is a personal notification list: mentions in comments, card assignments, import results, card restores, and invitation/access events. It is **not** a chat: there is no composer, no presence, no channel list and no conversation thread to reply into. A flat, newest-first stream of rows (and especially the chat-style reference with repeated “Hi @everyone” messages) fails in three specific ways:

1. **No decision structure.** Every row looks equally urgent, so the reader has to re-derive “what needs me?” on each visit.
2. **Duplication.** Several notifications about one card arrive as separate rows that repeat the same title and context.
3. **Weak anchors.** The card title — the thing the reader actually recognises — competes with project, board, actor and type labels.

## What mature inboxes do

**GitHub's notification inbox is thread-based, not message-based.** One row represents an issue or pull request *thread*, carrying the latest reason (`mention`, `assign`, `review-requested`, `comment`, `state-change`, `invitation`, and others), and can be grouped by repository or date. Triage verbs are explicit: **Done**, **Save**, **Unread**, **Read**, **Unsubscribe**. Filters are expressed as queries (`is:unread`, `reason:mention`, `repo:owner/name`). Source: GitHub Docs, *Managing notifications from your inbox* and *Inbox filters*.

That model is a better fit for Flowboard than a message stream, because a Flowboard notification is always *about* something durable — a card, an import, a project membership — not a message in a room.

**The documented critique of GitHub's redesign is instructive.** Drew DeVault's 2020 write-up argues the newer inbox got worse because the notification title stopped dominating, rows stopped being grouped by repository, and actions appeared only on hover across a wide row — so the eye lost its place. It also flags a trust problem: when the list is filtered to *unread*, marking something read makes the row disappear, which makes a mistake hard to undo. Sources: *GitHub's new notifications: a case of regressive design*; refined-github discussion #8203 on grouping/filter inconsistencies.

**A real triage app uses three columns.** The Canopy write-up (a native GitHub client) describes a split view: filter presets with live counts, a notification list grouped by repository, and a detail pane with CI status, review decisions and an activity timeline. Its own conclusion is relevant to us: “the whole point of triage is deciding which notifications need your attention without opening each” — which requires the list row to carry enough context, and the detail pane to carry the rest.

**Flowboard decision (ours):** thread rows + lane buckets + a reading pane. Threads remove duplication; lanes answer “what needs me”; the pane holds the card context that would otherwise bloat every row.

## Unread semantics and undo

- Opening a notification marks **that notification** read; it must not mark a whole card thread read. This is already a product rule in `docs/FEATURE_SPEC.md` §6 and the previous Inbox copy.
- Marking read is reversible. GitHub exposes both **Read** and **Unread** per row; we keep a per-thread toggle and a per-event toggle in the pane.
- **Bulk actions need undo.** Because a marked-read row can leave the current lane, we add an 8-second **Undo** on “Mark all read” and on lane-clearing actions. `Screens.toast()` already supports an `undo` callback, so this needs no new dependency.
- Self-mentions never notify, and removed project access hides or redacts the notification — both already in the spec; the artifact keeps the redaction copy rather than inventing delivery features.

## Row anatomy and density

Recommendation, stated first: **three text lines per row, title dominant, context on one meta line, one clamped quote.**

- Line 1: card key (mono, faint) + **card title** (strongest text in the row) + relative time (right-aligned).
- Line 2: actor + action (“Charlie mentioned you in a comment”) with a small type glyph at the leading edge.
- Line 3: the comment excerpt, clamped to one line, muted.
- Meta line: project · board · column, plus priority/due only when they change the decision (assignment rows).

Rationale: DeVault's critique is exactly about title/context hierarchy and scan path; keeping project/board on one trailing line stops the repeated context from competing with the title. We deliberately do **not** put four action buttons on every row — actions live in the pane and on the selected row.

## Reading pane versus inline expansion

A side pane wins when the list is a triage queue and the detail is rich (card facts + event history), which is our case. Canopy's three-column design is one example; GitHub's own inbox also offers a preview rather than expanding rows.

Constraints we accept:
- At **≥1180px** the list and pane sit side by side.
- Below that, the pane stacks under the list; selecting a row scrolls the pane into view and moves focus to its heading. This keeps narrow screens usable without a hidden-drawer interaction.
- The pane is a labelled region, not a dialog. It never traps focus, so a keyboard user can keep moving through the list while the pane updates.
- A visually hidden live region announces the selection and read-state changes, because the pane changes without focus moving.

## Keyboard model

Our choice (not a cited standard): a mail-triage map, advertised in a shortcuts dialog rather than hidden.

| Key | Action |
|---|---|
| `j` / `↓` | Next thread |
| `k` / `↑` | Previous thread |
| `Enter` | Open the selected card / target |
| `e` | Toggle read for the selected thread |
| `u` | Jump to the next unread thread |
| `/` | Focus search |
| `Esc` | Clear search, or return focus to the list |
| `?` | Shortcuts dialog |

Pitfalls handled: the handler ignores events from inputs, selects, textareas and contenteditable elements; it ignores `Alt`/`Ctrl`/`Meta` combinations so browser shortcuts still work; it does nothing while a dialog is open; and the list container is focusable (`tabindex="0"`) so PageUp/PageDown keep working natively.

## Motion that carries meaning

NN/g's guidance is unambiguous: most UI animation belongs in **100–500ms**, ~100ms for simple feedback, 200–300ms for substantial screen changes, and motion should communicate feedback and state change rather than entertain. It also calls out respecting `prefers-reduced-motion` as an accessibility requirement, not a nicety.

Inventory for the Inbox, with a reason for each:

| Motion | Purpose | Duration |
|---|---|---|
| Row entrance stagger | Shows “this is a new result set” after a filter change | 220ms, 24ms stagger |
| Row exit + neighbour reflow | Explains that a triaged item left the lane | 240ms |
| Reading-pane crossfade + 6px rise | Ties the pane to the selected row | 180ms |
| Count roll-up | Confirms the unread number changed | 240ms |
| Type-icon one-shot (check draw, mention pulse) | Confirms the specific action | 180ms |
| CSS hover/focus/active | Ordinary affordance | 120–180ms |

Rejected: parallax, perpetual ambient motion, animated gradients, hover-triggered movement on every row, and scroll-jacking the page. The board's own fixture comment already states the rule — *“keep the board's own scrolling native; smooth page scrolling should not fight drag and drop.”*

## Lenis: scoped, not global

Lenis 1.3.26 accepts `wrapper` and `content`, so it can smooth **one** scroll container. Two caveats from its documentation matter here:

- `allowNestedScroll` “can create performance issues since it checks the DOM tree on every scroll event”; we avoid it by not nesting scroll containers inside the stream.
- Smooth scrolling moves wheel handling to the main thread, so a long task pauses the scroll. That is acceptable for a bounded notification list and unacceptable for the board, which is why the board keeps native scrolling.
- `respectReducedMotion` defaults to `true` in this version: smoothing is disabled and `scrollTo` jumps. We additionally **destroy** the instance under reduced motion so no rAF loop remains.
- Lenis does not support CSS scroll snap, and sticky headers still work because it wraps native scroll rather than transforming content.

Implementation detail: keyboard selection calls `lenis.scrollTo(row, { offset })` when Lenis is active, and `row.scrollIntoView({ block: "nearest" })` when it is not — otherwise focus scrolling and smooth scroll fight each other.

## GSAP: one authored sequence, not decoration

ADR 0003 reserves GSAP for “a measured, complex sequence that CSS/Framer Motion handles poorly” and keeps routine hover/focus in CSS. The Inbox qualifies in exactly one place: **triage**, where an exit, a reflow, a counter and a pane swap must read as one event. Everything else stays CSS/WAAPI.

- List reflow uses a small **FLIP** helper (First, Last, Invert, Play) rather than the Flip plugin, to avoid vendoring another 30KB+ and to keep the mechanism inspectable: measure rects before, re-render, measure after, apply inverse transforms, then animate to zero.
- `gsap.matchMedia()` (or an equivalent media-query check) builds the timeline only when motion is allowed; the reduced-motion branch renders the final state immediately.
- Icon animation is a stroke-dash draw on the existing 24px icon set; no new asset pipeline.

## Performance and honesty

What we can measure locally, and what it does not prove:

- Bundle cost is measurable and small: GSAP core 72,435 bytes and Lenis 18,722 bytes, uncompressed, vendored locally.
- Frame cost of the triage sequence can be sampled in Chromium (`requestAnimationFrame` deltas, `PerformanceObserver` long tasks) and reported as a local observation.
- We **cannot** claim INP, production performance, mobile-device smoothness, or that any of this survives a real data load. A local prototype with six synthetic notifications says nothing about a 500-notification inbox. Production would need virtualisation, server paging and device measurements before these libraries earn their place.

## Anti-patterns we are removing or avoiding

- Chat-style composer, presence dots, “@everyone”, message grouping by author.
- Explainer panels that restate the product spec (“What appears here”, “Notification rules”) — the screen should show notifications, not describe them.
- Red badge inflation: one unread count in the nav, one in the page, one per lane, all derived from the same source.
- Hover-only row actions across a wide row.
- Rows that vanish on read with no undo.
- Motion on every hover; perpetual animation; scroll-jacking the page.

## Recommended structure for the Flowboard Inbox

**Regions**

1. **Head** — title, unread summary, “Next unread”, “Mark all read”, shortcuts.
2. **Triage bar** — lane tabs with thread counts (`All`, `Needs you`, `Updates`, `Access`), search with `/`.
3. **Stream** (left) — sticky lane headers; thread rows; empty states per lane.
4. **Reading pane** (right, stacked below 1180px) — type, title, provenance, primary action, card facts, event history, per-event read state, “why you're seeing this”.
5. **Foot** — one line: design evidence, actor-scoped, re-authorized on open.

**Thread model**

- Group notifications by card id. A thread's lane is `Needs you` if any event is unread and actionable (mention, assignment, comment reply), `Access` if it is an invitation/access event, otherwise `Updates`.
- Thread row shows the latest event, the unread event count, and the card title. The pane lists every event in the thread.
- Marking the thread read clears all its events; per-event toggles remain available in the pane.

**Motion inventory** — as tabled above; reduced motion removes all of it and keeps final states.

**Explicit non-goals** — no reply composer, no email/push delivery, no snooze, no server paging, no persistence beyond the session. Those are backend features, not design filler.

## Sources

- GitHub Docs — *Managing notifications from your inbox*: https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox
- GitHub Docs — *Inbox filters*: https://docs.github.com/en/subscriptions-and-notifications/reference/inbox-filters
- Drew DeVault — *GitHub's new notifications: a case of regressive design*: https://drewdevault.com/blog/GitHub-notifications/
- refined-github — *Notification page refactoring* (grouping and filter inconsistencies): https://github.com/refined-github/refined-github/issues/8203
- Sunday Swift — *Building Canopy: A Native GitHub Inbox and a Testbed for Lists*: https://sundayswift.com/posts/building-canopy/
- Lenis — repository and options table: https://github.com/darkroomengineering/lenis
- Lenis — custom scroll container discussion: https://github.com/darkroomengineering/lenis/discussions/383
- Motion/Lenis docs — reduced motion: https://motion.dev/docs/lenis
- NN/g — *Executing UX Animations: Duration and Motion Characteristics*: https://www.nngroup.com/articles/animation-duration/
- NN/g — *The Role of Animation and Motion in UX*: https://www.nngroup.com/articles/animation-purpose-ux/
- NN/g — *Animation for Attention and Comprehension*: https://www.nngroup.com/articles/animation-usability/
- Flowboard ADR 0003 — motion stack boundaries: `docs/decisions/0003-nextjs-frontend.md`
- Flowboard `docs/FEATURE_SPEC.md` §6 — comments, mentions, inbox ownership and redaction rules

Unverified or deliberately not claimed: Linear's exact inbox internals (not fetched), specific keyboard shortcuts in other products, any production performance number, and any claim that these libraries are required rather than chosen.
