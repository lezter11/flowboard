/* Flowboard UI artifact — role-scoped activity feed with filters. */
(function () {
  "use strict";

  const SD = window.SD;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const escape = window.Screens.escape;

  const state = { project: "all", actor: "all", category: "all", date: "all", limit: 10 };

  const CATEGORY = {
    cards: "Cards",
    comments: "Comments",
    moves: "Moves",
    assignments: "Assignments",
    images: "Images",
    status: "Status",
    due: "Due dates",
    access: "Access",
    trash: "Trash",
    import: "Import",
    settings: "Settings"
  };

  const CATEGORY_COLOR = {
    cards: "var(--dot-backlog)",
    comments: "var(--dot-progress)",
    moves: "var(--dot-testing)",
    assignments: "var(--accent)",
    images: "var(--warn)",
    status: "var(--dot-completed)",
    due: "var(--faint)",
    access: "var(--ink-soft)",
    trash: "var(--danger)",
    import: "var(--warn)",
    settings: "var(--muted)"
  };

  function me() { return window.Screens.currentUser(); }
  function canSeeAccess() { return window.Screens.can("manageProject"); }
  function accessibleProjects() { return SD.projects.filter((project) => project.memberIds.includes(me().id)); }

  function baseEvents() {
    const projects = accessibleProjects().map((project) => project.id);
    const events = SD.cardEvents.filter((event) => projects.includes(event.projectId));
    if (canSeeAccess()) {
      events.push(...SD.accessEvents.filter((event) => projects.includes(event.projectId)));
    }
    return events;
  }

  function filteredEvents() {
    let events = baseEvents();
    if (state.project !== "all") events = events.filter((event) => event.projectId === state.project);
    if (state.actor !== "all") events = events.filter((event) => event.actorId === state.actor);
    if (state.category !== "all") events = events.filter((event) => event.category === state.category);
    if (state.date !== "all") {
      const cutoff = Date.now() - Number(state.date) * 86400000;
      events = events.filter((event) => new Date(event.at).getTime() >= cutoff);
    }
    return events.sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  function dayKey(iso) {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(date, today)) return "Today";
    if (same(date, yesterday)) return "Yesterday";
    return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
  }

  function cardLink(event) {
    const card = event.cardId ? window.FB.card(event.cardId) : null;
    if (!card) return "";
    const project = SD.project(event.projectId);
    const label = `<span class="card-key">${escape(card.key)}</span> ${escape(card.title)}`;
    if (project && project.status === "active" && event.projectId === "website-redesign") {
      return `<a href="${window.Screens.boardHref(card.id)}">${label}</a>`;
    }
    return `<span>${label}</span>`;
  }

  function contextLink(event) {
    const project = SD.project(event.projectId);
    if (!project) return "";
    let href = window.Screens.screenHref("project", { project: project.id });
    if (event.category === "trash" && window.Screens.can("browseTrash")) href = window.Screens.screenHref("trash");
    else if (event.category === "import" && window.Screens.can("import")) href = window.Screens.screenHref("import");
    else if (event.category === "settings" && window.Screens.can("manageProject")) href = window.Screens.screenHref("settings", { tab: "board" });
    return `<a href="${href}">${escape(project.name)}</a>`;
  }

  function feedItem(event) {
    const actor = window.FB.person(event.actorId);
    const board = event.boardId ? SD.board(event.boardId) : null;
    const card = event.cardId ? window.FB.card(event.cardId) : null;
    const link = event.scope === "card" && card ? ` ${cardLink(event)}` : "";
    return `<div class="feed-item" data-event-id="${event.id}">
      ${window.Screens.avatar(event.actorId)}
      <div class="feed-main">
        <p class="feed-text"><strong>${escape(actor ? actor.name : "Someone")}</strong> ${escape(event.text)}${link}</p>
        <p class="feed-context">
          ${contextLink(event)}
          ${board ? `<span class="dot" aria-hidden="true"></span><span>${escape(board.name)}</span>` : ""}
          <span class="dot" aria-hidden="true"></span><span>${escape(CATEGORY[event.category] || "Event")}</span>
          <span class="dot" aria-hidden="true"></span><span>${escape(window.Screens.relativeTime(event.at))}</span>
          ${event.scope === "access" ? '<span class="dot" aria-hidden="true"></span><span class="status-chip plain">Access log</span>' : ""}
        </p>
      </div>
    </div>`;
  }

  function renderSummary(events) {
    const projects = new Set(events.map((event) => event.projectId));
    const actors = new Set(events.map((event) => event.actorId));
    const accessCount = events.filter((event) => event.scope === "access").length;
    $("#statShown").textContent = events.length;
    $("#statProjects").textContent = projects.size;
    $("#statPeople").textContent = actors.size;
    $("#statAccess").textContent = canSeeAccess() ? accessCount : "—";

    const categories = Object.keys(CATEGORY).filter((key) => canSeeAccess() || !["access", "trash", "import", "settings"].includes(key));
    const counts = categories.map((key) => ({
      key,
      count: events.filter((event) => event.category === key).length
    })).filter((entry) => entry.count > 0);
    const total = counts.reduce((sum, entry) => sum + entry.count, 0);
    $("#categoryHint").textContent = total ? `${counts.length} categories` : "No events";
    $("#categoryBars").innerHTML = total
      ? counts.map((entry) => `<span style="flex:${Math.max(entry.count, 0.4)};background:${CATEGORY_COLOR[entry.key]}" title="${escape(CATEGORY[entry.key])}: ${entry.count}"></span>`).join("")
      : '<span style="flex:1;background:var(--surface-3)"></span>';
    $("#categoryLegend").innerHTML = counts.length
      ? counts.slice(0, 5).map((entry) => `<span><i style="background:${CATEGORY_COLOR[entry.key]}"></i>${escape(CATEGORY[entry.key])} ${entry.count}</span>`).join("")
      : "<span>No events match these filters</span>";
  }

  function renderScope() {
    const projects = accessibleProjects();
    const scope = canSeeAccess()
      ? window.Screens.role === "owner" ? "Workspace activity" : "Project activity"
      : "Card activity";
    $("#scopeBadge").textContent = scope;
    $("#accessBadge").textContent = canSeeAccess() ? "Access events visible" : "Card history only";
    $("#accessBadge").className = `badge${canSeeAccess() ? " accent" : ""}`;
    $("#scopeCopy").innerHTML = canSeeAccess()
      ? window.Screens.role === "owner"
        ? `<strong>Owner scope.</strong> Card history and access events across all ${projects.length} projects you own.`
        : `<strong>Manager scope.</strong> Card history and access events for granted projects only. Sibling projects stay invisible.`
      : `<strong>Member and Viewer scope.</strong> Card history for granted projects only. Access, trash, import and settings events are not exposed.`;
    $("#scopeBar").className = `review-bar${canSeeAccess() ? "" : " note"}`;

    const projectLink = window.Screens.role === "owner"
      ? window.Screens.screenHref("projects")
      : window.Screens.screenHref("project", { project: "website-redesign" });
    $("#activityProjectLink").href = projectLink;
    $("#activityProjectLink").innerHTML = `${window.Screens.icon(window.Screens.role === "owner" ? "folder" : "board")}${window.Screens.role === "owner" ? "All projects" : "Project overview"}`;

    $("#activitySub").innerHTML = `<span>${escape(scope)}</span><span class="dot" aria-hidden="true"></span><span>${projects.length} accessible project${projects.length === 1 ? "" : "s"}</span><span class="dot" aria-hidden="true"></span><span>${canSeeAccess() ? "Card and access events" : "Card events only"}</span>`;
  }

  function option(value, label) {
    return `<option value="${escape(value)}">${escape(label)}</option>`;
  }

  function syncFilters() {
    const projects = accessibleProjects();
    if (state.project !== "all" && !projects.some((project) => project.id === state.project)) state.project = "all";
    $("#activityProject").innerHTML = [
      option("all", "All my projects"),
      ...projects.map((project) => option(project.id, project.name))
    ].join("");
    $("#activityProject").value = state.project;

    const actors = window.FB.people;
    const actorIds = Object.keys(actors).filter((id) => projects.some((project) => project.memberIds.includes(id)));
    if (state.actor !== "all" && !actorIds.includes(state.actor)) state.actor = "all";
    $("#activityActor").innerHTML = [
      option("all", "Anyone"),
      ...actorIds.map((id) => option(id, actors[id].name))
    ].join("");
    $("#activityActor").value = state.actor;

    const categories = Object.keys(CATEGORY).filter((key) => canSeeAccess() || !["access", "trash", "import", "settings"].includes(key));
    if (state.category !== "all" && !categories.includes(state.category)) state.category = "all";
    $("#activityAction").innerHTML = [
      option("all", "Any action"),
      ...categories.map((key) => option(key, CATEGORY[key]))
    ].join("");
    $("#activityAction").value = state.category;
    $("#activityDate").value = state.date;
  }

  function renderFeed(events) {
    const shown = events.slice(0, state.limit);
    const container = $("#feedPanel");
    $("#feedCount").textContent = `${events.length} event${events.length === 1 ? "" : "s"}`;
    $("#feedSub").textContent = canSeeAccess()
      ? "Card history and permitted access events, newest first."
      : "Card history only, newest first. Access events are hidden for this role.";
    $("#filterNote").textContent = events.length === baseEvents().length ? "No filters applied" : `${events.length} of ${baseEvents().length} events`;
    $("#loadNote").textContent = events.length
      ? `Showing ${shown.length} of ${events.length} event${events.length === 1 ? "" : "s"}`
      : "No matching events";
    $("#loadMoreBtn").hidden = shown.length >= events.length;
    $("#loadMoreBtn").disabled = shown.length >= events.length;

    if (!events.length) {
      container.innerHTML = `<div class="empty-state">
        ${window.Screens.icon("activity")}
        <strong>No activity matches</strong>
        <span>Try a wider date range or clear the person and action filters. Filters cannot reveal events outside your role scope.</span>
        <button class="btn sm" type="button" data-reset-filters>Reset filters</button>
      </div>`;
      return;
    }

    const groups = [];
    shown.forEach((event) => {
      const key = dayKey(event.at);
      let group = groups.find((entry) => entry.key === key);
      if (!group) {
        group = { key, events: [] };
        groups.push(group);
      }
      group.events.push(event);
    });
    container.innerHTML = `<div class="activity-feed">${groups.map((group) => `<div class="feed-day">${escape(group.key)}</div>${group.events.map(feedItem).join("")}`).join("")}</div>`;
  }

  function render() {
    renderScope();
    syncFilters();
    const events = filteredEvents();
    renderSummary(events);
    renderFeed(events);
  }

  function resetFilters() {
    state.project = "all";
    state.actor = "all";
    state.category = "all";
    state.date = "all";
    state.limit = 10;
    render();
    window.Screens.toast("Activity filters reset.", { icon: "refresh" });
  }

  function bind() {
    $("#activityProject").addEventListener("change", (event) => {
      state.project = event.target.value;
      state.limit = 10;
      render();
    });
    $("#activityActor").addEventListener("change", (event) => {
      state.actor = event.target.value;
      state.limit = 10;
      render();
    });
    $("#activityAction").addEventListener("change", (event) => {
      state.category = event.target.value;
      state.limit = 10;
      render();
    });
    $("#activityDate").addEventListener("change", (event) => {
      state.date = event.target.value;
      state.limit = 10;
      render();
    });
    $("#loadMoreBtn").addEventListener("click", () => {
      state.limit += 10;
      render();
    });
    $("#resetFilters").addEventListener("click", resetFilters);
    $("#feedPanel").addEventListener("click", (event) => {
      if (event.target.closest("[data-reset-filters]")) resetFilters();
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
      state.project = "all";
      state.actor = "all";
      state.category = "all";
      state.limit = 10;
      return true;
    }
  };
})();
