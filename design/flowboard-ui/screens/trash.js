/* Flowboard UI artifact — trash with an exact 24-hour server deadline. */
(function () {
  "use strict";

  const SD = window.SD;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const escape = window.Screens.escape;
  const PROJECT_ID = "website-redesign";
  const WINDOW_MS = 24 * 3600000;
  const OFFSETS = {
    active: (5 * 60 + 48) * 60000,
    expiring: (23 * 60 + 24) * 60000,
    expired: (24 * 60 + 12) * 60000
  };

  const params = new URLSearchParams(window.location.search);
  const initialSample = ["active", "expiring", "expired"].includes(params.get("state")) ? params.get("state") : "active";
  const state = {
    sample: initialSample,
    deletedAt: new Date(Date.now() - OFFSETS[initialSample]).toISOString(),
    lastStatus: null,
    restored: false
  };

  function me() { return window.Screens.currentUser(); }

  function items() {
    return SD.trashForProject(PROJECT_ID).map((item, index) => {
      const deletedAt = index === 0 ? state.deletedAt : item.deletedAt;
      return {
        ...item,
        deletedAt,
        deadline: new Date(new Date(deletedAt).getTime() + WINDOW_MS).toISOString()
      };
    });
  }

  function statusOf(item) {
    const remaining = new Date(item.deadline).getTime() - Date.now();
    if (remaining <= 0) return { key: "expired", label: "Expired", tone: "expired", remaining };
    if (remaining <= 3600000) return { key: "expiring", label: "Expiring soon", tone: "soon", remaining };
    return { key: "active", label: "Restorable", tone: "active", remaining };
  }

  function renderClock() {
    const clock = $("#serverClock");
    if (clock) {
      clock.textContent = `Server clock (simulated) · ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date())}`;
    }
  }

  function renderSummary(list) {
    const statuses = list.map(statusOf);
    const restorable = statuses.filter((status) => status.key !== "expired").length;
    const expiring = statuses.filter((status) => status.key === "expiring").length;
    const expired = statuses.filter((status) => status.key === "expired").length;
    $("#statTotal").textContent = list.length;
    $("#statRestorable").textContent = restorable;
    $("#statExpiring").textContent = expiring;
    $("#statExpired").textContent = expired;
    $("#trashCountBadge").textContent = `${list.length} card${list.length === 1 ? "" : "s"}`;
    $("#trashSub").textContent = `${restorable} restorable · ${expired} expired`;

    const primary = list[0];
    if (!primary) {
      $("#windowBar").innerHTML = '<span style="flex:1;background:var(--surface-3)"></span>';
      $("#windowLegend").innerHTML = "<span>Trash is empty</span>";
      return;
    }
    const remaining = Math.max(0, new Date(primary.deadline).getTime() - Date.now());
    const elapsed = Math.min(WINDOW_MS, WINDOW_MS - remaining);
    const isExpired = remaining <= 0;
    $("#windowBar").innerHTML = isExpired
      ? '<span style="flex:1;background:var(--danger)"></span>'
      : `<span style="flex:${Math.max(remaining, 1)};background:${remaining <= 3600000 ? "var(--warn)" : "var(--dot-completed)"}" title="Remaining ${escape(window.Screens.countdown(primary.deadline).label)}"></span><span style="flex:${Math.max(elapsed, 0.5)};background:var(--surface-3)" title="Elapsed"></span>`;
    $("#windowLegend").innerHTML = `<span><i style="background:${isExpired ? "var(--danger)" : remaining <= 3600000 ? "var(--warn)" : "var(--dot-completed)"}"></i>${isExpired ? "Expired" : remaining <= 3600000 ? "Expiring" : "Restorable"} ${escape(window.Screens.countdown(primary.deadline).label)}</span><span><i style="background:var(--surface-3)"></i>Elapsed</span>`;
  }

  function rowHTML(item) {
    const status = statusOf(item);
    const deletedBy = window.FB.person(item.deletedBy);
    const column = window.FB.column(item.columnId);
    const countdown = window.Screens.countdown(item.deadline);
    return `<tr class="trash-row" data-trash-id="${item.id}">
      <td>
        <div class="trash-card-cell">
          <span class="board-icon" style="width:28px;height:28px;border-radius:7px;">${window.Screens.icon("trash")}</span>
          <div>
            <span class="card-key">${escape(item.key)}</span>
            <strong>${escape(item.title)}</strong>
            <span>${item.commentCount} comment${item.commentCount === 1 ? "" : "s"} · ${item.imageCount} private image${item.imageCount === 1 ? "" : "s"} · ${escape(column ? column.name : "Unknown column")}</span>
          </div>
        </div>
        <div class="trash-mobile-meta">
          <div class="trash-mobile-line">
            ${window.Screens.avatar(item.deletedBy)}
            <div class="deadline">
              <strong>${escape(deletedBy ? deletedBy.name : "Unknown")}</strong>
              <span>deleted ${escape(window.Screens.relativeTime(item.deletedAt))}</span>
            </div>
          </div>
          <div class="trash-mobile-line">
            <div class="deadline">
              <strong>${escape(window.Screens.formatDeadline(item.deadline))}</strong>
              <span>${escape(countdown.label)} left · 24-hour server deadline</span>
            </div>
          </div>
          <div class="trash-mobile-foot">
            ${window.Screens.statusChip(status.label, status.tone)}
            <button class="btn sm ${status.key === "expired" ? "" : "primary"}" type="button" data-restore="${item.id}"${status.key === "expired" ? " disabled" : ""}>
              ${window.Screens.icon("restore")}${status.key === "expired" ? "Expired" : "Restore"}
            </button>
          </div>
        </div>
      </td>
      <td>
        <div class="row" style="gap:6px;flex-wrap:nowrap;">
          ${window.Screens.avatar(item.deletedBy)}
          <div class="deadline"><strong>${escape(deletedBy ? deletedBy.name : "Unknown")}</strong><span>${escape(window.Screens.relativeTime(item.deletedAt))}</span></div>
        </div>
      </td>
      <td>
        <div class="deadline">
          <strong>${escape(window.Screens.formatDeadline(item.deadline))}</strong>
          <span>deleted ${escape(window.Screens.formatDateTime(item.deletedAt))} + 24h</span>
        </div>
      </td>
      <td>
        <div class="deadline">
          <strong class="countdown ${status.key === "expired" ? "expired" : status.key === "expiring" ? "warn" : ""}" data-countdown-id="${item.id}">${escape(countdown.label)}</strong>
          <span>${window.Screens.statusChip(status.label, status.tone)}</span>
        </div>
      </td>
      <td>
        <div class="row" style="gap:5px;flex-wrap:nowrap;">
          <button class="btn sm ${status.key === "expired" ? "" : "primary"}" type="button" data-restore="${item.id}"${status.key === "expired" ? " disabled" : ""}>
            ${window.Screens.icon("restore")}${status.key === "expired" ? "Expired" : "Restore"}
          </button>
          ${status.key === "expired" ? '<span class="tiny faint nowrap">Gone state</span>' : ""}
        </div>
      </td>
    </tr>`;
  }

  function renderTable(list) {
    if (!list.length) {
      $("#trashTableWrap").innerHTML = `<div class="empty-state trash-empty">
        ${window.Screens.icon("trash")}
        <strong>Trash is empty</strong>
        <span>Deleted cards appear here for 24 hours. Nothing is waiting for restore in this prototype.</span>
        <a class="btn sm" href="${window.Screens.boardHref()}">Back to board</a>
      </div>`;
      $("#trashFootNote").textContent = "No deleted cards.";
      return;
    }
    $("#trashTableWrap").innerHTML = `<div class="trash-table-wrap"><table class="data-table">
      <thead><tr><th>Card</th><th>Deleted by</th><th>Restore deadline</th><th>Remaining</th><th>Action</th></tr></thead>
      <tbody>${list.map(rowHTML).join("")}</tbody>
    </table></div>`;
    const first = list[0];
    $("#trashFootNote").textContent = `Deadline is fixed at ${window.Screens.formatDeadline(first.deadline)}. The prototype selector changes only this sample timestamp.`;
  }

  function renderSelector() {
    $("#trashState").value = state.sample;
  }

  function render() {
    if (!window.Screens.can("browseTrash")) {
      renderDenied();
      return;
    }
    $("#trashContent").hidden = false;
    $("#trashDenied").hidden = true;
    $("#restoreSuccess").hidden = true;
    renderClock();
    renderSelector();
    const list = items();
    renderSummary(list);
    renderTable(list);
    $("#trashBoardLink").href = window.Screens.boardHref();
    $("#trashProjectLink").href = window.Screens.screenHref("project", { project: PROJECT_ID });
  }

  function renderDenied() {
    $("#trashContent").hidden = true;
    const denied = $("#trashDenied");
    denied.innerHTML = window.Screens.accessDenied({
      title: "Trash is limited to Owner and Manager",
      copy: `${me().name} is previewing the ${window.Screens.roleLabel()} role. Members can edit cards but cannot delete them. Viewers are read-only. Neither role can browse deleted comments or private images in trash.`,
      needed: "Owner or Manager",
      backHref: "../index.html",
      backLabel: "Back to board"
    });
    denied.hidden = false;
  }

  async function restore(itemId) {
    const item = items().find((entry) => entry.id === itemId);
    if (!item) return;
    const status = statusOf(item);
    if (status.key === "expired") {
      window.Screens.toast("The 24-hour restore deadline has passed. This card is in a gone state.", { tone: "danger", icon: "clock" });
      return;
    }
    const column = window.FB.column(item.columnId);
    const accepted = await window.Screens.confirm({
      title: `Restore ${item.key}?`,
      copy: `The card returns to ${column ? column.name : "its previous column"} with its comments and private images. The server deadline is ${window.Screens.formatDeadline(item.deadline)}. Restoring now does not extend or reset the 24-hour window.`,
      confirmLabel: "Restore card",
      tone: "primary",
      icon: "restore"
    });
    if (!accepted) return;

    const index = SD.trash.findIndex((entry) => entry.id === item.id);
    if (index >= 0) SD.trash.splice(index, 1);
    SD.accessEvents.unshift({
      id: `ev_restore_${Date.now()}`,
      scope: "access",
      category: "trash",
      actorId: me().id,
      icon: "restore",
      text: `restored ${item.key} to ${column ? column.name : "its previous column"}`,
      at: new Date().toISOString(),
      projectId: PROJECT_ID,
      target: item.key
    });
    state.restored = true;
    showSuccess(item, column);
    window.Screens.toast(`${item.key} restored before the server deadline.`, { tone: "success", icon: "restore" });
  }

  function showSuccess(item, column) {
    $("#trashContent").hidden = true;
    $("#restoreSuccess").hidden = false;
    $("#restoredKey").textContent = item.key;
    $("#restoredTitle").textContent = `${item.title} restored`;
    $("#restoredCopy").textContent = `The card returned to ${column ? column.name : "its previous column"} before the 24-hour server deadline. Comments and private images remain attached to the original card ID.`;
    $("#restoredColumn").textContent = column ? column.name : "Previous column";
    $("#restoredTime").textContent = window.Screens.formatDateTime(new Date().toISOString());
    $("#restoredBoardLink").href = window.Screens.boardHref();
  }

  function setSample(value) {
    if (!OFFSETS[value]) return;
    state.sample = value;
    state.deletedAt = new Date(Date.now() - OFFSETS[value]).toISOString();
    state.lastStatus = null;
    render();
    window.Screens.toast(`Prototype state: ${value === "active" ? "active restore window" : value === "expiring" ? "expiring soon" : "expired"}.`, { icon: "eye" });
  }

  function tick() {
    renderClock();
    if ($("#trashContent").hidden) return;
    const list = items();
    let needsRender = false;
    list.forEach((item) => {
      const status = statusOf(item);
      const el = document.querySelector(`[data-countdown-id="${item.id}"]`);
      if (el) {
        const countdown = window.Screens.countdown(item.deadline);
        if (el.textContent !== countdown.label) el.textContent = countdown.label;
        el.classList.toggle("expired", status.key === "expired");
        el.classList.toggle("warn", status.key === "expiring");
      }
      if (state.lastStatus !== status.key) {
        if (state.lastStatus !== null) needsRender = true;
        state.lastStatus = status.key;
      }
    });
    if (needsRender) render();
  }

  function bind() {
    $("#trashState").addEventListener("change", (event) => setSample(event.target.value));
    $("#refreshTrash").addEventListener("click", () => {
      render();
      window.Screens.toast("Trash refreshed from the simulated server clock.", { icon: "refresh" });
    });
    $("#trashTableWrap").addEventListener("click", (event) => {
      const button = event.target.closest("[data-restore]");
      if (button) restore(button.dataset.restore);
    });
    $("#restoredBack").addEventListener("click", () => {
      state.restored = false;
      $("#restoreSuccess").hidden = true;
      $("#trashContent").hidden = false;
      render();
    });
  }

  window.FBPage = {
    init() {
      bind();
      render();
      setInterval(tick, 1000);
    },
    render() {
      render();
    },
    beforeRoleChange() {
      return true;
    }
  };
})();
