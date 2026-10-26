/* Flowboard UI artifact — project overview, boards, team and access. */
(function () {
  "use strict";

  const SD = window.SD;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const escape = window.Screens.escape;
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("project") || "website-redesign";

  function me() { return window.Screens.currentUser(); }
  function project() { return SD.project(projectId); }
  function accessible() {
    const current = project();
    return Boolean(current && current.memberIds.includes(me().id));
  }

  function boardCards(board) {
    return board.id === "board_website" ? window.FB.cards : [];
  }

  function projectCards() {
    const current = project();
    if (!current) return [];
    return current.boardIds.flatMap((id) => {
      const board = SD.board(id);
      return board ? boardCards(board) : [];
    });
  }

  function distributionHTML(board) {
    const cards = boardCards(board);
    if (!cards.length) {
      return `<div class="board-distribution">
        <div class="distribution" aria-label="No cards"><span style="flex:1;background:var(--surface-3)"></span></div>
        <div class="board-dist-legend"><span>No cards yet</span></div>
      </div>`;
    }
    const counts = window.FB.columns.map((column) => ({
      column,
      count: cards.filter((card) => card.columnId === column.id).length
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

  function renderHeader() {
    const current = project();
    $("#projectMark").className = `project-mark lg ${current.tone}`;
    $("#projectMark").textContent = current.mark;
    $("#projectTitle").textContent = current.name;
    const archived = current.status === "archived";
    $("#projectEyebrow").innerHTML = `Acme Corp <span class="badge">${archived ? "Archived project" : "Project overview"}</span>`;
    $("#projectSub").innerHTML = `<span>${escape(current.description)}</span><span class="dot" aria-hidden="true"></span>${window.Screens.statusChip(archived ? "Archived" : "Active", archived ? "archived" : "active")}`;
    document.title = `${current.name} — Flowboard design prototype`;
    window.Screens.setBreadcrumb([
      { label: "Acme Corp", href: "projects.html" },
      { label: "Projects", href: "projects.html" },
      { label: current.name }
    ]);
  }

  function renderBanner() {
    const current = project();
    if (current.status !== "archived") {
      $("#projectBanner").innerHTML = "";
      return;
    }
    const reopen = window.Screens.can("archiveProject")
      ? `<button class="btn soft sm" type="button" data-reopen-project="${current.id}">${window.Screens.icon("restore")}Reopen project</button>`
      : "";
    $("#projectBanner").innerHTML = `<div class="note warn">
      ${window.Screens.icon("archive")}
      <span><strong>This project is archived.</strong> Its boards are read-only and it is hidden from active lists. Data is retained, and deleted-card restore deadlines continue. ${reopen ? "Only the Owner can reopen it." : "Ask the Owner to reopen it."}</span>
      <span class="spacer" style="flex:1;"></span>${reopen}
    </div>`;
  }

  function renderSummary() {
    const current = project();
    const cards = projectCards();
    const active = cards.filter((card) => !window.FB.isDone(card));
    const soon = active.filter((card) => card.due && window.FB.helpers.daysUntil(card.due) >= 0 && window.FB.helpers.daysUntil(card.due) <= 7).length;
    const overdue = active.filter((card) => card.due && window.FB.helpers.daysUntil(card.due) < 0).length;
    const trash = SD.trashForProject(current.id).length;
    $("#pStatBoards").textContent = current.boardIds.length;
    $("#pStatCards").textContent = cards.length;
    $("#pStatPeople").textContent = current.memberIds.length;
    $("#pStatTrash").textContent = trash;
    const trashStat = $("#pStatTrash").closest(".summary-stat");
    if (trashStat) trashStat.hidden = !window.Screens.can("browseTrash");
    $("#pStatSoon").textContent = soon;
    $("#pStatOverdue").textContent = overdue;
  }

  function renderActions() {
    const current = project();
    const archived = current.status === "archived";
    const actions = [];
    if (!archived && current.id === "website-redesign") {
      actions.push(`<a class="btn primary" href="${window.Screens.boardHref()}">${window.Screens.icon("board")}Open board</a>`);
    }
    if (window.Screens.can("invite") && !archived) {
      actions.push(`<a class="btn" href="${window.Screens.screenHref("people", { invite: 1 })}">${window.Screens.icon("user-plus")}Invite people</a>`);
    }
    if (window.Screens.can("manageProject")) {
      actions.push(`<a class="btn" href="${window.Screens.screenHref("settings")}">${window.Screens.icon("settings")}Settings</a>`);
    }
    if (window.Screens.can("archiveProject")) {
      actions.push(archived
        ? `<button class="btn soft" type="button" data-reopen-project="${current.id}">${window.Screens.icon("restore")}Reopen</button>`
        : `<button class="btn ghost danger-ghost" type="button" data-archive-project="${current.id}">${window.Screens.icon("archive")}Archive</button>`);
    }
    if (!actions.length) {
      actions.push(`<a class="btn" href="${window.Screens.screenHref("people")}">${window.Screens.icon("users")}View people</a>`);
    }
    $("#projectActions").innerHTML = actions.join("");
  }

  function renderBoards() {
    const current = project();
    const boards = current.boardIds.map((id) => SD.board(id)).filter(Boolean);
    const archived = current.status === "archived";
    $("#boardsActions").innerHTML = !archived && window.Screens.can("manageBoard")
      ? `<a class="btn sm" href="${window.Screens.screenHref("settings", { tab: "board" })}">${window.Screens.icon("settings")}Board settings</a>`
      : "";
    if (!boards.length) {
      $("#boardsPanel").innerHTML = `<div class="empty-state">${window.Screens.icon("board")}<strong>No boards yet</strong><span>Create the first board in Settings.</span></div>`;
      return;
    }
    $("#boardsPanel").innerHTML = boards.map((board) => {
      const cards = boardCards(board);
      const open = !archived && board.id === "board_website";
      return `<div class="board-card">
        <div class="board-card-top">
          <span class="board-icon">${window.Screens.icon("board")}</span>
          <div>
            <h3>${escape(board.name)}</h3>
            <p class="board-sub">${escape(board.description)} · ${cards.length} card${cards.length === 1 ? "" : "s"}</p>
          </div>
          <div class="board-actions">
            ${open ? `<a class="btn sm primary" href="${window.Screens.boardHref()}">Open</a>` : `<span class="badge">${archived ? "Read-only" : "No board link"}</span>`}
          </div>
        </div>
        ${distributionHTML(board)}
        ${archived ? `<div class="note">${window.Screens.icon("lock")}<span>Archived boards are read-only. Reopen the project to edit cards, columns or imports.</span></div>` : ""}
      </div>`;
    }).join("");
  }

  function eventFeedHTML(events) {
    if (!events.length) {
      return `<div class="empty-state">${window.Screens.icon("activity")}<strong>No activity yet</strong><span>Card changes and access events will appear here.</span></div>`;
    }
    return `<div class="activity-feed">${events.map((event) => {
      const card = event.cardId ? window.FB.card(event.cardId) : null;
      const projectName = event.projectId === "brand-refresh" ? "Brand Refresh" : "Website Redesign";
      const boardName = event.boardId ? (SD.board(event.boardId) || {}).name : "";
      const cardLink = card && project().status === "active" && event.projectId === "website-redesign"
        ? `<a href="${window.Screens.boardHref(card.id)}">${escape(card.key)} · ${escape(card.title)}</a>`
        : card ? `<span class="card-key">${escape(card.key)}</span> ${escape(card.title)}` : "";
      return `<div class="feed-item">
        ${window.Screens.avatar(event.actorId)}
        <div class="feed-main">
          <p class="feed-text"><strong>${escape(window.Screens.personName(event.actorId))}</strong> ${escape(event.text)} ${cardLink}</p>
          <p class="feed-context"><span>${escape(projectName)}</span>${boardName ? `<span class="dot" aria-hidden="true"></span><span>${escape(boardName)}</span>` : ""}<span class="dot" aria-hidden="true"></span><span>${escape(window.Screens.relativeTime(event.at))}</span></p>
        </div>
      </div>`;
    }).join("")}</div>`;
  }

  function renderActivity() {
    const current = project();
    const canSeeAccess = window.Screens.can("manageProject");
    const events = [...SD.cardEvents, ...SD.accessEvents]
      .filter((event) => event.projectId === current.id)
      .filter((event) => canSeeAccess || event.scope === "card")
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 5);
    $("#recentSub").textContent = canSeeAccess
      ? "Card events and project access events."
      : "Card history only. Project access events are visible to Owner and Manager.";
    $("#viewActivityLink").href = window.Screens.screenHref("activity", { project: current.id });
    $("#recentPanel").innerHTML = eventFeedHTML(events);
  }

  function renderTeam() {
    const current = project();
    const members = current.memberIds.map((id) => SD.member(id, current.id)).filter(Boolean);
    const pending = SD.pendingInvites.filter((invite) => invite.projectId === current.id);
    $("#teamActions").innerHTML = window.Screens.can("managePeople")
      ? `<a class="btn sm" href="${window.Screens.screenHref("people")}">${window.Screens.icon("users")}Manage people</a>`
      : `<a class="btn sm" href="${window.Screens.screenHref("people")}">${window.Screens.icon("users")}View people</a>`;
    $("#teamPanel").innerHTML = `<div>${members.map((member) => {
      const person = window.FB.person(member.personId);
      if (!person) return "";
      const isYou = member.personId === me().id;
      return `<div class="person-row${isYou ? " is-you" : ""}">
        ${window.Screens.avatar(member.personId)}
        <div class="person-copy"><strong>${escape(person.name)}${isYou ? ' <span class="badge accent">You</span>' : ""}</strong><span>${escape(member.email)}</span></div>
        <span class="status-chip ${member.role === "Owner" ? "info" : member.role === "Viewer" ? "" : "active"} plain">${escape(member.role)}</span>
        <span class="tiny faint nowrap">${member.role === "Owner" ? "Workspace owner" : `Active ${escape(window.Screens.relativeTime(member.lastActive))}`}</span>
      </div>`;
    }).join("")}</div>
    ${pending.length && window.Screens.can("managePeople") ? `<div class="divider"></div><div class="row" style="justify-content:space-between;"><span class="small muted">Pending invitations</span><span class="badge warn">${pending.length}</span></div>
      ${pending.map((invite) => `<div class="pending-row"><span class="pending-avatar" aria-hidden="true">MC</span><div class="person-copy"><strong>${escape(invite.name)}</strong><span>${escape(invite.email)} · invited ${escape(window.Screens.relativeTime(invite.invitedAt))}</span></div><span class="status-chip pending">${escape(invite.role)}</span></div>`).join("")}` : ""}`;
  }

  function renderAside() {
    const current = project();
    const archived = current.status === "archived";
    const trash = SD.trashForProject(current.id);
    const owner = window.FB.person(current.ownerId);
    const aside = [];

    aside.push(`<section class="panel">
      <div class="panel-head"><div class="panel-head-copy"><h2 class="panel-title">Your access</h2><p class="panel-sub">Previewing as ${escape(window.Screens.roleLabel())}</p></div><div class="panel-actions"><span class="badge accent">${escape(window.Screens.roleLabel())}</span></div></div>
      <div class="panel-body stack-sm">
        <p class="small muted" style="line-height:1.55;">${escape(window.Screens.roleMeta[window.Screens.role].description)}</p>
        <div class="note">${window.Screens.icon("lock")}<span>This project grant covers every board inside it. It never reveals a sibling project.</span></div>
      </div>
    </section>`);

    aside.push(`<section class="panel">
      <div class="panel-head"><div class="panel-head-copy"><h2 class="panel-title">Trash</h2><p class="panel-sub">24-hour restore window</p></div>${trash.length && window.Screens.can("browseTrash") ? '<div class="panel-actions"><span class="badge danger">1</span></div>' : ""}</div>
      <div class="panel-body stack-sm">
        ${window.Screens.can("browseTrash")
          ? trash.length
            ? `<p class="small muted">${trash.length} deleted card${trash.length === 1 ? "" : "s"} can be restored before the server deadline.</p><a class="btn sm" href="${window.Screens.screenHref("trash")}">${window.Screens.icon("trash")}Open trash</a>`
            : `<p class="small muted">Trash is empty. Deleted cards stay restorable for 24 hours.</p><a class="btn sm" href="${window.Screens.screenHref("trash")}">${window.Screens.icon("trash")}Open trash</a>`
          : `<div class="note">${window.Screens.icon("lock")}<span>Only Owner and Manager can browse or restore deleted cards. Members and Viewers see a private unavailable state.</span></div>`}
      </div>
    </section>`);

    aside.push(`<section class="panel">
      <div class="panel-head"><div class="panel-head-copy"><h2 class="panel-title">Import</h2><p class="panel-sub">Create-only XLSX</p></div></div>
      <div class="panel-body stack-sm">
        ${archived
          ? `<div class="note">${window.Screens.icon("lock")}<span>Archived projects cannot import cards. Reopen the project first.</span></div>`
          : window.Screens.can("import")
            ? `<p class="small muted">Up to 200 nonempty rows, 5 MiB, seven columns. Invalid or conflicting rows block the whole batch.</p><a class="btn sm" href="${window.Screens.screenHref("import")}">${window.Screens.icon("upload")}Import cards</a>`
            : `<div class="note">${window.Screens.icon("lock")}<span>Only Owner and Manager can upload or confirm imports. Members and Viewers cannot import.</span></div>`}
      </div>
    </section>`);

    aside.push(`<section class="panel">
      <div class="panel-head"><div class="panel-head-copy"><h2 class="panel-title">Project details</h2><p class="panel-sub">${escape(current.name)}</p></div></div>
      <div class="panel-body stack-sm">
        <div class="row" style="justify-content:space-between;"><span class="small muted">Status</span>${window.Screens.statusChip(archived ? "Archived" : "Active", archived ? "archived" : "active")}</div>
        <div class="row" style="justify-content:space-between;"><span class="small muted">Owner</span><span class="small">${escape(owner ? owner.name : "Unknown")}</span></div>
        <div class="row" style="justify-content:space-between;"><span class="small muted">Created</span><span class="small">${escape(window.Screens.formatDate(current.createdAt))}</span></div>
        <div class="row" style="justify-content:space-between;"><span class="small muted">Boards</span><span class="small">${current.boardIds.length}</span></div>
        <div class="row" style="justify-content:space-between;"><span class="small muted">Default columns</span><span class="small">4</span></div>
        ${archived ? `<div class="divider"></div><p class="tiny faint">Archived by ${escape(window.Screens.personName(current.archivedBy))} on ${escape(window.Screens.formatDate(current.archivedAt))}.</p>` : ""}
      </div>
    </section>`);

    $("#projectAside").innerHTML = aside.join("");
  }

  function renderDenied() {
    const current = project();
    const title = current ? `No access to ${current.name}` : "Project not found";
    const copy = current
      ? `${me().name} does not hold a grant for this project. Project-only access hides it from the project list and from every board, card and search result.`
      : "The requested project does not exist in this prototype. It may have been removed or the link may be wrong.";
    $("#projectDenied").innerHTML = window.Screens.accessDenied({
      title,
      copy,
      needed: "Owner or granted project role",
      backHref: "projects.html",
      backLabel: "Back to projects"
    });
    $("#projectDenied").hidden = false;
    $("#projectContent").hidden = true;
    window.Screens.setBreadcrumb([
      { label: "Acme Corp", href: "projects.html" },
      { label: "Projects", href: "projects.html" },
      { label: current ? current.name : "Project unavailable" }
    ]);
    document.title = `${title} — Flowboard design prototype`;
  }

  async function archiveProject() {
    const current = project();
    if (!current || !window.Screens.can("archiveProject")) return;
    const accepted = await window.Screens.confirm({
      title: `Archive ${current.name}?`,
      copy: "It disappears from active lists and its boards become read-only. Data is retained, deleted-card restore deadlines continue, and the Owner can reopen it. This prototype updates the project overview only; the separate board artifact is not changed.",
      confirmLabel: "Archive project",
      tone: "danger",
      icon: "archive"
    });
    if (!accepted) return;
    current.status = "archived";
    current.archivedAt = new Date().toISOString();
    current.archivedBy = me().id;
    render();
    window.Screens.toast(`${current.name} archived. Boards are read-only in production.`, { icon: "archive" });
  }

  async function reopenProject() {
    const current = project();
    if (!current || !window.Screens.can("archiveProject")) return;
    const accepted = await window.Screens.confirm({
      title: `Reopen ${current.name}?`,
      copy: "It returns to active lists and its boards become editable again. This prototype updates the project overview only.",
      confirmLabel: "Reopen project",
      tone: "primary",
      icon: "restore"
    });
    if (!accepted) return;
    current.status = "active";
    current.archivedAt = null;
    current.archivedBy = null;
    render();
    window.Screens.toast(`${current.name} reopened.`, { tone: "success", icon: "restore" });
  }

  function render() {
    if (!project() || !accessible()) {
      renderDenied();
      return;
    }
    $("#projectContent").hidden = false;
    $("#projectDenied").hidden = true;
    renderHeader();
    renderBanner();
    renderSummary();
    renderActions();
    renderBoards();
    renderActivity();
    renderTeam();
    renderAside();
  }

  function bind() {
    document.addEventListener("click", (event) => {
      const archive = event.target.closest("[data-archive-project]");
      if (archive) { archiveProject(); return; }
      const reopen = event.target.closest("[data-reopen-project]");
      if (reopen) reopenProject();
    });
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
      return true;
    }
  };
})();
