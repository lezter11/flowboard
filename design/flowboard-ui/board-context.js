/* Resolve one board, or a read-only project-wide view, before binding the full workspace. */
(function () {
  "use strict";
  const params = new URLSearchParams(location.search);
  const aggregate = params.get("scope") === "all";
  const invalidScope = params.has("scope") && !aggregate;
  const requestedProject = params.get("project");
  const boardId = params.has("board") ? params.get("board") : "board_website";
  const data = aggregate ? null : Portfolio.fullBoardData(boardId);
  const project = aggregate ? Portfolio.project(requestedProject) : data?.project;
  const valid = !invalidScope && (aggregate
    ? Boolean(requestedProject && !params.has("board") && project)
    : Boolean(data && (!requestedProject || requestedProject === data.project.id)));
  const originalCan = FB.can;
  const context = FB.boardContext = {
    aggregate, boardId: aggregate ? null : boardId,
    projectId: valid ? project.id : requestedProject || "",
    name: valid ? (aggregate ? "All boards" : data.board.name) : "",
    projectName: valid ? project.name : ""
  };
  const app = document.querySelector(".app"), unavailable = document.querySelector("#boardUnavailable");
  const isAvailable = () => Boolean(valid && Portfolio.project(context.projectId) && (aggregate || (Portfolio.board(boardId) && Portfolio.board(boardId).projectId === context.projectId)));
  const readOnly = () => Boolean(isAvailable() && (aggregate || Portfolio.project(context.projectId).status === "archived" || Portfolio.board(boardId)?.status === "archived"));
  const aggregateColumns = [
    { id:"all_todo", name:"Not started", tone:"backlog", category:"todo" },
    { id:"all_active", name:"In progress", tone:"progress", category:"active" },
    { id:"all_done", name:"Completed", tone:"completed", category:"done" }
  ];
  function refreshAggregate() {
    if (!aggregate) return;
    if (!isAvailable()) { FB.columns.splice(0); FB.cards.splice(0); return; }
    const selectedProject = Portfolio.project(context.projectId);
    const cards = Portfolio.cards({ projectId: context.projectId, includeArchived: selectedProject.status === "archived" });
    FB.columns.splice(0, FB.columns.length, ...aggregateColumns.map(column => ({ ...column })));
    FB.cards.splice(0, FB.cards.length, ...cards.map(card => ({
      ...card, sourceColumnName: card.columnName, sourceColumnId: card.columnId,
      columnId: card.category === "done" ? "all_done" : card.category === "todo" ? "all_todo" : "all_active",
      description: "", images: [], comments: [], activity: [], createdAt: new Date().toISOString()
    })));
  }
  FB.can = function (action) { return Boolean(isAvailable() && originalCan(action) && (action === "read" || !readOnly())); };
  FB.aggregateCardHref = function (card) {
    if (!aggregate || !card || !isAvailable() || card.projectId !== context.projectId) return "";
    const source = Portfolio.board(card.boardId);
    if (!source || source.projectId !== context.projectId) return "";
    const target = new URLSearchParams({ project: context.projectId, board: source.id, card: card.id });
    if (FB.state.role !== "owner") target.set("role", FB.state.role);
    if (document.documentElement.dataset.theme === "dark") target.set("theme", "dark");
    return `index.html?${target}`;
  };
  FB.syncBoardAccess = function () {
    const allowed = isAvailable();
    refreshAggregate();
    app.hidden = !allowed;
    unavailable.hidden = allowed;
    const skip = document.querySelector(".skip-link");
    if (skip) skip.href = allowed ? "#board" : "#boardUnavailable";
    const note = document.querySelector("#boardReadOnly");
    if (note) {
      note.textContent = aggregate ? "Open a card to edit it on its board." : "Archived · read-only";
      note.hidden = !readOnly();
    }
    return allowed;
  };
  FB.persistBoard = function () {
    if (aggregate || !isAvailable() || readOnly() || !originalCan("edit")) return false;
    const saved = Portfolio.saveBoardData(boardId, { columns: FB.columns, cards: FB.cards });
    FB.boardSaveFailed = !saved;
    const warning = document.querySelector("#boardSaveWarning");
    if (warning) warning.hidden = saved;
    return saved;
  };
  document.querySelector("#boardSaveRetry")?.addEventListener("click", () => {
    if (FB.persistBoard()) FB.toast?.("Changes saved in this preview.", { tone: "success", icon: "check" });
  });
  if (valid) {
    if (aggregate) refreshAggregate();
    else {
      const defaults = [
        {id:"col_backlog",name:"Not started",tone:"backlog",category:"todo"},
        {id:"col_progress",name:"In progress",tone:"progress",category:"active"},
        {id:"col_testing",name:"Testing",tone:"testing",category:"active"},
        {id:"col_blocked",name:"Blocked",tone:"blocked",category:"active"},
        {id:"col_completed",name:"Completed",tone:"completed",category:"done"}
      ];
      const toneFor = c => c.tone || (c.category === "done" ? "completed" : c.category === "todo" ? "backlog" : /review|test/i.test(c.name) ? "testing" : "progress");
      const columns = (data.columns.length ? data.columns : defaults).map(c => ({ ...c, tone: toneFor(c) }));
      FB.columns.splice(0, FB.columns.length, ...columns);
      FB.cards.splice(0, FB.cards.length, ...data.cards);
    }
    document.body.dataset.boardScope = aggregate ? "all" : "single";
    const heading = document.querySelector("#boardTitle"); heading.textContent = context.name; heading.title = context.name;
    document.title = `${context.name} · ${project.name} — Flowboard`;
    const crumb = document.querySelector('a[href="screens/project.html?project=website-redesign"]');
    if (crumb) { crumb.textContent = project.name; crumb.href = `screens/project.html?project=${encodeURIComponent(project.id)}`; }
    const activeBoard = document.querySelector('[data-nav="Board"]');
    if (activeBoard) activeBoard.href = aggregate ? `index.html?project=${encodeURIComponent(project.id)}&scope=all` : `index.html?project=${encodeURIComponent(project.id)}&board=${encodeURIComponent(boardId)}`;
    const detailBoard = document.querySelector("#drawerBoardName"); if (detailBoard) detailBoard.textContent = context.name;
  } else { FB.columns.splice(0); FB.cards.splice(0); }
  FB.syncBoardAccess();
})();
