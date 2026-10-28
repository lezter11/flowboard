/* One project workspace: Overview, board tabs and a read-only All boards view.
   Scoped records and local state come from Portfolio; this screen never calls the API. */
(function () {
  "use strict";

  const Portfolio = window.Portfolio;
  const Screens = window.Screens;
  const FB = window.FB;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = Screens.escape;
  const icon = Screens.icon;
  const initial = new URLSearchParams(location.search);
  const TONES = ["thistle", "petal", "pink", "icy", "sky", "slate"];
  const TONE_ALIASES = { lavender: "thistle", rose: "petal", blue: "icy", mint: "thistle", progress: "icy", completed: "thistle", gold: "sky", sage: "icy" };

  let projectId = initial.get("project")
    || (initial.get("board") && Portfolio.board(initial.get("board"))?.projectId)
    || "my-fashion";
  const work = {
    q: initial.get("q") || "",
    category: "",
    priority: "",
    sort: initial.get("sort") === "due" ? "due" : "title",
    view: initial.get("view") === "board" ? "board" : "list",
    limit: Math.max(20, Number(initial.get("limit")) || 20)
  };
  let current = null;
  let boardAccessDraft = null;
  let projectMembersDraft = null;
  let activeTab = "overview";
  let selectedBoardId = "";
  let openedCardId = "";
  let cardContext = "all";
  let pendingCardId = "";

  function toneOf(value) {
    if (TONES.includes(value)) return value;
    if (TONE_ALIASES[value]) return TONE_ALIASES[value];
    return "thistle";
  }
  function peopleById(ids) {
    return ids.map(id => Screens.people[id]).filter(Boolean);
  }
  function currentBoard() {
    if (!current) return null;
    return Portfolio.boards(current.id).find(board => board.id === selectedBoardId) || null;
  }
  function projectOverviewHref() {
    return Screens.screenHref("project", { project: current.id });
  }
  function boardHref(boardId) {
    return Portfolio.boardHref(boardId);
  }
  function allBoardsHref() {
    return Portfolio.workHref({ projectId: current.id });
  }
  function tabHref(tab) {
    if (tab === "overview") return projectOverviewHref();
    if (tab === "all") return allBoardsHref();
    return boardHref(tab);
  }
  function syncUrl(mode) {
    if (!current) return;
    const params = new URLSearchParams();
    if (Screens.role !== "owner") params.set("role", Screens.role);
    params.set("project", current.id);
    if (activeTab === "all") {
      params.set("tab", "all");
      if (work.q) params.set("q", work.q);
      if (work.category) params.set("stage", work.category);
      if (work.priority) params.set("priority", work.priority);
      if (work.sort !== "title") params.set("sort", work.sort);
      if (work.limit !== 20) params.set("limit", String(work.limit));
      if (work.view !== "list") params.set("view", work.view);
      if (openedCardId && cardContext === "all") params.set("card", openedCardId);
    } else if (activeTab !== "overview") {
      params.set("board", activeTab);
      if (openedCardId && cardContext === "board") params.set("card", openedCardId);
    }
    const url = "project.html?" + params.toString();
    history[mode === "push" ? "pushState" : "replaceState"](null, "", url);
  }
  function readStateFromUrl() {
    const params = new URLSearchParams(location.search);
    const projectParam = params.get("project");
    const boardParam = params.get("board");
    if (projectParam) projectId = projectParam;
    else if (boardParam) projectId = Portfolio.board(boardParam)?.projectId || projectId;
    if (boardParam) {
      activeTab = boardParam;
      selectedBoardId = boardParam;
    } else if (params.get("tab") === "all") {
      activeTab = "all";
      selectedBoardId = "";
    } else {
      activeTab = "overview";
      selectedBoardId = "";
    }
    work.q = params.get("q") || "";
    const stage = params.get("stage") || "";
    work.category = ["", "todo", "active", "done"].includes(stage) ? stage : "";
    const priority = params.get("priority") || "";
    work.priority = ["", "none", "low", "medium", "high", "urgent"].includes(priority) ? priority : "";
    work.sort = params.get("sort") === "due" ? "due" : "title";
    work.view = params.get("view") === "board" ? "board" : "list";
    work.limit = Math.max(20, Number(params.get("limit")) || 20);
    pendingCardId = params.get("card") || "";
  }
  function focusPanel() {
    requestAnimationFrame(() => {
      const id = activeTab === "overview" ? "overviewTitle" : activeTab === "all" ? "allBoardsTitle" : "boardViewTitle";
      const heading = document.getElementById(id);
      if (heading) heading.focus({ preventScroll: true });
    });
  }
  function navigate(tab, options) {
    const opts = options || {};
    if (!current) return;
    const same = tab === activeTab;
    closeCard({ skipUrl: true });
    closeBoardAccess();
    closeNewBoard();
    pendingCardId = "";
    activeTab = tab;
    selectedBoardId = tab === "overview" || tab === "all" ? "" : tab;
    const url = tabHref(tab);
    if (opts.push && !same) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
    render();
    focusPanel();
  }

  /* ---------- Shared project heading ---------- */
  function projectActions(archived) {
    const actions = [`<a class="btn" href="${esc(allBoardsHref())}" data-project-tab="all">${icon("columns")}All boards</a>`];
    /* Archived projects keep a single Reopen action in the banner. */
    if (Portfolio.canAggregate() && !archived) {
      actions.push(`<button class="btn ghost danger-ghost" type="button" data-project-action="archive">${icon("archive")}Archive</button>`);
    }
    return actions.join("");
  }
  function renderHeading() {
    const archived = current.status === "archived";
    const tone = toneOf(current.tone);
    const board = activeTab !== "overview" && activeTab !== "all" ? currentBoard() : null;
    const crumb = activeTab === "overview"
      ? "Overview"
      : activeTab === "all"
        ? "All boards"
        : board ? board.name : "Board unavailable";
    $("#projectRootNode").className = `project-root-node tone-${tone}`;
    $("#projectRootNode").setAttribute("aria-label", `${current.name} project`);
    $("#projectRootNode span").textContent = current.mark || current.name.slice(0, 2).toUpperCase();
    $("#projectTitle").textContent = current.name;
    $("#projectPathName").textContent = current.name;
    $("#projectListLink").href = Screens.screenHref("projects");
    $("#projectDescription").textContent = current.description || "No description added.";
    $("#projectDescription").hidden = !current.description;
    document.title = activeTab === "overview"
      ? `${current.name} — Project overview — Flowboard design prototype`
      : activeTab === "all"
        ? `All boards — ${current.name} — Flowboard design prototype`
        : board
          ? `${board.name} — ${current.name} — Flowboard design prototype`
          : `Board unavailable — ${current.name} — Flowboard design prototype`;
    Screens.setBreadcrumb([
      { label: "Projects", href: "projects.html" },
      { label: current.name, href: projectOverviewHref() },
      { label: crumb }
    ]);
    $("#projectActions").innerHTML = projectActions(archived);
  }
  function renderBanner() {
    const archived = current.status === "archived";
    const banner = $("#projectBanner");
    banner.hidden = !archived;
    banner.innerHTML = archived
      ? `<div class="project-archive-banner"><span class="archive-symbol" aria-hidden="true">${icon("archive")}</span><p><strong>This project is archived.</strong> Its boards are read-only. Data is retained, and deleted-card restore deadlines continue.</p>${Portfolio.canAggregate() ? `<button class="btn soft" type="button" data-project-action="reopen">Reopen project</button>` : `<span class="archive-help">Only the Owner can reopen it.</span>`}</div>`
      : "";
  }
  function renderSwitcher() {
    const boards = Portfolio.boards(current.id);
    const stats = Portfolio.projectStats(current.id);
    const items = [
      `<a class="project-tab${activeTab === "overview" ? " is-active" : ""}" href="${esc(projectOverviewHref())}" data-project-tab="overview"${activeTab === "overview" ? ' aria-current="page"' : ""}>${icon("folder")}<span class="project-tab-label">Overview</span></a>`
    ];
    boards.forEach(board => {
      const boardStats = Portfolio.boardStats(board.id);
      const active = activeTab === board.id;
      items.push(`<a class="project-tab tone-${toneOf(board.tone)}${active ? " is-active" : ""}" href="${esc(boardHref(board.id))}" data-project-tab="${esc(board.id)}"${active ? ' aria-current="page"' : ""}>
        <i class="project-tab-dot" aria-hidden="true"></i>
        <span class="project-tab-label">${esc(board.name)}</span>
        <span class="project-tab-count">${boardStats.total}</span>
      </a>`);
    });
    items.push(`<a class="project-tab project-tab-all${activeTab === "all" ? " is-active" : ""}" href="${esc(allBoardsHref())}" data-project-tab="all"${activeTab === "all" ? ' aria-current="page"' : ""}>
      ${icon("columns")}
      <span class="project-tab-label">All boards</span>
      <span class="project-tab-count">${stats.total}</span>
    </a>`);
    $("#projectSwitcher").innerHTML = items.join("");
    requestAnimationFrame(() => {
      const active = $("#projectSwitcher [aria-current='page']");
      if (active) active.scrollIntoView({ block: "nearest", inline: "center" });
    });
  }

  /* ---------- Overview ---------- */
  function boardPeople(board) {
    if (!Portfolio.canAggregate()) return "";
    const people = peopleById(Portfolio.boardMembers(board.id));
    if (!people.length) return "";
    const shown = people.slice(0, 3).map(person => Screens.avatar(person.id)).join("");
    const rest = people.length - 3;
    return `<span class="ph-board-people" role="img" aria-label="${people.length} ${people.length === 1 ? "person has" : "people have"} access">${shown}${rest > 0 ? `<span class="ph-board-people-more" aria-hidden="true">+${rest}</span>` : ""}<span class="ph-board-people-label">${people.length}</span></span>`;
  }
  function boardItem(board) {
    const archived = current.status === "archived" || board.status === "archived";
    const href = boardHref(board.id);
    const stats = Portfolio.boardStats(board.id);
    const tone = toneOf(board.tone);
    const pills = [
      `<span class="ph-board-pill">${stats.total} ${stats.total === 1 ? "card" : "cards"}</span>`,
      `<span class="ph-board-pill">${stats.open} open</span>`,
      stats.overdue ? `<span class="ph-board-pill is-overdue">${stats.overdue} overdue</span>` : ""
    ].join("");
    return `<li class="ph-board-item tone-${tone} ${archived ? "is-readonly" : ""}" data-board-id="${esc(board.id)}">
      <span class="ph-board-node" aria-hidden="true">${icon("board")}</span>
      <div class="ph-board-copy">
        <div class="ph-board-title"><h3><a href="${esc(href)}" data-project-tab="${esc(board.id)}">${esc(board.name)}</a></h3>${pills}</div>
        <p>${esc(board.description || "No description added.")}</p>
        <div class="ph-board-progress">
          <span class="ph-board-progress-bar" role="img" aria-label="${stats.done} of ${stats.total} cards completed"><i style="width:${stats.percent}%"></i></span>
          <span>${stats.total ? `${stats.percent}% complete` : "No cards yet"}</span>
        </div>
      </div>
      <div class="ph-board-side">
        ${boardPeople(board)}
        ${Portfolio.canAggregate() && !archived ? `<button class="ph-board-access" type="button" data-board-access="${esc(board.id)}" aria-label="Manage access for ${esc(board.name)}">${icon("lock")}<span>Access</span></button>` : ""}
        <a class="ph-board-open" href="${esc(href)}" data-project-tab="${esc(board.id)}" aria-label="Open ${esc(board.name)} board">${icon("arrow-right")}</a>
      </div>
    </li>`;
  }
  function renderBoards() {
    const boards = Portfolio.boards(current.id);
    const archived = current.status === "archived";
    $("#boardsCount").textContent = boards.length;
    $("#boardsSummary").textContent = boards.length
      ? `${boards.length} ${boards.length === 1 ? "board" : "boards"} available · Each board keeps its own columns, cards and access.`
      : "This project has no boards in scope for the current preview identity.";
    $("#boardsFootNote").textContent = archived
      ? "Archived projects are read-only until the Owner reopens them."
      : Portfolio.canAggregate()
        ? "Owner access covers every board. Everyone else needs a grant per board."
        : "Only boards you can open appear here. Project membership alone does not reveal a board.";
    ["allBoardsLink", "boardsWorkLink", "glanceWorkLink", "allWorkLink"].forEach(id => {
      const node = document.getElementById(id);
      if (!node) return;
      node.href = allBoardsHref();
      node.dataset.projectTab = "all";
    });
    $("#newBoardBtn").hidden = !Portfolio.canAggregate() || archived;
    const panel = $("#boardsPanel");
    if (!boards.length) {
      const isOwner = Portfolio.canAggregate();
      const title = isOwner ? "No boards in this project" : "No boards available";
      const copy = isOwner
        ? archived ? "This archived project has no boards in the local preview." : "A project can exist before its first board. Create the first team board to start separating work and access."
        : "This preview identity has no board grants for this project, or the project has no boards. Boards without a grant stay hidden from this list.";
      panel.innerHTML = `<div class="ph-board-empty"><span class="ph-board-empty-icon" aria-hidden="true">${icon("board")}</span><div><h3>${title}</h3><p>${copy}</p>${isOwner && !archived ? `<button class="btn primary" type="button" data-new-board>${icon("plus")}Create the first board</button>` : ""}</div></div>`;
      return;
    }
    panel.innerHTML = `<ul class="ph-board-list" aria-label="Boards in ${esc(current.name)}">${boards.map(boardItem).join("")}</ul>`;
  }
  function renderAside() {
    const stats = Portfolio.projectStats(current.id);
    const boards = Portfolio.boards(current.id);
    const archived = current.status === "archived";
    const donut = $("#glanceDonut");
    donut.style.setProperty("--pct", String(stats.percent));
    donut.setAttribute("aria-label", `${stats.percent}% of cards completed`);
    $("#glancePercent").textContent = `${stats.percent}%`;
    $("#glanceOpen").textContent = stats.open;
    $("#glanceDone").textContent = stats.done;
    $("#glanceOverdue").textContent = stats.overdue;
    $("#glanceTotal").textContent = stats.total;
    $("#glanceBoards").textContent = `${boards.length} ${boards.length === 1 ? "board" : "boards"}`;
    $("#glanceScope").textContent = archived ? "Archived · read-only" : "Read-only previews";
    $("#glanceSub").textContent = boards.length ? "Across the boards you can open" : "No boards in scope yet";
    $("#glanceWorkLink").href = allBoardsHref();
    $("#glanceWorkLink").dataset.projectTab = "all";

    const peopleCard = $("#peopleCard");
    const myCard = $("#myAccessCard");
    if (Portfolio.canAggregate()) {
      peopleCard.hidden = false;
      $("#manageProjectMembers").hidden = current.status === "archived";
      myCard.hidden = true;
      $("#myAccessList").replaceChildren();
      const people = Portfolio.projectPeople(current.id);
      $("#peopleList").innerHTML = people.length ? people.map(person => {
        const owner = person.id === current.ownerId;
        return `<div class="people-row">
          ${Screens.avatar(person.id)}
          <div class="people-copy"><strong>${esc(person.name)}</strong><span>${owner ? "Owner · every board" : esc(person.role)}</span></div>
          <div class="people-reach">
            <span class="people-bar" role="img" aria-label="${person.boardCount} of ${person.boardTotal} boards"><i style="width:${person.percent}%"></i></span>
            <span>${owner ? "All boards" : `${person.boardCount}/${person.boardTotal} boards`}</span>
          </div>
        </div>`;
      }).join("") : `<p class="board-access-empty">No project members to show.</p>`;
    } else {
      peopleCard.hidden = true;
      $("#manageProjectMembers").hidden = true;
      $("#peopleList").replaceChildren();
      myCard.hidden = false;
      const access = Portfolio.myAccess(current.id);
      $("#myAccessList").innerHTML = boards.length
        ? boards.map(board => `<span class="my-access-chip tone-${toneOf(board.tone)}"><i aria-hidden="true"></i>${esc(board.name)}</span>`).join("")
        : `<p class="board-access-empty">No board grants in this project.</p>`;
      $("#myAccessCount").textContent = `${access.boards} ${access.boards === 1 ? "board" : "boards"}`;
    }
  }
  function renderOverview() {
    renderBoards();
    renderAside();
  }

  /* ---------- Board tab ---------- */
  function dateLabel(card) {
    if (!card.due) return "No due date";
    if (card.category === "done") return `Completed · ${Screens.formatDate(card.due)}`;
    const days = FB.helpers.daysUntil(card.due);
    return `${days < 0 ? "Overdue · " : days === 0 ? "Today · " : "Due "}${Screens.formatDate(card.due)}`;
  }
  function priorityLabel(card) {
    return card.priority && card.priority !== "none"
      ? card.priority[0].toUpperCase() + card.priority.slice(1)
      : "No priority";
  }
  function boardCardHTML(card) {
    const tone = toneOf(card.boardTone);
    const assignee = card.assignees.map(id => Screens.people[id]).filter(Boolean)[0];
    const overdue = card.due && card.category !== "done" && FB.helpers.daysUntil(card.due) < 0;
    return `<article class="board-card tone-${tone}" data-work-card="${esc(card.id)}">
      <span class="board-card-tone" aria-hidden="true"></span>
      <div class="board-card-main">
        <button class="board-card-title" type="button" data-work-card="${esc(card.id)}">${esc(card.title)}</button>
        <span class="work-key">${esc(card.key)}</span>
      </div>
      <div class="board-card-meta">
        <span class="work-priority priority-${esc(card.priority || "none")}">${esc(priorityLabel(card))}</span>
        <span class="work-date${overdue ? " is-overdue" : ""}">${esc(dateLabel(card))}</span>
        ${assignee ? Screens.avatar(assignee.id) : `<span class="work-assignee-empty" aria-hidden="true">—</span>`}
      </div>
    </article>`;
  }
  function boardUnavailableHTML() {
    const hasBoards = Portfolio.boards(current.id).length > 0;
    return `<div class="board-unavailable">
      <span class="board-unavailable-icon" aria-hidden="true">${icon("lock")}</span>
      <div>
        <h2 id="boardViewTitle" tabindex="-1">Board unavailable</h2>
        <p>${hasBoards
          ? "This board is not available to the current preview identity. Choose an authorized board from the switcher or return to the project overview."
          : "This project has no boards in scope for the current preview identity. Return to the overview to review access or create the first board."}</p>
        <a class="btn" href="${esc(projectOverviewHref())}" data-project-tab="overview">Project overview</a>
      </div>
    </div>`;
  }
  function renderBoardPanel() {
    const mount = $("#boardView");
    const board = currentBoard();
    if (!board) {
      mount.innerHTML = boardUnavailableHTML();
      return;
    }
    const archived = current.status === "archived" || board.status === "archived";
    const stats = Portfolio.boardStats(board.id);
    const cards = Portfolio.cards({ projectId: current.id, boardId: board.id, includeArchived: current.status === "archived" });
    const columns = Portfolio.columns(board.id);
    const actions = [];
    if (Portfolio.canAggregate() && !archived) {
      actions.push(`<button class="btn" type="button" data-board-access="${esc(board.id)}">${icon("lock")}Access</button>`);
    }
    actions.push(`<a class="btn" href="${esc(allBoardsHref())}" data-project-tab="all">${icon("columns")}All boards</a>`);
    if (board.id === "board_website" && !archived) {
      actions.push(`<a class="btn primary" href="${esc(Screens.link("../index.html"))}">${icon("board")}Open approved board</a>`);
    }
    const note = archived
      ? "This board is read-only because the project is archived. Reopen the project from Overview to edit it."
      : board.id === "board_website"
        ? "Read-only board preview. The approved board is the editable card experience."
        : "Read-only board preview. These synthetic boards do not have an editable screen; the approved board shows the card-editing direction.";
    const groups = columns.map((column, index) => {
      const rows = cards.filter(card => card.columnId === column.id);
      return `<section class="board-column tone-${toneOf(board.tone)}" data-category="${esc(column.category)}" aria-labelledby="board-column-${index}">
        <header class="board-column-head"><h3 id="board-column-${index}">${esc(column.name)}</h3><span>${rows.length}</span></header>
        <div class="board-column-cards">${rows.map(boardCardHTML).join("") || `<p class="board-column-empty">No cards in this column.</p>`}</div>
      </section>`;
    }).join("");
    mount.innerHTML = `<div class="board-view">
      <div class="board-view-head">
        <div class="board-view-identity">
          <span class="board-view-node tone-${toneOf(board.tone)}" aria-hidden="true">${icon("board")}</span>
          <div class="board-view-copy">
            <p class="work-eyebrow">Board · ${esc(current.name)}</p>
            <h2 id="boardViewTitle" tabindex="-1">${esc(board.name)}</h2>
            <p>${esc(board.description || "No description added.")}</p>
          </div>
        </div>
        <div class="page-actions board-view-actions">${actions.join("")}</div>
      </div>
      <div class="board-view-stats" aria-label="Board totals">
        <span><strong>${stats.total}</strong>cards</span>
        <span><strong>${stats.open}</strong>open</span>
        <span><strong>${stats.done}</strong>completed</span>
        <span class="${stats.overdue ? "is-overdue" : ""}"><strong>${stats.overdue}</strong>overdue</span>
        <span class="board-view-meter" role="img" aria-label="${stats.done} of ${stats.total} cards completed"><i style="width:${stats.percent}%"></i></span>
      </div>
      <p class="board-view-note"><svg class="icon" aria-hidden="true"><use href="#i-info"></use></svg><span>${note}</span></p>
      ${groups
        ? `<div class="board-columns" style="--board-columns:${Math.max(columns.length, 1)}">${groups}</div>`
        : `<div class="board-empty"><span aria-hidden="true">${icon("board")}</span><h3>No columns or cards yet</h3><p>This board has no cards in the local preview. Open All boards to see the rest of the project, or return to Overview to review its access.</p><a class="btn" href="${esc(allBoardsHref())}" data-project-tab="all">All boards</a></div>`}
    </div>`;
  }

  /* ---------- All boards ---------- */
  function scopeCards(filters) {
    if (!current) return [];
    return Portfolio.cards({
      projectId: current.id,
      includeArchived: current.status === "archived",
      ...(filters || {})
    });
  }
  function scopeStats() {
    const list = scopeCards();
    const done = list.filter(card => card.category === "done").length;
    return {
      total: list.length,
      open: list.length - done,
      done,
      overdue: list.filter(card => card.category !== "done" && card.due && FB.helpers.daysUntil(card.due) < 0).length
    };
  }
  function renderWorkScope() {
    const stats = scopeStats();
    $("#workTotals").innerHTML = `<span><strong>${stats.total}</strong>cards</span><span><strong>${stats.open}</strong>open</span><span><strong>${stats.done}</strong>completed</span><span class="${stats.overdue ? "is-overdue" : ""}"><strong>${stats.overdue}</strong>overdue</span>`;
  }
  function workCardHTML(card) {
    const tone = toneOf(card.boardTone);
    const assignee = card.assignees.map(id => Screens.people[id]).filter(Boolean)[0];
    const overdue = card.due && card.category !== "done" && FB.helpers.daysUntil(card.due) < 0;
    return `<article class="work-card tone-${tone}" data-work-card="${esc(card.id)}">
      <span class="work-card-tone" aria-hidden="true"></span>
      <div class="work-card-main">
        <button class="work-card-title" type="button" data-work-card="${esc(card.id)}">${esc(card.title)}</button>
        <p class="work-key">${esc(card.key)}</p>
      </div>
      <div class="work-origin">
        <span class="work-board-chip"><i aria-hidden="true"></i>${esc(card.boardName)}</span>
        <span class="work-column">${esc(card.columnName)}</span>
      </div>
      <span class="work-priority priority-${esc(card.priority || "none")}">${esc(priorityLabel(card))}</span>
      <span class="work-date${overdue ? " is-overdue" : ""}">${esc(dateLabel(card))}</span>
      <span class="work-assignee">${assignee ? Screens.avatar(assignee.id) : `<span class="work-assignee-empty" aria-hidden="true">—</span>`}</span>
    </article>`;
  }
  function renderWorkControls() {
    $("#workSearch").value = work.q;
    $("#workStage").value = work.category;
    $("#workPriority").value = work.priority;
    $("#workSort").value = work.sort;
    $$("[data-work-view]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.workView === work.view)));
  }
  function renderAllBoards() {
    renderWorkScope();
    const matching = scopeCards({ q: work.q, category: work.category, priority: work.priority });
    matching.sort((a, b) => work.sort === "due"
      ? (a.due || "9999").localeCompare(b.due || "9999") || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
      : a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    const visible = matching.slice(0, work.limit);
    const all = scopeCards();
    const boards = Portfolio.boards(current.id);
    $("#workResultStatus").textContent = `${visible.length} shown · ${matching.length} matching ${matching.length === 1 ? "card" : "cards"}${matching.length !== all.length ? ` · ${all.length} in this project` : ""}`;
    renderWorkControls();
    $("#workLoadMore").hidden = matching.length <= work.limit;
    if (!matching.length) {
      const title = !boards.length ? "No boards in scope" : all.length ? "No cards match" : "No cards in this project";
      const copy = !boards.length
        ? "This project has no boards you can open. Return to Overview to review access or create the first board."
        : all.length
          ? "Try a different search, stage or priority, or clear the filters."
          : "This project has no cards in the local preview. Open a board tab to review its layout.";
      $("#workResults").innerHTML = `<div class="work-empty"><h2>${title}</h2><p>${copy}</p>${all.length ? `<button class="btn" type="button" id="workEmptyReset">Clear filters</button>` : `<a class="btn" href="${esc(projectOverviewHref())}" data-project-tab="overview">Project overview</a>`}</div>`;
      const reset = $("#workEmptyReset");
      if (reset) reset.addEventListener("click", resetFilters);
    } else if (work.view === "board") {
      const groups = [
        { id: "todo", label: "To do" },
        { id: "active", label: "In progress" },
        { id: "done", label: "Completed" }
      ];
      $("#workResults").innerHTML = `<div class="work-stage-board" style="--work-columns:${groups.length}">${groups.map(group => {
        const rows = visible.filter(card => card.category === group.id);
        return `<section class="work-stage" data-category="${esc(group.id)}" aria-label="${esc(group.label)}">
          <h2>${esc(group.label)}<span>${rows.length} shown</span></h2>
          ${rows.map(workCardHTML).join("") || `<p class="work-stage-empty">No cards shown in this stage.</p>`}
        </section>`;
      }).join("")}</div>`;
    } else {
      $("#workResults").innerHTML = `<div class="work-list">${visible.map(workCardHTML).join("")}</div>`;
    }
    if (!pendingCardId) syncUrl("replace");
  }
  function resetFilters() {
    work.q = "";
    work.category = "";
    work.priority = "";
    work.sort = "title";
    work.limit = 20;
    renderAllBoards();
    $("#workSearch").focus();
  }

  /* ---------- Card preview ---------- */
  function openCard(id, context) {
    if (!current) return;
    const list = Portfolio.cards({
      projectId: current.id,
      boardId: context === "board" ? selectedBoardId : undefined,
      includeArchived: current.status === "archived"
    });
    const card = list.find(item => item.id === id || item.key === id);
    if (!card) {
      if (activeTab === "all") $("#workResultStatus").textContent = "This card is unavailable in the selected scope.";
      return;
    }
    openedCardId = card.id;
    cardContext = context;
    $("#workCardSource").textContent = `${card.projectName} / ${card.boardName} / ${card.columnName}`;
    $("#workCardTitle").textContent = card.title;
    $("#workCardSignals").innerHTML = `<span class="work-priority priority-${esc(card.priority || "none")}">${esc(priorityLabel(card))}</span><span class="work-key">${esc(card.key)}</span><span class="work-date${card.due && card.category !== "done" && FB.helpers.daysUntil(card.due) < 0 ? " is-overdue" : ""}">${esc(dateLabel(card))}</span>`;
    const source = $("#workSourceBoard");
    source.href = boardHref(card.boardId);
    source.hidden = context === "board";
    const editable = card.boardId === "board_website" && current.status !== "archived" && Portfolio.board(card.boardId)?.status !== "archived";
    const original = $("#workOriginalCard");
    original.hidden = !editable;
    if (editable) {
      const base = Screens.link("../index.html");
      original.href = `${base}${base.includes("?") ? "&" : "?"}card=${encodeURIComponent(card.id)}`;
    }
    Screens.openDialog("workCardLayer", document.activeElement);
    syncUrl("replace");
  }
  function closeCard(options) {
    const opts = options || {};
    if (!openedCardId) return;
    openedCardId = "";
    Screens.closeDialog("workCardLayer");
    $("#workCardSource").textContent = "";
    $("#workCardTitle").textContent = "";
    $("#workCardSignals").replaceChildren();
    $("#workSourceBoard").removeAttribute("href");
    $("#workSourceBoard").hidden = false;
    $("#workOriginalCard").removeAttribute("href");
    $("#workOriginalCard").hidden = true;
    if (!opts.skipUrl) syncUrl("replace");
  }
  function openPendingCard() {
    if (!pendingCardId) return;
    const id = pendingCardId;
    pendingCardId = "";
    if (activeTab === "all") openCard(id, "all");
    else if (activeTab !== "overview") openCard(id, "board");
    else syncUrl("replace");
  }

  /* ---------- Board access dialog ---------- */
  function memberRecord(value) {
    const id = typeof value === "string" ? value : value && (value.id || value.personId || value.userId);
    if (!id) return null;
    const person = Screens.people[id] || (value && (value.person || value.user)) || (typeof value === "object" ? value : {});
    return {
      id: String(id),
      name: String((value && value.name) || person.name || person.displayName || id),
      role: String((value && value.role) || person.role || "Project member")
    };
  }
  function renderBoardAccess() {
    if (!boardAccessDraft || !current) return;
    const board = Portfolio.boards(current.id).find(item => item.id === boardAccessDraft.boardId);
    if (!board) return;
    const ownerId = String(current.ownerId);
    const people = Portfolio.availableMembers(current.id).map(memberRecord).filter(Boolean);
    if (!people.some(person => person.id === ownerId)) {
      const owner = memberRecord(ownerId);
      if (owner) people.unshift(owner);
    }
    const unique = [...new Map(people.map(person => [person.id, person])).values()];
    const focusIndex = unique.findIndex(person => person.id !== ownerId);
    if (!boardAccessDraft.draft.has(ownerId)) boardAccessDraft.draft.add(ownerId);
    $("#boardAccessTitle").textContent = `Access for ${board.name}`;
    $("#boardAccessSubtitle").textContent = `Choose which project members can open ${board.name}.`;
    const container = $("#boardAccessMembers");
    container.innerHTML = unique.length ? unique.map((person, index) => {
      const isOwner = person.id === ownerId;
      const checked = isOwner || boardAccessDraft.draft.has(person.id);
      return `<label class="board-access-member ${isOwner ? "is-owner" : ""}" for="board-access-${index}">
        <input id="board-access-${index}" type="checkbox" data-board-member="${esc(person.id)}" ${checked ? "checked" : ""} ${isOwner ? "disabled" : ""} ${index === focusIndex ? "data-autofocus" : ""} />
        <span class="board-access-person"><strong>${esc(person.name)}</strong><span>${isOwner ? "Owner · always has access" : esc(person.role)}</span></span>
      </label>`;
    }).join("") : `<p class="board-access-empty">No current project members are available to grant.</p>`;
    $("#boardAccessError").hidden = true;
    $("#boardAccessError").textContent = "";
  }
  function openBoardAccess(boardId) {
    if (!Portfolio.canAggregate() || !current || current.status === "archived") return;
    const board = Portfolio.boards(current.id).find(item => item.id === boardId);
    if (!board) return;
    const selected = new Set(Portfolio.boardMembers(boardId).map(value => typeof value === "string" ? value : value && (value.id || value.personId || value.userId)).filter(Boolean).map(String));
    selected.add(String(current.ownerId));
    boardAccessDraft = { boardId, draft: new Set(selected) };
    renderBoardAccess();
    Screens.openDialog("boardAccessLayer", document.activeElement);
  }
  function closeBoardAccess() {
    boardAccessDraft = null;
    Screens.closeDialog("boardAccessLayer");
    $("#boardAccessMembers").replaceChildren();
    $("#boardAccessTitle").textContent = "";
    $("#boardAccessSubtitle").textContent = "";
    $("#boardAccessError").textContent = "";
    $("#boardAccessError").hidden = true;
  }
  function saveBoardAccess() {
    if (!boardAccessDraft || !Portfolio.canAggregate()) return;
    const ownerId = String(current.ownerId);
    const next = new Set(boardAccessDraft.draft);
    next.add(ownerId);
    const boardId = boardAccessDraft.boardId;
    const saved = Portfolio.setBoardMembers(boardId, [...next]);
    if (!saved) {
      $("#boardAccessError").textContent = "Access could not be saved. Check browser storage and selected project members, then try again.";
      $("#boardAccessError").hidden = false;
      return;
    }
    const board = Portfolio.boards(current.id).find(item => item.id === boardId);
    closeBoardAccess();
    render();
    const trigger = document.querySelector(`[data-board-access="${boardId}"]`);
    if (trigger) trigger.focus();
    Screens.toast(`Access updated for ${board ? board.name : "board"} in this local preview.`, { tone: "success", icon: "lock" });
  }

  /* ---------- Project membership dialog ---------- */
  function renderProjectMembers() {
    if (!projectMembersDraft || !current) return;
    const people = Portfolio.candidateMembers(current.id).map(memberRecord).filter(Boolean);
    const ownerId = String(current.ownerId);
    if (!people.some(person => person.id === ownerId)) people.unshift(memberRecord(ownerId));
    const unique = [...new Map(people.filter(Boolean).map(person => [person.id, person])).values()];
    const focusIndex = unique.findIndex(person => person.id !== ownerId);
    $("#projectMembersSubtitle").textContent = `Choose who belongs to ${current.name}.`;
    $("#projectMembersList").innerHTML = unique.map((person, index) => {
      const isOwner = person.id === ownerId;
      const checked = isOwner || projectMembersDraft.has(person.id);
      return `<label class="board-access-member ${isOwner ? "is-owner" : ""}" for="project-member-${index}">
        <input id="project-member-${index}" type="checkbox" data-project-member="${esc(person.id)}" ${checked ? "checked" : ""} ${isOwner ? "disabled" : ""} ${index === focusIndex ? "data-autofocus" : ""} />
        <span class="board-access-person"><strong>${esc(person.name)}</strong><span>${isOwner ? "Owner · always belongs" : esc(person.role)}</span></span>
      </label>`;
    }).join("");
    $("#projectMembersError").hidden = true;
    $("#projectMembersError").textContent = "";
  }
  function openProjectMembers() {
    if (!Portfolio.canAggregate() || !current || current.status === "archived") return;
    projectMembersDraft = new Set(current.memberIds || []);
    renderProjectMembers();
    Screens.openDialog("projectMembersLayer", document.activeElement);
  }
  function closeProjectMembers() {
    projectMembersDraft = null;
    Screens.closeDialog("projectMembersLayer");
    $("#projectMembersList").replaceChildren();
    $("#projectMembersError").textContent = "";
    $("#projectMembersError").hidden = true;
  }
  function saveProjectMembers() {
    if (!projectMembersDraft || !Portfolio.canAggregate()) return;
    const saved = Portfolio.setProjectMembers(current.id, [...projectMembersDraft]);
    if (!saved) {
      $("#projectMembersError").textContent = "Members could not be saved in this preview. Your selections are still here; try again or cancel.";
      $("#projectMembersError").hidden = false;
      return;
    }
    current = Portfolio.project(projectId);
    closeProjectMembers();
    render();
    const trigger = $("#manageProjectMembers");
    if (trigger) trigger.focus();
    Screens.toast("Project membership updated in this local preview. Board access remains separate.", { tone: "success", icon: "people" });
  }

  /* ---------- New board dialog ---------- */
  function renderNewBoardMembers() {
    const ownerId = String(current.ownerId);
    const people = Portfolio.availableMembers(current.id).map(memberRecord).filter(Boolean);
    const unique = [...new Map(people.map(person => [person.id, person])).values()];
    const focusIndex = unique.findIndex(person => person.id !== ownerId);
    $("#newBoardMembers").innerHTML = unique.length ? unique.map((person, index) => {
      const isOwner = person.id === ownerId;
      return `<label class="board-access-member ${isOwner ? "is-owner" : ""}" for="new-board-member-${index}">
        <input id="new-board-member-${index}" type="checkbox" data-new-board-member="${esc(person.id)}" ${isOwner ? "checked" : ""} ${isOwner ? "disabled" : ""} ${index === focusIndex ? "data-autofocus" : ""} />
        <span class="board-access-person"><strong>${esc(person.name)}</strong><span>${isOwner ? "Owner · always has access" : esc(person.role)}</span></span>
      </label>`;
    }).join("") : `<p class="board-access-empty">No current project members are available.</p>`;
  }
  function openNewBoard() {
    if (!Portfolio.canAggregate() || !current || current.status === "archived") return;
    const form = $("#newBoardForm");
    form.reset();
    $("#newBoardNameError").hidden = true;
    $("#newBoardName").classList.remove("is-invalid");
    $("#newBoardName").removeAttribute("aria-invalid");
    renderNewBoardMembers();
    Screens.openDialog("newBoardLayer", document.activeElement);
  }
  function closeNewBoard() {
    Screens.closeDialog("newBoardLayer");
    $("#newBoardMembers").replaceChildren();
    $("#newBoardName").value = "";
    $("#newBoardDescription").value = "";
    $("#newBoardNameError").textContent = "";
    $("#newBoardNameError").hidden = true;
  }
  function createBoard(event) {
    event.preventDefault();
    if (!Portfolio.canAggregate() || !current) return;
    const input = $("#newBoardName");
    const error = $("#newBoardNameError");
    const name = input.value.trim();
    const description = $("#newBoardDescription").value.trim();
    const memberIds = $$("[data-new-board-member]:checked").map(node => node.dataset.newBoardMember);
    error.hidden = true;
    input.classList.remove("is-invalid");
    input.removeAttribute("aria-invalid");
    if (!name) error.textContent = "Enter a board name.";
    else if (name.length > 100) error.textContent = "Keep the board name to 100 characters or fewer.";
    else if (Portfolio.boards(current.id).some(board => board.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) error.textContent = "A board with this name already exists in this project.";
    else error.textContent = "";
    if (error.textContent) {
      error.hidden = false;
      input.classList.add("is-invalid");
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    const created = Portfolio.addBoard({ projectId: current.id, name, description, memberIds });
    if (!created) {
      error.textContent = "Could not save this board in the preview. Check browser storage and try again.";
      error.hidden = false;
      input.focus();
      return;
    }
    closeNewBoard();
    window.location.href = boardHref(created.id);
  }

  /* ---------- Project archive + denied state ---------- */
  async function changeArchive(archived) {
    if (!current || !Portfolio.canAggregate()) return;
    const accepted = await Screens.confirm({
      title: `${archived ? "Archive" : "Reopen"} ${current.name}?`,
      copy: archived
        ? "Its boards become read-only and the project leaves the Active list. Data is retained, and deleted-card restore deadlines continue. This changes the local preview only."
        : "The project returns to the Active list and its boards become editable again. This changes the local preview only.",
      confirmLabel: archived ? "Archive project" : "Reopen project",
      tone: archived ? "danger" : "primary",
      icon: archived ? "archive" : "restore"
    });
    if (!accepted) return;
    if (!Portfolio.setArchived(current.id, archived)) {
      Screens.toast("Could not save this change in the preview. Check browser storage and try again.", { tone: "danger", icon: "alert" });
      return;
    }
    current = Portfolio.project(projectId);
    render();
    Screens.toast(`${current.name} ${archived ? "archived" : "reopened"} in this preview.`, { tone: "success", icon: archived ? "archive" : "restore" });
  }
  function unavailable() {
    closeCard({ skipUrl: true });
    closeBoardAccess();
    closeNewBoard();
    const section = $("#projectDenied");
    section.innerHTML = Screens.accessDenied({
      title: "Project unavailable",
      copy: "This project is not available to the current preview identity. The project or its boards may be outside your granted access.",
      needed: "An active project grant",
      backHref: "projects.html",
      backLabel: "Back to projects"
    });
    section.hidden = false;
    $("#projectContent").hidden = true;
    $("#overviewPanel").hidden = true;
    $("#boardPanel").hidden = true;
    $("#allBoardsPanel").hidden = true;
    $("#projectSwitcher").replaceChildren();
    $("#boardsPanel").replaceChildren();
    $("#boardView").replaceChildren();
    $("#workResults").replaceChildren();
    $("#workTotals").replaceChildren();
    $("#workResultStatus").textContent = "";
    $("#peopleList").replaceChildren();
    $("#myAccessList").replaceChildren();
    $("#projectBanner").replaceChildren();
    $("#projectActions").replaceChildren();
    $("#projectTitle").textContent = "";
    $("#projectDescription").textContent = "";
    $("#projectPathName").textContent = "";
    $("#projectRootNode").className = "project-root-node";
    $("#projectRootNode").removeAttribute("aria-label");
    $("#projectRootNode span").textContent = "";
    Screens.setBreadcrumb([{ label: "Projects", href: "projects.html" }, { label: "Project unavailable" }]);
    ["allBoardsLink", "boardsWorkLink", "glanceWorkLink", "allWorkLink"].forEach(id => {
      const node = document.getElementById(id);
      if (node) node.removeAttribute("href");
    });
    $("#glanceDonut").removeAttribute("aria-label");
    $("#glanceDonut").style.removeProperty("--pct");
    ["glancePercent", "glanceOpen", "glanceDone", "glanceOverdue", "glanceTotal", "glanceBoards", "glanceScope", "glanceSub", "myAccessCount"].forEach(id => {
      const node = document.getElementById(id);
      if (node) node.textContent = "";
    });
    document.title = "Project unavailable — Flowboard design prototype";
  }
  function render(roleArg) {
    current = Portfolio.project(projectId);
    if (!current) { unavailable(); return; }
    /* A role switch can revoke the active board. Fall back to Overview so the
       URL does not keep an inaccessible board id in the address bar. */
    if (roleArg && activeTab !== "overview" && activeTab !== "all" && !currentBoard()) {
      activeTab = "overview";
      selectedBoardId = "";
    }
    $("#projectContent").hidden = false;
    $("#projectDenied").hidden = true;
    renderHeading();
    renderBanner();
    renderSwitcher();
    renderOverview();
    const showOverview = activeTab === "overview";
    const showAll = activeTab === "all";
    const showBoard = !showOverview && !showAll;
    $("#overviewPanel").hidden = !showOverview;
    $("#allBoardsPanel").hidden = !showAll;
    $("#boardPanel").hidden = !showBoard;
    if (showBoard) renderBoardPanel();
    else $("#boardView").replaceChildren();
    if (showAll) renderAllBoards();
    else {
      $("#workResults").replaceChildren();
      $("#workTotals").replaceChildren();
      $("#workResultStatus").textContent = "";
    }
    if (!pendingCardId) syncUrl("replace");
  }

  /* ---------- Events ---------- */
  function bind() {
    $("#projectContent").addEventListener("click", event => {
      const link = event.target.closest("[data-project-tab]");
      if (!link) return;
      if (link.dataset.projectTab !== "overview") return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      navigate(link.dataset.projectTab, { push: true });
    });
    $("#projectActions").addEventListener("click", event => {
      const button = event.target.closest("[data-project-action]");
      if (button) changeArchive(button.dataset.projectAction === "archive");
    });
    $("#projectBanner").addEventListener("click", event => {
      const button = event.target.closest('[data-project-action="reopen"]');
      if (button) changeArchive(false);
    });
    $("#boardsPanel").addEventListener("click", event => {
      const access = event.target.closest("[data-board-access]");
      if (access) openBoardAccess(access.dataset.boardAccess);
      if (event.target.closest("[data-new-board]")) openNewBoard();
    });
    $("#boardView").addEventListener("click", event => {
      const card = event.target.closest("[data-work-card]");
      if (card) openCard(card.dataset.workCard, "board");
      const access = event.target.closest("[data-board-access]");
      if (access) openBoardAccess(access.dataset.boardAccess);
    });
    $("#newBoardBtn").addEventListener("click", openNewBoard);
    $("#boardAccessMembers").addEventListener("change", event => {
      const input = event.target.closest("[data-board-member]");
      if (!input || !boardAccessDraft) return;
      const id = input.dataset.boardMember;
      if (input.checked) boardAccessDraft.draft.add(id);
      else boardAccessDraft.draft.delete(id);
    });
    $("#saveBoardAccess").addEventListener("click", saveBoardAccess);
    $("#manageProjectMembers").addEventListener("click", openProjectMembers);
    $("#projectMembersList").addEventListener("change", event => {
      const input = event.target.closest("[data-project-member]");
      if (!input || !projectMembersDraft) return;
      if (input.checked) projectMembersDraft.add(input.dataset.projectMember);
      else projectMembersDraft.delete(input.dataset.projectMember);
    });
    $("#saveProjectMembers").addEventListener("click", saveProjectMembers);
    $$ ("[data-close-project-members]").forEach(button => button.addEventListener("click", closeProjectMembers));
    $("[data-cancel-board-access]").addEventListener("click", closeBoardAccess);
    $("[data-close-board-access]").addEventListener("click", closeBoardAccess);
    $$("[data-close-new-board]").forEach(button => button.addEventListener("click", closeNewBoard));
    $("#newBoardForm").addEventListener("submit", createBoard);

    $("#workSearch").addEventListener("input", event => {
      work.q = event.target.value;
      work.limit = 20;
      renderAllBoards();
    });
    for (const [id, key] of [["workStage", "category"], ["workPriority", "priority"], ["workSort", "sort"]]) {
      $("#" + id).addEventListener("change", event => {
        work[key] = event.target.value;
        work.limit = 20;
        renderAllBoards();
      });
    }
    $$("[data-work-view]").forEach(button => button.addEventListener("click", () => {
      work.view = button.dataset.workView;
      renderAllBoards();
    }));
    $("#workReset").addEventListener("click", resetFilters);
    $("#workLoadMore").addEventListener("click", () => {
      work.limit += 20;
      renderAllBoards();
    });
    $("#workResults").addEventListener("click", event => {
      const button = event.target.closest("[data-work-card]");
      if (button) openCard(button.dataset.workCard, "all");
    });
    $("#workCardLayer").addEventListener("click", event => {
      if (event.target === event.currentTarget || event.target.closest("[data-close-work-card]")) closeCard();
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      if (openedCardId) closeCard();
      if (boardAccessDraft) closeBoardAccess();
      if (projectMembersDraft) closeProjectMembers();
      if (!$("#newBoardLayer").hidden) closeNewBoard();
    });
    window.addEventListener("popstate", () => {
      readStateFromUrl();
      render();
      openPendingCard();
      focusPanel();
    });
  }

  window.FBPage = {
    init() {
      readStateFromUrl();
      bind();
      render();
      openPendingCard();
    },
    render,
    beforeRoleChange() {
      closeCard({ skipUrl: true });
      closeBoardAccess();
      closeProjectMembers();
      closeNewBoard();
      return true;
    }
  };
})();
