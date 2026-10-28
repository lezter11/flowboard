# Projects reference analysis and UI direction

> Latest user decision (27 October 2026): boards have separate access, and cards may be combined only inside ONE project. Earlier inheritance or Owner-wide aggregation recommendations below are historical source/design context, superseded by [the revised board-access handoff](../handoffs/proposals/project-board-access-v2-2026-10-27.md). Existing backend source behavior is not acceptance of this new requirement.


Date: 2026-10-27  
Status: design recommendation for review; no UI implementation or API change.

## Recommendation

Make **Project → Boards** the primary, visible structure. A project is the container for related boards: for example, **My Fashion** contains **Web**, **Marketing**, and **Operations**. Use a calm pastel browse page with an **All projects** card grid and an **All boards** view for the Owner, plus an expandable project navigator and a focused project page that lists that project's boards. Treat “All” as the user's authorized scope: the Owner sees owned projects; everyone else sees only projects they own or have an explicit grant to.

Keep the overview visually light and scannable: a slim navigation rail; page title and short explanatory subtitle; search and an explicit Active / Archived control; project cards with name, optional description, and role/state; and clear board rows/cards under the selected project. Use pastel accents for grouping and selection against neutral surfaces, with text and icons carrying meaning. On a selected project, show its boards as direct, named destinations. Keep connector lines as a restrained optional visual aid or selected-project breadcrumb, not as the only way to understand or navigate the hierarchy.

For the Owner's two cross-project views, prefer ordinary cards and a list/table option as the default surfaces. An optional spatial map could be an exploratory view later, if real usage shows that relationships between projects and boards are hard to scan in lists. It should never become the only route to a project or board.

## Implemented direction (27 October 2026)

The user explicitly asked for the supplied connected-map and hierarchy references, so the implemented design departs from the earlier “list-first, map later” recommendation above. This is a design decision, not a usability finding.

- **Projects index:** default **Map** view where each project is a root panel (mark, name, description, card/open/overdue counts, completion meter, active/archived state, archive/reopen) connected to a vertical branch list of its authorized boards. Each branch carries a tone node, description, card/open counts, completion bar, access label and open link. **List** remains available as a compact alternate (`?view=list`), so the map is never the only route.
- **Project overview:** a connected board tree with tone nodes, per-board counts, completion, Owner-only avatars and access buttons. The aside holds an “At a glance” completion donut, Owner-only People board-reach bars, a non-owner “Your access” chip list, and an explicit project-access-versus-board-access rule.
- **Project work:** a single-project combined, read-only card view with a board branch strip, list and board layouts, search/stage/priority/sort, load more, URL state and a card preview that preserves project/board/column provenance. Switching projects changes scope; there is no all-projects aggregate.
- **Brand:** Palette 1 only. Thistle, petal, baby pink, icy blue and sky blue identify project/board nodes, meters and chips; plum remains the action/ink accent. No new palette was introduced. Project marks and tones are presentation, not API fields.
- **Roles:** Owner sees all boards in owned projects, can create projects and boards, edit one board's grants from project members only, and archive/reopen. Manager, Member and Viewer require the project grant plus each board grant; they never see a hidden board's name, ID, count, cards or people. The access editor and New board are Owner-only in this design.
- **Board creation:** Owner can create a board with a name, optional description and initial grants drawn from current project members. The Owner is locked in; other members are opt-in. Creating a project still creates no board, so a zero-board project is a supported state with a first-board prompt.

The earlier warning that a graph consumes space and needs an accessible alternative still applies: the List view, ordinary links, headings, keyboard focus and text labels are the accessible route. Connector lines are decorative and never carry meaning alone. The screens remain synthetic: no API, persistence, authorization, real search or migration is implemented or verified. Board/card counts and people reach are design projections that require the read models in [the revised handoff](../handoffs/proposals/project-board-access-v2-2026-10-27.md).

## Three reference images

| Reference | What is visible | Useful cue for Flowboard | Do not carry into Flowboard |
|---|---|---|---|
| 1. “Spend Map” | A root metric branches through category cards into individual model cards; thin curved connectors expose parent-child relationships; a detail card is emphasized. | A compact relationship map can make “this board belongs to this project” legible at a glance. A selected node can drive a neighboring detail panel. | Spend totals, forecasts, percentages, trends, token/cost controls, model/vendor categories, and claims that the connector graph is a live aggregate. Flowboard's project list response has no board/card totals or other summary metrics. |
| 2. Vertical workflow | A centered sequence of trigger, processing, condition, branches, and actions; connectors and plus controls show order and branching. | A simple top-to-bottom reading order and visible nesting/branch points can inspire how an expanded project reveals its boards. | Triggers, automated actions, AI extraction, accuracy/latency, run counts, health, branch percentages, and “add step” affordances. Flowboard Projects is not a workflow builder. |
| 3. Dark organization tree | A root person branches to a long ranked hierarchy of named people; small badges, counts, and bars decorate each node; a mini-map shows position in the large tree. | A focused node plus a side/detail view can help at scale. A compact overview map is a possible later aid when the collection is genuinely large. | Reporting lines, rank, personal names, group sizes, influence scores, leaderboards, decorative performance bars, and the dark high-density aesthetic. Project-to-board membership is a product relationship, not a staff hierarchy or ranking. |

