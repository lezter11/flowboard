/* Flowboard UI artifact — per-person inbox with unread and mention filters. */
(function () {
  "use strict";

  const SD = window.SD;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const escape = window.Screens.escape;
  const state = { filter: "all" };

  const params = new URLSearchParams(window.location.search);
  if (["all", "unread", "mention"].includes(params.get("filter"))) state.filter = params.get("filter");

  function me() { return window.Screens.currentUser(); }
  function items() { return SD.inboxFor(me().id); }

  const TYPE_ICON = {
    mention: "at",
    assignment: "user-check",
    import: "upload",
    restore: "restore",
    invite: "mail",
    comment: "comment"
  };

  function hrefFor(item) {
    if (item.cardId) return window.Screens.boardHref(item.cardId);
    if (item.type === "import") return window.Screens.screenHref("import", { sample: "clean", stage: "done" });
    if (item.type === "invite") return window.Screens.screenHref("people");
    return window.Screens.screenHref("projects");
  }

  function typeLabel(type) {
    return type === "mention" ? "Mention"
      : type === "assignment" ? "Assignment"
        : type === "import" ? "Import"
          : type === "restore" ? "Restore"
            : type === "invite" ? "Invitation"
              : "Comment";
  }

  function dayKey(iso) {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(date, today)) return "Today";
    if (same(date, yesterday)) return "Yesterday";
    return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(date);
  }

  function filtered() {
    let list = items();
    if (state.filter === "unread") list = list.filter((item) => !item.read);
    if (state.filter === "mention") list = list.filter((item) => item.type === "mention");
    return list.slice().sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  function unread() {
    return items().filter((item) => !item.read).length;
  }

  function updateBadges() {
    const list = items();
    const unreadCount = unread();
    const mentionCount = list.filter((item) => item.type === "mention").length;
    $("#allCount").textContent = list.length;
    $("#unreadCount").textContent = unreadCount;
    $("#mentionCount").textContent = mentionCount;
    $("#unreadBadge").textContent = `${unreadCount} unread`;
    $("#unreadBadge").className = `badge${unreadCount ? " accent" : ""}`;
    $("#markAllBtn").disabled = unreadCount === 0;
    $("#inboxOwnerBadge").textContent = `${me().name} · ${window.Screens.roleLabel()}`;
    $("#inboxSub").innerHTML = `<span>${unreadCount} unread</span><span class="dot" aria-hidden="true"></span><span>${list.length} notification${list.length === 1 ? "" : "s"}</span><span class="dot" aria-hidden="true"></span><span>Only ${escape(me().name)}</span>`;
    const badge = $('[data-nav-badge="inbox"]');
    if (badge) {
      badge.textContent = unreadCount || "";
      badge.hidden = unreadCount === 0;
    }
    $("#filterSummary").textContent = state.filter === "all"
      ? "All notifications"
      : state.filter === "unread"
        ? `${unreadCount} unread`
        : `${mentionCount} mention${mentionCount === 1 ? "" : "s"}`;
  }

  function rowHTML(item) {
    const actor = window.FB.person(item.actorId);
    const project = SD.project(item.projectId);
    const projectName = project ? project.name : "Project";
    const iconName = TYPE_ICON[item.type] || "bell";
    return `<div class="inbox-row${item.read ? "" : " unread"}" data-notification-id="${item.id}">
      <a class="inbox-main" href="${hrefFor(item)}" data-open-notification="${item.id}">
        <span class="inbox-icon ${item.type}" aria-hidden="true">${window.Screens.icon(iconName)}</span>
        <span class="inbox-copy">
          <span class="inbox-text"><strong>${escape(actor ? actor.name : "Someone")}</strong> ${escape(item.text)}</span>
          <span class="excerpt">${escape(item.excerpt)}</span>
          <span class="inbox-meta">
            <span>${escape(projectName)}</span>
            <span class="dot" aria-hidden="true"></span>
            <span>${escape(typeLabel(item.type))}</span>
            <span class="dot" aria-hidden="true"></span>
            <span>${escape(window.Screens.relativeTime(item.at))}</span>
            ${item.read ? "" : '<span class="unread-dot" aria-label="Unread"></span>'}
          </span>
        </span>
      </a>
      <div class="inbox-actions">
        <button class="icon-btn" type="button" data-toggle-read="${item.id}" aria-label="${item.read ? "Mark unread" : "Mark read"}" title="${item.read ? "Mark unread" : "Mark read"}">
          ${window.Screens.icon(item.read ? "refresh" : "check")}
        </button>
      </div>
    </div>`;
  }

  function renderList() {
    const list = filtered();
    const container = $("#inboxList");
    if (!list.length) {
      const copy = state.filter === "unread"
        ? "You are caught up. New mentions, assignments and import results will appear here."
        : state.filter === "mention"
          ? "No mentions yet. Mentions only include people who can access the card's project."
          : "No notifications yet. Comments, assignments and import results will appear here.";
      container.innerHTML = `<div class="empty-state">
        ${window.Screens.icon(state.filter === "unread" ? "check-circle" : "inbox")}
        <strong>${state.filter === "unread" ? "Nothing unread" : "No notifications"}</strong>
        <span>${escape(copy)}</span>
        ${state.filter !== "all" ? '<button class="btn sm" type="button" data-clear-filter>Show all notifications</button>' : ""}
      </div>`;
      return;
    }

    const groups = [];
    list.forEach((item) => {
      const key = dayKey(item.at);
      let group = groups.find((entry) => entry.key === key);
      if (!group) {
        group = { key, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    });

    container.innerHTML = groups.map((group) => `<div class="inbox-day">${escape(group.key)}</div>${group.items.map(rowHTML).join("")}`).join("");
  }

  function renderTabs() {
    $$("[data-inbox-filter]").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab.dataset.inboxFilter === state.filter));
    });
  }

  function render() {
    updateBadges();
    renderTabs();
    renderList();
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    if (state.filter === "all") url.searchParams.delete("filter");
    else url.searchParams.set("filter", state.filter);
    history.replaceState(null, "", url.pathname.split("/").pop() + url.search + url.hash);
  }

  function setFilter(filter) {
    state.filter = filter;
    updateUrl();
    render();
  }

  function toggleRead(id) {
    const item = items().find((entry) => entry.id === id);
    if (!item) return;
    item.read = !item.read;
    render();
    window.Screens.toast(item.read ? "Marked read." : "Marked unread.", { icon: item.read ? "check" : "refresh" });
  }

  function markAllRead() {
    const count = unread();
    if (!count) return;
    items().forEach((item) => { item.read = true; });
    render();
    window.Screens.toast(`${count} notification${count === 1 ? "" : "s"} marked read.`, { tone: "success", icon: "check-circle" });
  }

  function openNotification(event, id) {
    const item = items().find((entry) => entry.id === id);
    if (!item) return;
    item.read = true;
    updateBadges();
  }

  function bind() {
    $$("[data-inbox-filter]").forEach((tab) => {
      tab.addEventListener("click", () => setFilter(tab.dataset.inboxFilter));
    });
    $("#markAllBtn").addEventListener("click", markAllRead);
    $("#inboxList").addEventListener("click", (event) => {
      const clear = event.target.closest("[data-clear-filter]");
      if (clear) { setFilter("all"); return; }
      const toggle = event.target.closest("[data-toggle-read]");
      if (toggle) {
        event.preventDefault();
        toggleRead(toggle.dataset.toggleRead);
        return;
      }
      const open = event.target.closest("[data-open-notification]");
      if (open) openNotification(event, open.dataset.openNotification);
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
