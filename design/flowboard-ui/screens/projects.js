/* Projects index for the local design preview. Project → board maps from Portfolio's scoped fixtures. */
(function () {
  "use strict";

  const Portfolio = window.Portfolio;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = window.Screens.escape;
  const icon = window.Screens.icon;
  const params = new URLSearchParams(location.search);
  const state = {
    tab: params.get("tab") === "archived" ? "archived" : "active",
    query: params.get("q") || "",
    view: params.get("view") === "list" ? "list" : "map"
  };
  const TONES = ["thistle", "petal", "pink", "icy", "sky", "slate"];
  const TONE_ALIASES = { lavender: "thistle", rose: "petal", blue: "icy", mint: "thistle", progress: "icy", completed: "thistle", gold: "sky", sage: "icy" };
  function toneOf(value) {
    if (TONES.includes(value)) return value;
    return TONE_ALIASES[value] || "thistle";
  }

  function projects() { return Portfolio.projects(); }
  function projectMark(project) {
    const tone = toneOf(project.tone);
    return `<span class="ph-mark tone-${tone}" aria-hidden="true">${esc(project.mark || project.name.slice(0, 2).toUpperCase())}</span>`;
  }
  function matchingProjects() {
    const query = state.query.trim().toLocaleLowerCase();
    return projects().filter(project => project.status === state.tab).filter(project => {
      if (!query) return true;
      const boards = Portfolio.boards(project.id).map(board => board.name).join(" ");
      return `${project.name} ${project.description || ""} ${boards}`.toLocaleLowerCase().includes(query);
    });
  }
  function updateUrl() {
    const url = new URL(location.href);
    for (const key of ["tab", "q", "view"]) url.searchParams.delete(key);
    if (state.tab !== "active") url.searchParams.set("tab", state.tab);
    if (state.query) url.searchParams.set("q", state.query);
    if (state.view !== "map") url.searchParams.set("view", state.view);
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  function accessLabel(board) {
    if (!Portfolio.canAggregate()) return `<span class="pm-branch-access is-grant">${icon("lock")}<span>Granted</span></span>`;
    const people = Portfolio.boardMembers(board.id).length;
    return `<span class="pm-branch-access">${icon("users")}<span>${people} ${people === 1 ? "person" : "people"}</span></span>`;
  }
  function archiveButton(project) {
    if (!Portfolio.canAggregate()) return "";
    const archived = project.status === "archived";
    return `<button class="pm-action ${archived ? "" : "is-danger"}" type="button" aria-label="${archived ? "Reopen" : "Archive"} ${esc(project.name)}" data-project-action="${archived ? "reopen" : "archive"}" data-project-id="${esc(project.id)}">${icon(archived ? "restore" : "archive")}<span>${archived ? "Reopen" : "Archive"}</span></button>`;
  }
  function branchRow(project, board) {
    const stats = Portfolio.boardStats(board.id);
    const tone = toneOf(board.tone);
    const href = Portfolio.workHref({ projectId: project.id, boardId: board.id });
    return `<li class="pm-branch tone-${tone}">
      <span class="pm-node" aria-hidden="true"></span>
      <div class="pm-branch-copy">
        <a class="pm-branch-name" href="${esc(href)}">${esc(board.name)}</a>
        <span class="pm-branch-description">${esc(board.description || "No description added.")}</span>
      </div>
      <span class="pm-branch-count">${stats.total} ${stats.total === 1 ? "card" : "cards"}<i aria-hidden="true">·</i>${stats.open} open</span>
      <span class="pm-branch-bar" role="img" aria-label="${stats.done} of ${stats.total} cards completed"><i style="width:${stats.percent}%"></i></span>
      ${accessLabel(board)}
      <a class="pm-branch-open" href="${esc(href)}" aria-label="Open ${esc(board.name)} board">${icon("arrow-right")}</a>
    </li>`;
  }
  function mapCard(project) {
    const boards = Portfolio.boards(project.id);
    const stats = Portfolio.projectStats(project.id);
    const archived = project.status === "archived";
    const shown = boards.slice(0, 4);
    const rest = boards.length - shown.length;
    const workHref = Portfolio.workHref({ projectId: project.id });
    const tone = toneOf(project.tone);
    return `<article class="pm-project tone-${tone} ${archived ? "is-archived" : ""}">
      <div class="pm-root">
        <div class="pm-root-head">
          ${projectMark(project)}
          <div class="pm-root-copy">
            <h3><a href="${esc(Portfolio.projectHref(project.id))}">${esc(project.name)}</a></h3>
            <p>${esc(project.description || "No description added.")}</p>
          </div>
        </div>
        <div class="pm-root-stats" aria-label="Project totals">
          <div><strong>${stats.total}</strong><span>cards</span></div>
          <div><strong>${stats.open}</strong><span>open</span></div>
          <div class="${stats.overdue ? "is-overdue" : ""}"><strong>${stats.overdue}</strong><span>overdue</span></div>
        </div>
        <div class="pm-meter" role="img" aria-label="${stats.done} of ${stats.total} cards completed">
          <span style="width:${stats.percent}%"></span>
        </div>
        <p class="pm-meter-label">${stats.done} of ${stats.total} cards completed · ${stats.percent}%</p>
        <div class="pm-root-foot">
          <span class="ph-status ${archived ? "is-archived" : "is-active"}"><i aria-hidden="true"></i>${archived ? "Archived" : "Active"}</span>
          <span class="pm-separator" aria-hidden="true"></span>
          <span class="pm-root-boards">${boards.length} ${boards.length === 1 ? "board" : "boards"}</span>
          <span class="spacer"></span>
          ${archiveButton(project)}
        </div>
      </div>
      <div class="pm-branches">
        <div class="pm-branches-head">
          <span class="pm-branches-title">Boards</span>
          <span class="pm-branches-hint">${archived ? "Read-only while archived" : "Each board keeps its own workflow and access"}</span>
        </div>
        ${boards.length
          ? `<ul class="pm-branch-list" aria-label="Boards in ${esc(project.name)}">${shown.map(board => branchRow(project, board)).join("")}${rest > 0 ? `<li class="pm-branch-more"><span aria-hidden="true">+</span>${rest} more ${rest === 1 ? "board" : "boards"} available inside this project</li>` : ""}</ul>`
          : `<div class="pm-branches-empty"><span class="pm-branches-empty-icon" aria-hidden="true">${icon("board")}</span><div><strong>No boards available</strong><p>${Portfolio.canAggregate() ? "This project has no boards yet. Open it to add the first team board." : "You have project access but no board grant in this project."}</p></div></div>`}
        <div class="pm-branches-foot">
          <a class="pm-link" href="${esc(workHref)}">${icon("columns")}All boards in this project<span aria-hidden="true">→</span></a>
          <a class="pm-link is-strong" href="${esc(Portfolio.projectHref(project.id))}">Open project<span aria-hidden="true">→</span></a>
        </div>
      </div>
    </article>`;
  }
  function listCard(project) {
    const boards = Portfolio.boards(project.id);
    const stats = Portfolio.projectStats(project.id);
    const archived = project.status === "archived";
    const projectTone = toneOf(project.tone);
    const chips = boards.slice(0, 4).map(board => {
      const tone = toneOf(board.tone);
      return `<a class="pm-chip tone-${tone}" href="${esc(Portfolio.workHref({ projectId: project.id, boardId: board.id }))}"><i aria-hidden="true"></i>${esc(board.name)}</a>`;
    }).join("");
    return `<article class="pm-row tone-${projectTone} ${archived ? "is-archived" : ""}">
      ${projectMark(project)}
      <div class="pm-row-copy">
        <h3><a href="${esc(Portfolio.projectHref(project.id))}">${esc(project.name)}</a></h3>
        <p>${esc(project.description || "No description added.")}</p>
      </div>
      <div class="pm-row-boards" aria-label="Boards in ${esc(project.name)}">${chips || `<span class="pm-chip is-empty">No boards</span>`}${boards.length > 4 ? `<span class="pm-chip is-empty">+${boards.length - 4}</span>` : ""}</div>
      <div class="pm-row-stats">
        <span><strong>${stats.total}</strong> cards</span>
        <span><strong>${stats.open}</strong> open</span>
        <span class="${stats.overdue ? "is-overdue" : ""}"><strong>${stats.overdue}</strong> overdue</span>
      </div>
      <span class="ph-status ${archived ? "is-archived" : "is-active"}"><i aria-hidden="true"></i>${archived ? "Archived" : "Active"}</span>
      ${archiveButton(project)}
      <a class="pm-row-open" href="${esc(Portfolio.projectHref(project.id))}" aria-label="Open ${esc(project.name)}">${icon("arrow-right")}</a>
    </article>`;
  }
  function emptyState() {
    const hasAny = projects().some(project => project.status === state.tab);
    const ownerCanCreate = Portfolio.canAggregate();
    const title = state.query ? "No matching projects" : state.tab === "archived" ? "No archived projects" : "No active projects";
    const message = state.query
      ? "Try another project or board name, or clear your search."
      : state.tab === "archived"
        ? "Archived projects you can access will appear here."
        : ownerCanCreate
          ? "Create a project to gather its related boards in one place."
          : "No active project grants are available to this preview identity.";
    return `<div class="ph-empty"><span class="ph-empty-mark" aria-hidden="true">${icon(state.tab === "archived" ? "archive" : "folder")}</span><h3>${title}</h3><p>${message}</p>${state.query ? `<button class="btn" type="button" data-clear-search>Clear search</button>` : !hasAny && ownerCanCreate && state.tab === "active" ? `<button class="btn primary" type="button" data-new-project>Create project</button>` : ""}</div>`;
  }
  function renderSummary() {
    const summary = Portfolio.portfolioSummary();
    $("#summaryProjects").textContent = summary.projects;
    $("#summaryBoards").textContent = summary.boards;
    $("#summaryCards").textContent = summary.cards;
    $("#summaryOverdue").textContent = summary.overdue;
  }
  function render() {
    const all = projects();
    const activeCount = all.filter(project => project.status === "active").length;
    const archivedCount = all.filter(project => project.status === "archived").length;
    const visible = matchingProjects();
    $("#activeCount").textContent = activeCount;
    $("#archivedCount").textContent = archivedCount;
    $("#projectListTitle").textContent = state.tab === "archived" ? "Archived projects" : "Active projects";
    $("#projectListCount").textContent = `${visible.length} ${visible.length === 1 ? "project" : "projects"}${state.query ? " found" : ""}`;
    $("#projectsSub").textContent = `${all.length} accessible ${all.length === 1 ? "project" : "projects"} · ${window.Screens.roleLabel()} preview`;
    renderSummary();
    const searchInput = $("#projectSearch");
    if (searchInput.value !== state.query) searchInput.value = state.query;
    $("#clearProjectSearch").hidden = !state.query;
    $("#projectList").className = `project-collection ${state.view === "list" ? "project-collection-list" : "project-collection-map"}`;
    $("#projectList").innerHTML = visible.length ? visible.map(state.view === "list" ? listCard : mapCard).join("") : emptyState();
    $$('[data-project-tab]').forEach(tab => {
      const selected = tab.dataset.projectTab === state.tab;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    $$('[data-project-view]').forEach(button => button.setAttribute("aria-pressed", String(button.dataset.projectView === state.view)));
    $("#projectList").setAttribute("aria-labelledby", `${state.tab}ProjectsTab`);
    const actions = [];
    if (Portfolio.canAggregate()) actions.push(`<button class="btn primary" type="button" data-new-project>${icon("plus")}New project</button>`);
    $("#projectsActions").innerHTML = actions.join("");
  }
  function sync() { updateUrl(); render(); }
  function openCreate() {
    if (!Portfolio.canAggregate()) return;
    const form = $("#newProjectForm");
    form.reset();
    $("#newProjectNameError").hidden = true;
    $("#newProjectName").classList.remove("is-invalid");
    $("#newProjectName").removeAttribute("aria-invalid");
    window.Screens.openDialog("newProjectLayer", document.activeElement);
  }
  async function setProjectArchive(id, archived) {
    if (!Portfolio.canAggregate()) return;
    const project = Portfolio.project(id);
    if (!project) return;
    const accepted = await window.Screens.confirm({
      title: `${archived ? "Archive" : "Reopen"} ${project.name}?`,
      copy: archived
        ? "Its boards become read-only and it leaves the Active list. Project data is retained. Deleted-card restore deadlines continue while archived. This changes the local preview only."
        : "The project returns to the Active list and its boards become editable again. This changes the local preview only.",
      confirmLabel: archived ? "Archive project" : "Reopen project",
      tone: archived ? "danger" : "primary",
      icon: archived ? "archive" : "restore"
    });
    if (!accepted) return;
    if (!Portfolio.setArchived(id, archived)) {
      window.Screens.toast("Could not save this change in the preview. Check browser storage and try again.", { tone: "danger", icon: "alert" });
      return;
    }
    state.tab = archived ? "archived" : "active";
    sync();
    window.Screens.toast(`${project.name} ${archived ? "archived" : "reopened"} in this preview.`, { tone: "success", icon: archived ? "archive" : "restore" });
  }
  function createProject(event) {
    event.preventDefault();
    const input = $("#newProjectName");
    const error = $("#newProjectNameError");
    const name = input.value.trim();
    const description = $("#newProjectDescription").value.trim();
    error.hidden = true;
    input.classList.remove("is-invalid");
    input.removeAttribute("aria-invalid");
    if (!name) error.textContent = "Enter a project name.";
    else if (name.length > 100) error.textContent = "Keep the project name to 100 characters or fewer.";
    else if (projects().some(project => project.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) error.textContent = "A project with this name already exists.";
    else error.textContent = "";
    if (error.textContent) {
      error.hidden = false;
      input.classList.add("is-invalid");
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    const created = Portfolio.addProject({ name, description });
    if (!created) {
      error.textContent = "Could not save this project in the preview. Check browser storage and try again.";
      error.hidden = false;
      input.focus();
      return;
    }
    window.Screens.closeDialog("newProjectLayer");
    state.tab = "active";
    state.query = "";
    sync();
    window.Screens.toast(`${name} created in this preview. Open it to add boards.`, { tone: "success", icon: "folder" });
  }
  function bind() {
    $("#projectSearch").addEventListener("input", event => { state.query = event.currentTarget.value; sync(); });
    $("#clearProjectSearch").addEventListener("click", () => { state.query = ""; sync(); $("#projectSearch").focus(); });
    $("#projectList").addEventListener("click", event => {
      if (event.target.closest("[data-clear-search]")) { state.query = ""; sync(); $("#projectSearch").focus(); return; }
      const action = event.target.closest("[data-project-action]");
      if (action) setProjectArchive(action.dataset.projectId, action.dataset.projectAction === "archive");
      if (event.target.closest("[data-new-project]")) openCreate();
    });
    $("#projectsActions").addEventListener("click", event => { if (event.target.closest("[data-new-project]")) openCreate(); });
    $$('[data-project-tab]').forEach(tab => tab.addEventListener("click", () => { state.tab = tab.dataset.projectTab; sync(); }));
    $(".portfolio-tabs").addEventListener("keydown", event => {
      const tabs = $$('[data-project-tab]');
      const index = tabs.indexOf(document.activeElement);
      if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      tabs[next].focus();
      tabs[next].click();
    });
    $$('[data-project-view]').forEach(button => button.addEventListener("click", () => { state.view = button.dataset.projectView; sync(); }));
    $$('[data-close-dialog]').forEach(button => button.addEventListener("click", () => window.Screens.closeDialog(button.dataset.closeDialog)));
    $("#newProjectForm").addEventListener("submit", createProject);
    document.addEventListener("keydown", event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !$("#newProjectLayer").hidden) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#projectSearch").focus(); }
    });
  }
  window.FBPage = { init() { bind(); render(); }, render, beforeRoleChange() { window.Screens.closeDialog("newProjectLayer"); return true; } };
})();