All three images are user-supplied visual references. Their depicted business data and product functions are not Flowboard requirements.

## Layout and behavior proposal

### All projects

- Title: **Projects**. For the Owner, default to **All projects**; other users see their accessible projects without a misleading workspace-wide claim.
- Show Active and Archived as explicit filters/tabs only if archive visibility is confirmed for every relevant role. Do not show archived-by or archived-at metadata: those fields are not in the current project contract.
- Use a responsive card grid at wide sizes and a single-column card list on narrow screens. Each card contains project name, optional description, an access-role label where useful, and active/archived state. Do not show board/card/member counts, activity summaries, member avatars, or email unless a source contract and visibility decision support them.
- A card opens that project's overview. An overflow menu exposes only actions allowed to that role; archive/reopen is Owner-only and requires a clear consequence/confirmation.
- Search must communicate its scope. The list endpoint is cursor-paginated and has no search parameter, so local filtering of a loaded page must not imply a complete server search.

### Project overview and All boards

- Project overview has a clear project heading, editable description where authorized, and a named **Boards** section. Each board is a direct clickable destination. Use a short list by default; a card view can be an alternate where it improves recognition.
- The project navigator can expand/collapse to reveal child boards. On desktop it may sit in the left rail; on mobile, use a labeled drawer or a project-scoped board list. Keep the path visible (Projects / My Fashion / Web) so users can orient themselves when entering a board from an aggregate view.
- The Owner's **All boards** view can list boards grouped under their project heading, but it needs a board-list/summary contract or a confirmed source for the board-to-project records. Do not fabricate board totals or card-level rollups. Grouping is navigation, not a cross-project metric.
- On small screens, linearize the hierarchy into project sections and board links. A pan/zoom node map would make the primary task harder and should not be the mobile default.
- If the team later prototypes a spatial view, preserve the same board/project links, selection state, permission rules, and keyboard route as the list. Do not make zoom, color, or connector following necessary to discover content.

## Comparison and rationale

Established products use multiple practical ways to group work. Asana describes projects as task containers and portfolios as a separate cross-project grouping; this is evidence that grouping/roll-up is a distinct concept, not a reason to add portfolios to Flowboard. [Asana hierarchy](https://help.asana.com/s/article/asana-hierarchy) Linear offers workspace- and team-level project lists plus per-project overviews, showing that a broad index and a focused detail page can coexist. [Linear projects](https://linear.app/docs/projects) monday.com places boards within workspaces and folders, with optional subfolders, which shows how a tree can help organization but also add depth. [monday.com hierarchy](https://support.monday.com/hc/en-us/articles/7278527605906-Understanding-monday-com-s-structural-hierarchy) Trello similarly treats the Workspace as a board container and recommends using a board or several boards for a project. [Trello Workspaces](https://support.atlassian.com/trello/docs/what-are-trello-workspaces/)

For Flowboard's current contract, the existing semantic structure is only a project and its boards. Adding a new portfolio/program level would add an entity, permission rules, and aggregation questions before a need is established. Keep the hierarchy shallow. A card/list-first surface works with ordinary scrolling, browser links, and existing project data; a graph can communicate relationships quickly but tends to consume space and needs extra navigation and accessible alternatives. This is a design inference from the references and product patterns, not a measured Flowboard usability result.

## Accessibility and scale constraints

- Use real headings and links for project/board navigation. If the expandable navigator is implemented as an ARIA tree widget, implement its expected arrow-key open/close and parent/child navigation; otherwise use ordinary buttons and nested links rather than claiming tree semantics. [WAI-ARIA Tree View Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)
- Keep selection and hierarchy distinguishable without color alone; preserve a strong focus indicator and visible text labels. Provide click/tap and keyboard paths to every project and board.
- Make small icon controls easy to target. WCAG 2.2 AA sets a 24-by-24 CSS pixel minimum for pointer targets, subject to stated exceptions. [W3C Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- Prefer progressive disclosure (show projects, reveal their boards on request) and bounded list loading over rendering a sprawling graph. Measure with realistic project/board counts before introducing virtualization, search indexing, or a map. The current project API supports cursor pagination; it does not provide complete-project search or list summaries.
- Treat role visibility as data access, not a visual filter. Project access is explicit; under the revised requirement a non-owner also needs a separate board grant, while the Owner has implicit access to every board in owned projects. UI-hidden actions do not replace server authorization.

## Source-grounded limits and open product decisions

This direction is constrained by [the Projects backend readiness map](projects-ui-backend-readiness-2026-10-27.md): the list returns project identity/description/state/version/timestamps, not board counts, activity, archived actor/time, or invitation totals; current project prototypes use local fixture state; and broad backend independent review remains failed, so existing feature handoffs do not establish integration readiness. The project's board list may need a confirmed API route/response map before the **All boards** view is designed as live data.

Decisions still needed before detailed UI scope: whether the landing surface is cross-workspace or one-workspace; whether All boards is in this release and which role can see it; archive-tab visibility for granted roles; whether project cards stay limited to project fields or gain a separately reviewed summary contract; team-directory email visibility; whether creation ends on the new project, settings, or a first-board prompt. The backend currently creates a project without creating a board.

Evidence here is visual inspection of the three supplied screenshots, read-only source/contract review summarized in the readiness map, and official product/accessibility documentation. No UI was implemented and no browser, usability, API, performance, or hosted behavior was tested.
