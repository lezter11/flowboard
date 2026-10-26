/* Flowboard UI artifact — Projects list, create, archive and reopen. */
(function () {
  "use strict";

  const SD = window.SD;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const escape = window.Screens.escape;
  const state = { tab: "active" };

  const params = new URLSearchParams(window.location.search);
  if (params.get("tab") === "archived") state.tab = "archived";

  function me() { return window.Screens.currentUser(); }

  function accessibleProjects() {
    return SD.projects.filter((project) => project.memberIds.includes(me().id));
  }

  function boardFor(project) {
    return project.boardIds.map((id) => SD.board(id)).filter(Boolean);
  }

  function cardCount(project) {
    return boardFor(project).reduce((sum, board) => sum + (board.cardCount || 0), 0);
  }

  function peopleCount(project) {
    return project.memberIds.length;
  }

  function projectUpdated(project) {
    const boards = boardFor(project);
    return boards.length ? boards[0].updatedAt : project.createdAt;
  }

  function roleChip() {
    return `<span class="status-chip info plain">${escape(window.Screens.roleLabel())}</span>`;
  }

  function distributionHTML(project) {
    if (project.id !== "website-redesign") {
      return `<div class="board-distribution">
        <div class="distribution" aria-label="No cards"><span style="flex:1;background:var(--surface-3)"></span></div>
        <div class="board-dist-legend"><span>No cards yet</span></div>
      </div>`;
    }
    const counts = window.FB.columns.map((column) => ({
      column,
      count: window.FB.cards.filter((card) => card.columnId === column.id).length
    }));
    return `<div class="board-distribution">
      <div class="distribution" aria-label="${counts.map((item) => `${escape(item.column.name)}: ${item.count}`).join(", ")}">
        ${counts.map((item) => `<span class="dist-${item.column.tone}" style="flex:${Math.max(item.count, 0.3)}" title="${escape(item.column.name)}: ${item.count}"></span>`).join("")}
      </div>
      <div class="board-dist-legend">
        ${counts.map((item) => `<span><i class="dist-${item.column.tone}"></i>${escape(item.column.name)} ${item.count}</span>`).join("")}
      </div>
    </div>`;
  }

  function projectCard(project) {
    const archived = project.status === "archived";
    const cards = cardCount(project);
    const boards = boardFor(project);
    const pending = SD.pendingInvites.filter((invite) => invite.projectId === project.id);
    const members = project.memberIds.map((id) => window.FB.person(id)).filter(Boolean);
    const actions = [];

    if (!archived) {
      actions.push(`<a class="btn primary" href="${window.Screens.screenHref("project", { project: project.id })}">Open project ${window.Screens.icon("arrow-right")}</a>`);
      if (project.id === "website-redesign") {
        actions.push(`<a class="btn" href="${window.Screens.boardHref()}">${window.Screens.icon("board")}Open board</a>`);
      }
    } else {
      actions.push(`<a class="btn" href="${window.Screens.screenHref("project", { project: project.id })}">${window.Screens.icon("eye")}Open overview</a>`);
    }
    if (archived && window.Screens.can("archiveProject")) {
      actions.push(`<button class="btn soft" type="button" data-reopen-project="${project.id}">${window.Screens.icon("restore")}Reopen</button>`);
    }
    if (!archived && window.Screens.can("archiveProject")) {
      actions.push(`<button class="btn ghost danger-ghost" type="button" data-archive-project="${project.id}">${window.Screens.icon("archive")}Archive</button>`);
    }

    return `<article class="project-card${archived ? " archived" : ""}" data-project-id="${project.id}">
      <div class="project-card-head">
        <span class="project-mark ${project.tone}" aria-hidden="true">${escape(project.mark)}</span>
        <div class="project-card-title">
          <h2>${escape(project.name)}</h2>
          <p>${escape(project.description)}</p>
          <div class="project-card-badges">
            ${window.Screens.statusChip(archived ? "Archived" : "Active", archived ? "archived" : "active")}
            ${roleChip()}
            ${pending.length && window.Screens.can("managePeople") ? `<span class="status-chip pending">${pending.length} pending invite</span>` : ""}
          </div>
        </div>
        <span class="badge">${boards.length} board${boards.length === 1 ? "" : "s"}</span>
      </div>

      <div class="project-card-meta">
        <span>${cards} card${cards === 1 ? "" : "s"}</span>
        <span class="dot" aria-hidden="true"></span>
        <span>${peopleCount(project)} ${peopleCount(project) === 1 ? "person" : "people"}</span>
        <span class="dot" aria-hidden="true"></span>
        ${archived
          ? `<span>Archived by ${escape(window.Screens.personName(project.archivedBy))} · ${escape(window.Screens.relativeTime(project.archivedAt))}</span>`
          : `<span>Updated ${escape(window.Screens.relativeTime(projectUpdated(project)))}</span>`}
      </div>

      ${distributionHTML(project)}

      ${archived ? `<div class="note"><svg class="icon" aria-hidden="true"><use href="#i-archive"></use></svg><span>Boards are read-only while archived. Data is retained and deleted-card restore deadlines continue.</span></div>` : ""}

      <div class="project-card-actions">${actions.join("")}</div>

      <div class="project-card-foot">
        <span class="avatar-stack">${members.slice(0, 4).map((person) => window.Screens.avatar(person.id)).join("")}</span>
        <span class="small muted">${members.map((person) => escape(person.name)).join(", ")}</span>
        ${pending.length && window.Screens.can("managePeople") ? `<a class="link-inline small" style="margin-left:auto;" href="${window.Screens.screenHref("people")}">Review pending invite</a>` : ""}
      </div>
    </article>`;
  }

  function emptyHTML() {
    const archived = state.tab === "archived";
    return `<div class="panel"><div class="empty-state">
      ${window.Screens.icon(archived ? "archive" : "folder")}
      <strong>${archived ? "No archived projects" : "No active projects"}</strong>
      <span>${archived
        ? "Archived projects appear here. Only the Owner can reopen one."
        : window.Screens.can("createProject")
          ? "Create a project to get started. You can add boards and invite people next."
          : "You do not have an active project grant. Ask the Owner or a Manager for access."}</span>
      ${!archived && window.Screens.can("createProject") ? '<button class="btn primary" type="button" data-new-project>Create project</button>' : ""}
    </div></div>`;
  }

  function renderActions() {
    const actions = [];
    if (window.Screens.can("createProject")) {
      actions.push(`<button class="btn primary" type="button" data-new-project>${window.Screens.icon("plus")}New project</button>`);
    }
    if (accessibleProjects().some((project) => project.id === "website-redesign" && project.status === "active")) {
      actions.push(`<a class="btn" href="${window.Screens.boardHref()}">${window.Screens.icon("board")}Open board</a>`);
    }
    actions.push(`<a class="btn ghost" href="${window.Screens.screenHref("people")}">${window.Screens.icon("users")}Role guide</a>`);
    $("#projectsActions").innerHTML = actions.join("");
  }

  function renderSummary() {
    const projects = accessibleProjects();
    const active = projects.filter((project) => project.status === "active");
    const archived = projects.filter((project) => project.status === "archived");
    const boards = projects.reduce((sum, project) => sum + project.boardIds.length, 0);
    const cards = projects.reduce((sum, project) => sum + cardCount(project), 0);
    const people = new Set(projects.flatMap((project) => project.memberIds)).size;
    $("#statActive").textContent = active.length;
    $("#statBoards").textContent = boards;
    $("#statCards").textContent = cards;
    $("#statPeople").textContent = people;
    $("#statArchived").textContent = archived.length;
    $("#activeCount").textContent = active.length;
    $("#archivedCount").textContent = archived.length;
    $("#projectsSub").innerHTML = `<span>${active.length} active</span><span class="dot" aria-hidden="true"></span><span>${archived.length} archived</span><span class="dot" aria-hidden="true"></span><span>${people} people</span>`;
    $("#projectsScopeBadge").textContent = `${window.Screens.roleLabel()} preview`;
    $("#projectListCount").textContent = `${state.tab === "archived" ? archived.length : active.length} shown`;
  }

  function renderTabs() {
    $$("[data-project-tab]").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab.dataset.projectTab === state.tab));
    });
  }

  function renderList() {
    const projects = accessibleProjects().filter((project) => project.status === state.tab);
    $("#projectList").innerHTML = projects.length ? projects.map(projectCard).join("") : emptyHTML();
  }

  function renderAside() {
    const role = window.Screens.roleMeta[window.Screens.role];
    const pending = SD.pendingInvites.filter((invite) => accessibleProjects().some((project) => project.id === invite.projectId));
    const ownerControls = window.Screens.can("createProject");
    const managerControls = window.Screens.can("manageProject");
    const aside = [];

    aside.push(`<section class="panel">
      <div class="panel-head"><div class="panel-head-copy">
        <h2 class="panel-title">Your access</h2>
        <p class="panel-sub">Previewing as ${escape(role.label)}</p>
      </div><div class="panel-actions"><span class="badge accent">${escape(role.label)}</span></div></div>
      <div class="panel-body stack-sm">
        <p class="small muted" style="line-height:1.55;">${escape(role.description)}</p>
        <div class="note">${window.Screens.icon("shield")}<span>${ownerControls
          ? "You can create projects and archive or reopen any project you own."
          : managerControls
            ? "You can configure granted projects and invite members, but you cannot create or archive a project."
            : "You can read granted projects. Project creation, archive and board configuration are restricted."}</span></div>
        ${pending.length && managerControls ? `<a class="btn sm" href="${window.Screens.screenHref("people")}">${window.Screens.icon("mail")}Review ${pending.length} pending invite</a>` : ""}
      </div>
    </section>`);

    aside.push(`<section class="panel">
      <div class="panel-head"><div class="panel-head-copy">
        <h2 class="panel-title">Project-only access</h2>
        <p class="panel-sub">Grants are checked per project</p>
      </div></div>
      <div class="panel-body stack-sm">
        <div class="note">${window.Screens.icon("lock")}<span>A project grant covers every board inside that project. It never reveals a sibling project.</span></div>
        <div class="note warn">${window.Screens.icon("alert")}<span><strong>UI hiding is not authorization.</strong> The API must check project ancestry on every read and write.</span></div>
      </div>
    </section>`);

    aside.push(`<section class="panel">
      <div class="panel-head"><div class="panel-head-copy">
        <h2 class="panel-title">Archive rules</h2>
        <p class="panel-sub">Reversible, owner-only</p>
      </div></div>
      <div class="panel-body stack-sm">
        <p class="small muted" style="line-height:1.55;">Archiving hides a project from ordinary active lists and makes its boards read-only. Data is retained and the Owner can reopen it.</p>
        <p class="small muted" style="line-height:1.55;">Archiving never pauses a deleted card's 24-hour restore deadline.</p>
        <p class="tiny faint">Permanent project destruction and ownership transfer are later scope.</p>
      </div>
    </section>`);

    $("#projectsAside").innerHTML = aside.join("");
  }

  function render() {
    renderSummary();
    renderActions();
    renderTabs();
    renderList();
    renderAside();
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    if (state.tab === "archived") url.searchParams.set("tab", "archived");
    else url.searchParams.delete("tab");
    history.replaceState(null, "", url.pathname.split("/").pop() + url.search + url.hash);
  }

  function openNewProject() {
    $("#newProjectForm").reset();
    $("#newProjectNameError").hidden = true;
    $("#newBoardNameError").hidden = true;
    $("#newProjectName").classList.remove("is-invalid");
    $("#newBoardName").classList.remove("is-invalid");
    window.Screens.openDialog("newProjectLayer");
  }

  function markFor(name) {
    return name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  }

  function createProject(event) {
    event.preventDefault();
    const name = $("#newProjectName").value.trim();
    const description = $("#newProjectDescription").value.trim();
    const boardName = $("#newBoardName").value.trim();
    const nameError = $("#newProjectNameError");
    const boardError = $("#newBoardNameError");
    let valid = true;

    nameError.hidden = true;
    boardError.hidden = true;
    $("#newProjectName").classList.remove("is-invalid");
    $("#newBoardName").classList.remove("is-invalid");

    if (!name) {
      nameError.textContent = "Enter a project name.";
      nameError.hidden = false;
      $("#newProjectName").classList.add("is-invalid");
      valid = false;
    } else if (name.length > 80) {
      nameError.textContent = "Keep the project name to 80 characters or fewer.";
      nameError.hidden = false;
      $("#newProjectName").classList.add("is-invalid");
      valid = false;
    } else if (SD.projects.some((project) => project.name.trim().toLowerCase() === name.toLowerCase())) {
      nameError.textContent = "A project with this name already exists.";
      nameError.hidden = false;
      $("#newProjectName").classList.add("is-invalid");
      valid = false;
    }

    if (!boardName) {
      boardError.textContent = "Enter a name for the first board.";
      boardError.hidden = false;
      $("#newBoardName").classList.add("is-invalid");
      valid = false;
    }

    if (!valid) {
      const firstInvalid = $(".is-invalid", $("#newProjectForm"));
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const id = `project_${Date.now()}`;
    const boardId = `board_${Date.now()}`;
    const now = new Date().toISOString();
    const project = {
      id,
      name,
      description: description || "New project.",
      status: "active",
      mark: markFor(name),
      tone: ["slate", "gold", "sage"][SD.projects.length % 3],
      ownerId: me().id,
      createdAt: now,
      archivedAt: null,
      archivedBy: null,
      boardIds: [boardId],
      memberIds: [me().id]
    };
    const board = {
      id: boardId,
      projectId: id,
      name: boardName,
      description: description || "First board",
      status: "active",
      updatedAt: now,
      cardCount: 0
    };
    SD.projects.push(project);
    SD.boards.push(board);
    window.Screens.closeDialog("newProjectLayer");
    state.tab = "active";
    updateUrl();
    render();
    window.Screens.toast(`${name} created with ${boardName}. This prototype does not persist it.`, { tone: "success", icon: "folder" });
  }

  async function archiveProject(projectId) {
    const project = SD.project(projectId);
    if (!project || !window.Screens.can("archiveProject")) return;
    const accepted = await window.Screens.confirm({
      title: `Archive ${project.name}?`,
      copy: "It disappears from active lists and its boards become read-only. Data is retained, deleted-card restore deadlines continue, and the Owner can reopen it. This prototype updates the project list only; the separate board artifact is not changed.",
      confirmLabel: "Archive project",
      tone: "danger",
      icon: "archive"
    });
    if (!accepted) return;
    project.status = "archived";
    project.archivedAt = new Date().toISOString();
    project.archivedBy = me().id;
    state.tab = "archived";
    updateUrl();
    render();
    window.Screens.toast(`${project.name} archived. Boards are read-only in production.`, { icon: "archive" });
  }

  async function reopenProject(projectId) {
    const project = SD.project(projectId);
    if (!project || !window.Screens.can("archiveProject")) return;
    const accepted = await window.Screens.confirm({
      title: `Reopen ${project.name}?`,
      copy: "It returns to active lists and its boards become editable again. This prototype updates the project list only.",
      confirmLabel: "Reopen project",
      tone: "primary",
      icon: "restore"
    });
    if (!accepted) return;
    project.status = "active";
    project.archivedAt = null;
    project.archivedBy = null;
    state.tab = "active";
    updateUrl();
    render();
    window.Screens.toast(`${project.name} reopened.`, { tone: "success", icon: "restore" });
  }

  function bind() {
    $("#projectsActions").addEventListener("click", (event) => {
      if (event.target.closest("[data-new-project]")) openNewProject();
    });
    $("#projectList").addEventListener("click", (event) => {
      const newButton = event.target.closest("[data-new-project]");
      if (newButton) { openNewProject(); return; }
      const archive = event.target.closest("[data-archive-project]");
      if (archive) { archiveProject(archive.dataset.archiveProject); return; }
      const reopen = event.target.closest("[data-reopen-project]");
      if (reopen) reopenProject(reopen.dataset.reopenProject);
    });
    $$("[data-project-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        state.tab = tab.dataset.projectTab;
        updateUrl();
        render();
      });
    });
    $$("[data-close-dialog]").forEach((button) => {
      button.addEventListener("click", () => window.Screens.closeDialog(button.dataset.closeDialog));
    });
    $("#newProjectForm").addEventListener("submit", createProject);
  }

  window.FBPage = {
    init() {
      bind();
      render();
    },
    render() {
      render();
    },
    beforeRoleChange() {
      window.Screens.closeDialog("newProjectLayer");
      return true;
    }
  };
})();
