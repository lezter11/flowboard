/* Flowboard UI artifact — board rendering, filters, quick add, drag and role preview. */
(function () {
  "use strict";

  const { state, columns, cards, people, helpers, can } = FB;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const escape = helpers.escapeHTML;
  state.viewMode = new URLSearchParams(window.location.search).get("view") === "list" ? "list" : "board";
  state.cardStyle = new URLSearchParams(window.location.search).get("cards") === "glass" ? "glass" : "focus";
  state.showCardImages = false;
  try { state.showCardImages = localStorage.getItem("flowboard-ui-card-images") === "true"; } catch (error) { /* keep previews off when storage is unavailable */ }

  let boardEl;
  let searchTimer = null;
  let dragId = null;

  const icon = (name, cls) =>
    `<svg class="icon${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

  function avatarHTML(personId, extra) {
    const person = FB.person(personId);
    if (!person) return "";
    return `<span class="avatar ${person.tone}${extra ? " " + extra : ""}" title="${escape(person.name)}" aria-hidden="true">${person.initials}</span>`;
  }

  function personName(personId) {
    const person = FB.person(personId);
    return person ? person.name : "Unknown";
  }

  function filtersActive() {
    return Boolean(state.filters.q || state.filters.assignees.length || state.filters.due !== "any");
  }

  function matchesFilters(card) {
    const q = state.filters.q.trim().toLowerCase();
    if (q) {
      const haystack = [
        card.title,
        card.description,
        card.key,
        card.assignees.map(personName).join(" ")
      ].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    const selected = state.filters.assignees;
    if (selected.length) {
      const wantsUnassigned = selected.includes("unassigned");
      const wantsPerson = selected.some((id) => id !== "unassigned");
      const matchesPerson = card.assignees.some((id) => selected.includes(id));
      if (!(wantsUnassigned && card.assignees.length === 0) && !(wantsPerson && matchesPerson)) return false;
    }

    const due = state.filters.due;
    if (due !== "any") {
      if (FB.isDone(card)) return false;
      if (due === "none" && card.due) return false;
      if (due !== "none") {
        if (!card.due) return false;
        const days = helpers.daysUntil(card.due);
        if (due === "overdue" && days >= 0) return false;
        if (due === "soon" && (days < 0 || days > 7)) return false;
      }
    }

    return true;
  }

  function visibleCards() {
    return cards.filter(matchesFilters);
  }

  function cardHTML(card) {
    const due = helpers.dueInfo(card);
    const list = state.viewMode === "list";
    const glass = !list && state.cardStyle === "glass";
    const draggable = can("move") && !filtersActive() && state.viewMode === "board";
    const key = `<span class="card-key">${escape(card.key)}</span>`;
    const deadline = due ? `<span class="due is-${due.state}"${due.detail ? ` title="${escape(due.detail)}"` : ""}>
      ${icon("calendar")}<time datetime="${escape(card.due)}">${escape(due.label)}</time></span>` : "";
    const priority = card.priority && card.priority !== "none"
      ? `<span class="card-priority priority-${card.priority}" data-tooltip="${escape(card.priority)} priority">${escape(card.priority[0].toUpperCase() + card.priority.slice(1))}</span>`
      : "";

    const media = (state.showCardImages && !list ? card.images.slice(0, 2) : []).map((img) =>
      `<span class="card-thumb" style="background-image:url('${img.src}')" role="img" aria-label="${escape(img.label)}, private image" title="${escape(img.label)}">
        <span class="lock">${icon("lock", "icon-sm")}</span>
      </span>`
    ).join("");
    const extraMedia = state.showCardImages && !list && card.images.length > 2
      ? `<span class="card-more-media" title="${card.images.length - 2} more private images">+${card.images.length - 2}</span>`
      : "";

    const assigneeStack = card.assignees.length
      ? `<span class="assignee-group" role="group" aria-label="Assigned to ${escape(card.assignees.map(personName).join(", "))}"><span class="avatar-stack" aria-hidden="true">${card.assignees.slice(0, 2).map((id) => avatarHTML(id)).join("")}${
          card.assignees.length > 2
            ? `<span class="avatar" title="${card.assignees.length - 2} more assignees">+${card.assignees.length - 2}</span>`
            : ""
        }</span><span class="assignee-names" aria-hidden="true">${escape(personName(card.assignees[0]).split(" ")[0])}${card.assignees.length > 1 ? ` +${card.assignees.length - 1}` : ""}</span></span>`
      : `<span class="assignee-group" role="group" aria-label="Unassigned"><span class="avatar empty" title="Unassigned" aria-hidden="true">${icon("users", "icon-sm")}</span><span class="assignee-names" aria-hidden="true">Unassigned</span></span>`;

    const meta = [];
    if (card.comments.length) {
      meta.push(`<span class="meta-chip" title="${card.comments.length} comments">${icon("message")}<span class="sr-only">Comments: </span>${card.comments.length}</span>`);
    }
    if (card.images.length) {
      meta.push(`<span class="meta-chip" title="${card.images.length} private images">${icon("image")}<span class="sr-only">Private images: </span>${card.images.length}</span>`);
    }

    const moveButton = can("move")
      ? `<button class="card-move" type="button" data-action="move" data-card-id="${card.id}" aria-label="Move card: ${escape(card.title)}" title="Move card">
          ${icon("move")}
        </button>`
      : "";

    const header = list ? `${key}${priority}${moveButton}`
      : glass ? `${key}${moveButton ? `<span class="card-action-tray">${moveButton}</span>` : ""}`
      : `${priority}<span class="card-head-spacer"></span>${deadline}${moveButton}`;
    const footer = list ? `${deadline}${meta.join("")}<span class="spacer"></span>${assigneeStack}`
      : `${assigneeStack}<span class="spacer"></span>${meta.join("")}${glass ? "" : key}`;

    const titleControl = FB.boardContext?.aggregate
      ? `<a class="card-open" data-app-link href="${escape(FB.aggregateCardHref(card))}" aria-label="Open ${escape(card.title)} on ${escape(card.boardName)}">${escape(card.title)}</a>`
      : `<button class="card-open" data-tooltip="${escape(card.title + (card.description ? "\n" + card.description.slice(0, 240) + (card.description.length > 240 ? "… Open card for more." : "") : ""))}" type="button" data-action="open" data-card-id="${card.id}" aria-label="Open card: ${escape(card.title)}">${escape(card.title)}</button>`;
    const source = FB.boardContext?.aggregate ? `<p class="card-origin" title="${escape(card.boardName)} · ${escape(card.sourceColumnName)}">${escape(card.boardName)} <span aria-hidden="true">·</span> ${escape(card.sourceColumnName)}</p>` : "";

    return `<article class="card card--${list ? "list" : state.cardStyle}" data-card-id="${card.id}" aria-labelledby="card-title-${card.id}"${draggable ? ' draggable="true"' : ""}>
      <div class="card-head">
        ${header}
      </div>
      <div class="card-body" data-action="open" data-card-id="${card.id}">
        <h3 class="card-title" id="card-title-${card.id}">${titleControl}</h3>
        ${source}
        ${card.description ? `<p class="card-desc">${escape(card.description)}</p>` : ""}
        ${glass && (priority || deadline) ? `<div class="card-signals">${priority}${deadline}</div>` : ""}
        ${media ? `<div class="card-media">${media}${extraMedia}</div>` : ""}
        <div class="card-meta">
          ${footer}
        </div>
      </div>
    </article>`;
  }

  function emptyHTML(column, hasAnyCards) {
    if (filtersActive() && hasAnyCards) {
      return `<div class="column-empty no-match">${icon("search")}
        <strong>No cards match</strong>
        <span>Try clearing a filter.</span>
      </div>`;
    }
    if (FB.boardContext?.aggregate) return `<div class="column-empty">${icon("board")}<strong>No cards in this stage</strong><span>Cards from your accessible boards appear here.</span></div>`;
    return `<div class="column-empty">${icon("board")}
      <strong>No cards yet</strong>
      <span>Add the first card to this column.</span>
    </div>`;
  }

  function quickAddHTML(column) {
    if (state.composerColumn !== column.id) {
      return `<div class="quick-add">
        <button class="quick-add-trigger" type="button" data-action="add-open" data-column-id="${column.id}">
          ${icon("plus")}Add a card
        </button>
      </div>`;
    }
    return `<div class="quick-add">
      <form class="quick-add-form" data-quick-add="${column.id}">
        <label class="sr-only" for="quickAdd-${column.id}">New card title in ${escape(column.name)}</label>
        <textarea id="quickAdd-${column.id}" rows="2" maxlength="200" placeholder="Card title…" data-quick-add-input>${escape(state.quickAddText || "")}</textarea>
        <label class="quick-add-priority-label" for="quickAddPriority-${column.id}">Priority <span aria-hidden="true">*</span></label>
        <select class="quick-add-priority${state.quickAddPriority ? ` priority-${state.quickAddPriority}` : ""}" id="quickAddPriority-${column.id}" data-quick-add-priority aria-required="true" aria-describedby="quickAddPriorityError-${column.id}">
          <option value=""${state.quickAddPriority ? "" : " selected"}>Choose a priority</option>
          ${["low", "medium", "high", "urgent"].map((priority) => `<option value="${priority}"${state.quickAddPriority === priority ? " selected" : ""}>${priority[0].toUpperCase() + priority.slice(1)}</option>`).join("")}
        </select>
        <p class="quick-add-error" id="quickAddPriorityError-${column.id}" data-quick-add-error role="alert"${state.quickAddError ? "" : " hidden"}>${escape(state.quickAddError || "")}</p>
        <div class="quick-add-actions">
          <span class="hint">Choose a priority · Enter to add · Esc to cancel</span>
          <button class="btn ghost sm" type="button" data-action="add-cancel">Cancel</button>
          <button class="btn primary sm" type="submit">Add card</button>
        </div>
      </form>
    </div>`;
  }

  function columnHTML(column) {
    const all = cards.filter((card) => card.columnId === column.id);
    const visible = visibleCards().filter((card) => card.columnId === column.id);
    const isCompleted = (column.category || (column.id === "col_completed" ? "done" : "active")) === "done";
    const collapse = isCompleted && !FB.boardContext?.aggregate && !filtersActive() && !state.expandedCompleted && visible.length > 5;
    const shown = collapse ? visible.slice(0, 5) : visible;
    const hiddenCount = visible.length - shown.length;
    const countLabel = filtersActive() ? `${visible.length} of ${all.length} cards` : `${all.length} cards`;

    const headerAdd = can("edit")
      ? `<button class="icon-btn" type="button" data-action="add-open" data-column-id="${column.id}" aria-label="Add a card to ${escape(column.name)}" title="Add a card">${icon("plus")}</button>`
      : "";
    const headerSettings = can("manageBoard")
      ? `<button class="icon-btn" type="button" data-action="column-settings" data-column-id="${column.id}" aria-label="Settings for ${escape(column.name)}" title="Column settings">${icon("more")}</button>`
      : "";

    const showMore = hiddenCount > 0
      ? `<button class="show-more" type="button" data-action="show-more">${icon("chevron-down")}Show ${hiddenCount} more</button>`
      : isCompleted && !filtersActive() && state.expandedCompleted && all.length > 5
        ? `<button class="show-more" type="button" data-action="show-less">${icon("chevron-down")}Show less</button>`
        : "";

    return `<section class="column" data-column-id="${column.id}" data-tone="${column.tone}" aria-labelledby="colTitle-${column.id}">
      <header class="column-head">
        <span class="column-dot" aria-hidden="true"></span>
        <h2 class="column-title" id="colTitle-${column.id}">${escape(column.name)}</h2>
        <span class="column-count" title="${countLabel}" aria-label="${countLabel}">${filtersActive() ? visible.length : all.length}</span>
        <div class="column-actions">${headerAdd}${headerSettings}</div>
      </header>
      <div class="column-body">
        <div class="column-cards" data-drop-zone="${column.id}">
          ${shown.map(cardHTML).join("")}
          ${shown.length === 0 ? emptyHTML(column, all.length > 0) : ""}
        </div>
        ${showMore}
        ${can("edit") ? quickAddHTML(column) : ""}
      </div>
    </section>`;
  }

  function renderBoard() {
    FB.hideBoardTooltip?.();
    if (!boardEl) return;
    const list = state.viewMode === "list";
    boardEl.dataset.cardStyle = state.cardStyle;
    $("#cardStyleSelect").value = state.cardStyle;
    $("#cardStyleControl").hidden = list;
    $("#cardDisplayControl").hidden = list || Boolean(FB.boardContext?.aggregate);
    $("#showCardImages").checked = state.showCardImages;
    if (list) {
      $("#cardDisplayMenu").hidden = true;
      $("#cardDisplaySettingsBtn").setAttribute("aria-expanded", "false");
    }
    boardEl.classList.toggle("is-list", list);
    boardEl.setAttribute("aria-label", `${FB.boardContext?.name || "Website Kanban"} ${list ? "list" : "board"}`);
    $("#viewSwitch").dataset.view = state.viewMode;
    $$("[data-board-view]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.boardView === state.viewMode));
    });
    $("#viewStatus").textContent = `${list ? "List" : "Board"} view`;
    boardEl.innerHTML = columns.map(columnHTML).join("");
  }

  function setBoardView(view) {
    if (view === state.viewMode) return;
    state.viewMode = view === "list" ? "list" : "board";
    clearDragUI();
    renderBoard();
    syncFilterUI();
    const url = new URL(window.location.href);
    if (state.viewMode === "list") url.searchParams.set("view", "list");
    else url.searchParams.delete("view");
    try { window.history.replaceState(window.history.state, "", url.href); } catch (error) { /* file previews may restrict history */ }
  }

  function setCardStyle(style) {
    state.cardStyle = style === "glass" ? "glass" : "focus";
    const scroll = $$(".column", boardEl).map((column) => ({ id: column.dataset.columnId, top: $(".column-body", column).scrollTop }));
    renderBoard();
    scroll.forEach(({ id, top }) => {
      const body = $(`.column[data-column-id="${id}"] .column-body`, boardEl);
      if (body) body.scrollTop = top;
    });
    const url = new URL(window.location.href);
    if (state.cardStyle === "glass") url.searchParams.set("cards", "glass");
    else url.searchParams.delete("cards");
    try { window.history.replaceState(window.history.state, "", url.href); } catch (error) { /* file preview history may be restricted */ }
    $("#cardStyleStatus").textContent = `${state.cardStyle === "glass" ? "Soft glass" : "Focus"} cards`;
  }

  function renderSummary() {
    const active = cards.filter((card) => !FB.isDone(card));
    const soon = active.filter((card) => card.due && helpers.daysUntil(card.due) >= 0 && helpers.daysUntil(card.due) <= 7).length;
    const overdue = active.filter((card) => card.due && helpers.daysUntil(card.due) < 0).length;
    const done = cards.filter(FB.isDone).length;

    $("#statTotal").textContent = cards.length;
    $("#statSoon").textContent = soon;
    $("#statOverdue").textContent = overdue;
    $("#statDone").textContent = done;
    $("#statOpen").textContent = active.length;
    $("#overdueNote").hidden = overdue === 0;
    $("#soonNote").hidden = soon === 0;
    [["#overdueNote", `${overdue} overdue card${overdue === 1 ? "" : "s"}`], ["#soonNote", `${soon} cards due in the next 7 days`]].forEach(([selector, label]) => {
      $(selector).setAttribute("aria-label", label);
      $(selector).removeAttribute("title");
      $(selector).dataset.tooltip = label;
    });

    const distribution = $("#distribution");
    const legend = $("#distLegend");
    const previous = new Map($$("[data-segment]", distribution).map((segment) => [segment.dataset.segment, segment.getBoundingClientRect()]));
    distribution.innerHTML = columns.map((column) => {
      const count = cards.filter((card) => card.columnId === column.id).length;
      const share = Math.round(count / Math.max(cards.length, 1) * 1000) / 10;
      const detail = `${column.name}\n${count} card${count === 1 ? "" : "s"} · ${share}% of all ${cards.length} cards`;
      return count ? `<span class="dist-${column.tone}" data-segment="${column.id}" style="flex:${count}" tabindex="0" role="img" aria-label="${escape(detail)}" data-tooltip="${escape(detail)}"></span>` : "";
    }).join("");
    distribution.setAttribute("aria-label", columns.map((column) => {
      const count = cards.filter((card) => card.columnId === column.id).length;
      return `${column.name}: ${count}`;
    }).join(", "));
    legend.innerHTML = columns.map((column) => {
      const count = cards.filter((card) => card.columnId === column.id).length;
      return `<span class="legend-item"><i class="dist-${column.tone}" aria-hidden="true"></i><span>${escape(column.name)}</span><strong>${count}</strong></span>`;
    }).join("");
    // Keep the distribution visually connected when a card changes columns.
    // Layout settles first; only transforms animate, and reduced motion skips it.
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && !document.hidden) {
      $$("[data-segment]", distribution).forEach((segment) => {
        const before = previous.get(segment.dataset.segment);
        const after = segment.getBoundingClientRect();
        if (!before || !before.width || !after.width || typeof segment.animate !== "function") return;
        const distance = before.left - after.left;
        const scale = before.width / after.width;
        if (Math.abs(distance) < 0.5 && Math.abs(scale - 1) < 0.005) return;
        segment.animate([
          { transform: `translateX(${distance}px) scaleX(${scale})` },
          { transform: "translateX(0) scaleX(1)" }
        ], { duration: 240, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
      });
    }
  }

  function syncFilterUI() {
    const selected = state.filters.assignees;
    const active = filtersActive();
    const assigneeBtn = $("#assigneeFilterBtn");
    const dueBtn = $("#dueFilterBtn");
    const assigneeBadge = $("#assigneeFilterCount");
    const dueBadge = $("#dueFilterCount");

    assigneeBtn.classList.toggle("has-active", selected.length > 0);
    dueBtn.classList.toggle("has-active", state.filters.due !== "any");
    assigneeBtn.setAttribute("aria-label", `Filter by assignee${selected.length ? `, ${selected.length} selected` : ""}`);
    const dueLabels = { any: "", overdue: ", overdue", soon: ", due in 7 days", none: ", no due date" };
    dueBtn.setAttribute("aria-label", `Filter by due date${dueLabels[state.filters.due] || ""}`);
    assigneeBadge.hidden = selected.length === 0;
    assigneeBadge.textContent = selected.length;
    dueBadge.hidden = state.filters.due === "any";
    dueBadge.textContent = "1";
    $("#clearFilters").hidden = !active;
    $("#searchField").classList.toggle("has-value", Boolean(state.filters.q));
    $("#filterHint").classList.toggle("is-visible", active && can("move") && state.viewMode === "board");
    $("#boardInteractionHint").textContent = !can("move")
      ? "Open a card to view its details"
      : state.viewMode === "list" ? "Use Move to change a card’s column" : "Drag cards, or use Move for keyboard and filtered views";

    const visible = visibleCards().length;
    const note = $("#resultNote");
    note.hidden = !active;
    note.innerHTML = active ? `<strong>${visible}</strong> of ${cards.length} match` : "";

    $$('input[name="assigneeFilter"]').forEach((input) => {
      input.checked = selected.includes(input.value);
    });
    $$('input[name="dueFilter"]').forEach((input) => {
      input.checked = input.value === state.filters.due;
    });
  }

  function renderAll() {
    FB.persistBoard?.();
    renderSummary();
    renderBoard();
    syncFilterUI();
  }

  function updateCurrentUser() {
    const user = FB.currentUser();
    const railAvatar = $("#railAvatar");
    const topbarAvatar = $("#topbarAvatar");
    [railAvatar, topbarAvatar].forEach((el) => {
      if (!el) return;
      el.className = `avatar ${user.tone}`;
      el.textContent = user.initials;
      el.title = user.name;
    });
    $("#railUserName").textContent = user.name;
    $("#railUserRole").textContent = user.role;
    topbarAvatar.closest(".topbar-user").setAttribute("aria-label", `Account settings for ${user.name}`);
  }

  function applyRole(role, announce) {
    if (!FB.roleMeta[role]) return;
    state.role = role;
    FB.syncBoardAccess?.();
    syncAppLinks();
    document.body.dataset.role = role;
    const roleSelect = $("#roleSelect");
    if (roleSelect) roleSelect.value = role;

    updateCurrentUser();
    const manage = can("manageBoard");
    $$("[data-manage-nav]").forEach((el) => { el.hidden = !manage; });
    $("#shareBtn").hidden = !can("invite");
    $("#addCardBtn").hidden = !can("edit");
    if (!can("edit")) {
      state.composerColumn = null;
      state.quickAddText = "";
      state.quickAddPriority = "";
      state.quickAddError = "";
    }

    $("#footRole").textContent = `${FB.roleMeta[role].label} · ${FB.roleMeta[role].description}`;
    renderAll();

    if (announce) {
      FB.toast(`Previewing as ${FB.currentUser().name} — ${FB.roleMeta[role].label.toLowerCase()}`, { tone: "success", icon: "eye" });
    }
  }

  function resetFilters(render) {
    state.filters = { q: "", assignees: [], due: "any" };
    const input = $("#searchInput");
    if (input) input.value = "";
    if (render !== false) renderAll();
  }

  function openComposer(columnId) {
    if (!can("edit")) return;
    state.composerColumn = columnId;
    state.quickAddText = "";
    state.quickAddPriority = "";
    state.quickAddError = "";
    renderBoard();
    const form = boardEl.querySelector(`[data-quick-add="${columnId}"]`);
    if (form) {
      const textarea = form.querySelector("textarea");
      textarea.focus();
      form.closest(".column").scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    }
  }

  function addCard(columnId) {
    if (!can("edit")) return;
    const form = boardEl.querySelector(`[data-quick-add="${columnId}"]`);
    const textarea = form ? form.querySelector("textarea") : null;
    const title = (state.quickAddText || (textarea ? textarea.value : "")).trim();
    const prioritySelect = form ? form.querySelector("[data-quick-add-priority]") : null;
    const priority = prioritySelect ? prioritySelect.value : state.quickAddPriority;
    if (!title) {
      FB.toast("Enter a card title first.", { tone: "danger", icon: "alert" });
      if (textarea) textarea.focus();
      return;
    }
    if (!["low", "medium", "high", "urgent"].includes(priority)) {
      state.quickAddError = "Choose Low, Medium, High, or Urgent before adding this card.";
      const error = form && form.querySelector("[data-quick-add-error]");
      if (error) {
        error.textContent = state.quickAddError;
        error.hidden = false;
      }
      if (prioritySelect) prioritySelect.focus();
      return;
    }

    const maxKey = cards.reduce((max, card) => {
      const n = Number((card.key || "").split("-")[1]);
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 100);
    const column = FB.column(columnId);
    const card = {
      id: `card_${Date.now()}`,
      key: `${(cards[0]?.key || `${(FB.boardContext?.name || "WEB").replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase() || "CARD"}-0`).split("-")[0]}-${maxKey + 1}`,
      projectId: FB.boardContext?.projectId,
      boardId: FB.boardContext?.boardId,
      title: title.slice(0, 200),
      description: "",
      columnId,
      priority,
      assignees: [],
      due: null,
      createdAt: new Date().toISOString(),
      images: [],
      comments: [],
      activity: [{
        id: `act_${Date.now()}`,
        actorId: FB.currentUser().id,
        icon: "plus",
        text: "created this card",
        at: new Date().toISOString()
      }]
    };

    const result = FB.createCard ? FB.createCard(card) : { ok: false, error: "Card creation is unavailable." };
    if (!result.ok) {
      state.quickAddError = result.error;
      const error = form && form.querySelector("[data-quick-add-error]");
      if (error) {
        error.textContent = state.quickAddError;
        error.hidden = false;
      }
      return;
    }
    state.composerColumn = null;
    state.quickAddText = "";
    state.quickAddPriority = "";
    state.quickAddError = "";
    renderAll();
    FB.toast(`Card added to ${column.name}`, {
      icon: "check",
      undo() {
        const index = cards.findIndex((c) => c.id === card.id);
        if (index >= 0) cards.splice(index, 1);
        renderAll();
        FB.toast("Card removed.");
      }
    });

    requestAnimationFrame(() => {
      const el = boardEl.querySelector(`[data-card-id="${card.id}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      const open = el.querySelector(".card-open");
      if (open) open.focus({ preventScroll: true });
    });
  }

  function moveCard(cardId, destColumnId, index) {
    if (!can("move")) {
      FB.toast("Viewers cannot move cards.", { tone: "danger", icon: "lock" });
      return;
    }
    const card = FB.card(cardId);
    const dest = FB.column(destColumnId);
    if (!card || !dest) return;

    const fromId = card.columnId;
    const from = FB.column(fromId);
    const previousOrder = cards.map((c) => c.id);
    const fromIndex = cards.filter((c) => c.columnId === fromId).findIndex((c) => c.id === cardId);
    const sameColumn = fromId === destColumnId;

    cards.splice(cards.indexOf(card), 1);
    const destCards = cards.filter((c) => c.columnId === destColumnId);
    const target = Math.max(0, Math.min(index, destCards.length));
    let insertAt;
    if (target >= destCards.length) {
      insertAt = destCards.length ? cards.indexOf(destCards[destCards.length - 1]) + 1 : cards.length;
    } else {
      insertAt = cards.indexOf(destCards[target]);
    }
    cards.splice(insertAt, 0, card);
    card.columnId = destColumnId;

    const event = {
      id: `act_${Date.now()}`,
      actorId: FB.currentUser().id,
      icon: "move",
      text: sameColumn ? `reordered this card in ${dest.name}` : `moved this card from ${from.name} to ${dest.name}`,
      at: new Date().toISOString()
    };
    card.activity.unshift(event);

    if (state.activeCardId === cardId) {
      if (state.draft) state.draft.columnId = destColumnId;
      if (FB.refreshDrawerAfterMove) FB.refreshDrawerAfterMove(card);
    }
    renderAll();

    FB.toast(`${card.key} moved to ${dest.name}`, {
      icon: "move",
      undo() {
        cards.sort((a, b) => previousOrder.indexOf(a.id) - previousOrder.indexOf(b.id));
        card.columnId = fromId;
        card.activity = card.activity.filter((e) => e.id !== event.id);
        if (state.activeCardId === cardId) {
          if (state.draft) state.draft.columnId = fromId;
          if (FB.refreshDrawerAfterMove) FB.refreshDrawerAfterMove(card);
        }
        renderAll();
        FB.toast("Move undone.");
      }
    });

    return { fromIndex, sameColumn };
  }

  function clearDragUI() {
    dragId = null;
    $$(".column.is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
    $$(".drop-line").forEach((el) => el.remove());
    $$(".card.is-dragging").forEach((el) => el.classList.remove("is-dragging"));
  }

  function bindDrag() {
    boardEl.addEventListener("dragstart", (event) => {
      const cardEl = event.target.closest(".card");
      if (!cardEl || !can("move") || filtersActive() || state.viewMode === "list") {
        event.preventDefault();
        return;
      }
      dragId = cardEl.dataset.cardId;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", dragId);
      requestAnimationFrame(() => cardEl.classList.add("is-dragging"));
    });

    boardEl.addEventListener("dragover", (event) => {
      if (!dragId || !can("move") || filtersActive()) return;
      const zone = event.target.closest(".column-cards");
      if (!zone) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const columnEl = zone.closest(".column");
      $$(".column.is-drop-target").forEach((el) => { if (el !== columnEl) el.classList.remove("is-drop-target"); });
      columnEl.classList.add("is-drop-target");

      let line = boardEl.querySelector(".drop-line");
      if (!line) {
        line = document.createElement("div");
        line.className = "drop-line";
        line.setAttribute("aria-hidden", "true");
      }
      const others = $$(".card", zone).filter((el) => el.dataset.cardId !== dragId);
      let before = null;
      for (const el of others) {
        const rect = el.getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) { before = el; break; }
      }
      zone.insertBefore(line, before || zone.querySelector(".column-empty") || null);
    });

    boardEl.addEventListener("dragleave", (event) => {
      const columnEl = event.target.closest(".column");
      if (!columnEl) return;
      if (event.relatedTarget && columnEl.contains(event.relatedTarget)) return;
      columnEl.classList.remove("is-drop-target");
    });

    boardEl.addEventListener("drop", (event) => {
      if (!dragId || !can("move") || filtersActive()) return;
      const zone = event.target.closest(".column-cards");
      if (!zone) return;
      event.preventDefault();
      const columnId = zone.dataset.dropZone;
      const line = zone.querySelector(".drop-line");
      let index = 0;
      if (line) {
        const children = Array.from(zone.children);
        const lineIndex = children.indexOf(line);
        index = children.slice(0, lineIndex)
          .filter((el) => el.classList.contains("card") && el.dataset.cardId !== dragId).length;
      } else {
        index = $$(".card", zone).filter((el) => el.dataset.cardId !== dragId).length;
      }
      const cardId = dragId;
      clearDragUI();
      moveCard(cardId, columnId, index);
    });

    boardEl.addEventListener("dragend", clearDragUI);
  }

  function bindBoard() {
    boardEl.addEventListener("click", (event) => {
      const actionEl = event.target.closest("[data-action]");
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      const cardId = actionEl.dataset.cardId;
      if (action === "open" && cardId) {
        if (FB.boardContext?.aggregate) {
          if (event.target.closest("a.card-open")) return;
          const destination = FB.aggregateCardHref(FB.card(cardId));
          if (destination) { event.preventDefault(); window.location.href = destination; }
          return;
        }
        event.preventDefault();
        const trigger = actionEl.matches(".card-open") ? actionEl : $(".card-open", actionEl);
        if (FB.openCard) FB.openCard(cardId, trigger || actionEl);
      } else if (action === "move" && cardId) {
        event.stopPropagation();
        if (FB.openMoveDialog) FB.openMoveDialog(cardId, actionEl);
      } else if (action === "add-open") {
        openComposer(actionEl.dataset.columnId);
      } else if (action === "add-cancel") {
        state.composerColumn = null;
        state.quickAddText = "";
        state.quickAddPriority = "";
        state.quickAddError = "";
        renderBoard();
        const trigger = boardEl.querySelector(`[data-action="add-open"][data-column-id="${actionEl.closest(".column").dataset.columnId}"]`);
        if (trigger) trigger.focus();
      } else if (action === "column-settings") {
        if (FB.openColumnDialog) FB.openColumnDialog(actionEl.dataset.columnId, actionEl);
      } else if (action === "show-more") {
        state.expandedCompleted = true;
        renderBoard();
        const showLess = boardEl.querySelector('[data-action="show-less"]');
        if (showLess) showLess.focus();
      } else if (action === "show-less") {
        state.expandedCompleted = false;
        renderBoard();
        const showMore = boardEl.querySelector('[data-action="show-more"]');
        if (showMore) showMore.focus();
      }
    });

    boardEl.addEventListener("keydown", (event) => {
      const textarea = event.target.closest("[data-quick-add-input]");
      if (textarea) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          const form = textarea.closest("form");
          if (form) form.requestSubmit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          const columnId = textarea.closest("[data-quick-add]").dataset.quickAdd;
          state.composerColumn = null;
          state.quickAddText = "";
          state.quickAddPriority = "";
          state.quickAddError = "";
          renderBoard();
          const trigger = boardEl.querySelector(`[data-action="add-open"][data-column-id="${columnId}"]`);
          if (trigger) trigger.focus();
        }
      }
    });

    boardEl.addEventListener("input", (event) => {
      if (event.target.matches("[data-quick-add-input]")) {
        state.quickAddText = event.target.value;
      }
    });

    boardEl.addEventListener("change", (event) => {
      if (event.target.matches("[data-quick-add-priority]")) {
        state.quickAddPriority = event.target.value;
        event.target.className = `quick-add-priority${state.quickAddPriority ? ` priority-${state.quickAddPriority}` : ""}`;
        state.quickAddError = "";
        const error = event.target.closest("form").querySelector("[data-quick-add-error]");
        if (error) {
          error.textContent = "";
          error.hidden = true;
        }
      }
    });

    boardEl.addEventListener("submit", (event) => {
      const form = event.target.closest("[data-quick-add]");
      if (!form) return;
      event.preventDefault();
      addCard(form.dataset.quickAdd);
    });
  }

  function bindFilters() {
    const search = $("#searchInput");
    search.addEventListener("input", () => {
      state.filters.q = search.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderAll, 120);
    });
    search.addEventListener("search", () => {
      state.filters.q = search.value;
      renderAll();
    });
    $("#clearSearch").addEventListener("click", () => {
      search.value = "";
      state.filters.q = "";
      renderAll();
      search.focus();
    });

    const assigneeBtn = $("#assigneeFilterBtn");
    const assigneeMenu = $("#assigneeMenu");
    const dueBtn = $("#dueFilterBtn");
    const dueMenu = $("#dueMenu");
    const displayBtn = $("#cardDisplaySettingsBtn");
    const displayMenu = $("#cardDisplayMenu");

    function closeMenus(except) {
      [[assigneeBtn, assigneeMenu], [dueBtn, dueMenu], [displayBtn, displayMenu]].forEach(([btn, menu]) => {
        if (menu === except) return;
        menu.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      });
    }

    function toggleMenu(btn, menu) {
      const willOpen = menu.hidden;
      closeMenus(willOpen ? menu : null);
      menu.hidden = !willOpen;
      btn.setAttribute("aria-expanded", String(willOpen));
      if (willOpen) {
        menu.style.left = ""; menu.style.right = "";
        const rect = menu.getBoundingClientRect();
        const anchor = btn.parentElement.getBoundingClientRect();
        if (rect.left < 8) { menu.style.left = `${8 - anchor.left}px`; menu.style.right = "auto"; }
        else if (rect.right > window.innerWidth - 8) { menu.style.right = `${anchor.right - window.innerWidth + 8}px`; menu.style.left = "auto"; }
        const first = menu.querySelector("input, button");
        if (first) first.focus();
      }
    }

    assigneeBtn.addEventListener("click", () => toggleMenu(assigneeBtn, assigneeMenu));
    dueBtn.addEventListener("click", () => toggleMenu(dueBtn, dueMenu));
    displayBtn.addEventListener("click", () => toggleMenu(displayBtn, displayMenu));
    $("#showCardImages").addEventListener("change", (event) => {
      state.showCardImages = event.target.checked;
      try { localStorage.setItem("flowboard-ui-card-images", String(state.showCardImages)); } catch (error) { /* preference still works for this session */ }
      renderBoard();
    });

    $$('input[name="assigneeFilter"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.filters.assignees = $$('input[name="assigneeFilter"]:checked').map((el) => el.value);
        renderAll();
      });
    });

    $("#clearAssigneeFilter").addEventListener("click", () => {
      state.filters.assignees = [];
      renderAll();
    });

    $$('input[name="dueFilter"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.filters.due = input.value;
        closeMenus();
        renderAll();
      });
    });

    $("#clearFilters").addEventListener("click", () => {
      resetFilters(true);
      closeMenus();
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".filter-wrap")) closeMenus();
    });

    $("#addCardBtn").addEventListener("click", () => {
      if (!can("edit")) return;
      if (filtersActive()) resetFilters(false);
      openComposer(columns[0].id);
    });
  }

  function syncAppLinks() {
    $$('[data-app-link]').forEach((link) => {
      if (FB.boardContext?.projectId && ["People", "Settings"].includes(link.dataset.nav)) {
        const page = link.dataset.nav.toLowerCase();
        link.href = `screens/${page}.html?${new URLSearchParams({ project: FB.boardContext.projectId, ...(FB.boardContext.boardId ? { board: FB.boardContext.boardId } : {}) })}`;
      }
      const target = new URL(link.href, window.location.href);
      target.searchParams.set("role", state.role);
      target.searchParams.set("theme", state.theme);
      link.href = `${target.pathname}${target.search}${target.hash}`;
    });
  }

  function setTheme(theme, announce) {
    state.theme = theme === "dark" ? "dark" : "light";
    syncAppLinks();
    document.documentElement.dataset.theme = state.theme;
    const toggle = $("#themeToggle");
    toggle.setAttribute("aria-pressed", String(state.theme === "dark"));
    toggle.setAttribute("aria-label", state.theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    try { localStorage.setItem("flowboard-ui-theme", state.theme); } catch (error) { /* file previews can block storage */ }
    if (announce) FB.toast(state.theme === "dark" ? "Dark theme on" : "Light theme on", { icon: state.theme === "dark" ? "moon" : "sun" });
  }

  function bindShell() {
    $("#cardStyleSelect").addEventListener("change", (event) => setCardStyle(event.target.value));
    $$("[data-board-view]").forEach((button) => {
      button.addEventListener("click", () => setBoardView(button.dataset.boardView));
    });
    $("#themeToggle").addEventListener("click", () => {
      setTheme(state.theme === "dark" ? "light" : "dark", true);
    });

    $$('[data-app-link]').forEach((link) => {
      link.addEventListener("click", () => { if (FB.closeNavigation) FB.closeNavigation(false); });
    });

    $("#roleSelect").addEventListener("change", async (event) => {
      const next = event.target.value;
      const previous = state.role;
      if (next === previous) return;
      if (state.dirty && state.activeCardId && FB.confirmAction) {
        const accepted = await FB.confirmAction({
          title: "Discard unsaved changes?",
          copy: "Switching preview roles closes this card and discards unsaved edits.",
          confirmLabel: "Discard & switch",
          tone: "danger",
          icon: "alert"
        });
        if (!accepted) {
          event.target.value = previous;
          return;
        }
      }
      if (FB.closeAllDialogs) FB.closeAllDialogs();
      if (FB.closeDrawerImmediately) FB.closeDrawerImmediately(false);
      applyRole(next, true);
    });

  }

  document.addEventListener("DOMContentLoaded", () => {
    boardEl = $("#board");
    boardEl.tabIndex = -1;
    let savedTheme = "light";
    try { savedTheme = localStorage.getItem("flowboard-ui-theme") || "light"; } catch (error) { savedTheme = "light"; }
    setTheme(savedTheme, false);
    bindShell();
    bindFilters();
    bindBoard();
    bindDrag();
    // Resolve the requested role before displaying the scoped board.
    const params = new URLSearchParams(window.location.search);
    applyRole(FB.roleMeta[params.get("role")] ? params.get("role") : "owner", false);

    // Design-review deep links, e.g. ?role=viewer&card=card_106&theme=dark
    if (params.get("theme") === "dark" || params.get("theme") === "light") {
      setTheme(params.get("theme"), false);
    }
    const cardParam = params.get("card");
    if (cardParam && can("read") && FB.card(cardParam)) {
      if (FB.boardContext?.aggregate) {
        const destination = FB.aggregateCardHref(FB.card(cardParam));
        if (destination) window.location.replace(destination);
      } else {
        setTimeout(() => { if (FB.openCard) FB.openCard(cardParam); }, 80);
      }
    }
  });

  FB.renderAll = renderAll;
  FB.renderBoard = renderBoard;
  FB.applyRole = applyRole;
  FB.moveCard = moveCard;
  FB.openComposer = openComposer;
  FB.resetFilters = resetFilters;
  FB.filtersActive = filtersActive;
  FB.visibleCards = visibleCards;
})();
