/* Flowboard UI artifact — dialogs, confirmations, toasts and focus management. */
(function () {
  "use strict";

  const { state, columns, cards, people, helpers, can } = FB;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const escape = helpers.escapeHTML;

  const icon = (name, cls) =>
    `<svg class="icon${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

  let confirmState = null;
  let activeLayer = null;

  /* ---------- Toasts ---------- */
  function toast(message, options) {
    const opts = options || {};
    const container = $("#toasts");
    if (!container) return;
    while (container.children.length >= 3) container.firstElementChild.remove();

    const el = document.createElement("div");
    el.className = `toast${opts.tone ? " tone-" + opts.tone : ""}`;
    el.innerHTML = `${icon(opts.icon || (opts.tone === "danger" ? "alert" : "check"))}
      <span class="toast-message">${escape(message)}</span>
      ${opts.undo ? '<button class="toast-undo" type="button">Undo</button>' : ""}
      <button class="toast-close" type="button" aria-label="Dismiss notification">${icon("x")}</button>`;
    container.appendChild(el);

    let timer = setTimeout(remove, opts.undo ? 8000 : 4500);
    function remove() {
      clearTimeout(timer);
      if (!el.isConnected) return;
      el.style.opacity = "0";
      el.style.transform = "translateY(6px)";
      el.style.transition = "opacity .15s ease, transform .15s ease";
      setTimeout(() => el.remove(), 160);
    }
    el.querySelector(".toast-close").addEventListener("click", remove);
    const undoBtn = el.querySelector(".toast-undo");
    if (undoBtn) {
      undoBtn.addEventListener("click", () => {
        opts.undo();
        remove();
      });
    }
    el.addEventListener("mouseenter", () => clearTimeout(timer));
    el.addEventListener("mouseleave", () => { timer = setTimeout(remove, 2500); });
  }

  /* ---------- Layers & focus ---------- */
  function openLayer(layer, trigger) {
    if (!layer) return;
    layer._returnFocus = trigger || document.activeElement;
    layer.hidden = false;
    activeLayer = layer;
    requestAnimationFrame(() => {
      const preferred = layer.querySelector("[data-autofocus]")
        || layer.querySelector("input:checked")
        || layer.querySelector("input:not([type=hidden]), select, textarea, button");
      if (preferred) preferred.focus({ preventScroll: true });
      else layer.focus({ preventScroll: true });
    });
  }

  function closeLayer(layer) {
    if (!layer || layer.hidden) return;
    layer.hidden = true;
    const returnFocus = layer._returnFocus;
    layer._returnFocus = null;
    if (activeLayer === layer) activeLayer = null;
    requestAnimationFrame(() => {
      if (returnFocus && returnFocus.isConnected) {
        returnFocus.focus({ preventScroll: true });
      } else {
        const board = $("#board");
        if (board) board.focus({ preventScroll: true });
      }
    });
  }

  function visibleLayers() {
    return $$(".dialog-layer").filter((layer) => !layer.hidden);
  }

  function closeFilterMenus() {
    let closed = false;
    [["#assigneeFilterBtn", "#assigneeMenu"], ["#dueFilterBtn", "#dueMenu"]].forEach(([btnSel, menuSel]) => {
      const menu = $(menuSel);
      const btn = $(btnSel);
      if (menu && !menu.hidden) {
        menu.hidden = true;
        if (btn) btn.setAttribute("aria-expanded", "false");
        closed = true;
      }
    });
    return closed;
  }

  function closeAllDialogs() {
    if (confirmState) settleConfirm(false);
    visibleLayers().forEach((layer) => closeLayer(layer));
    closeFilterMenus();
    activeLayer = null;
  }

  function settleConfirm(value) {
    const current = confirmState;
    confirmState = null;
    const layer = $("#confirmLayer");
    if (layer && !layer.hidden) closeLayer(layer);
    if (current) current.resolve(value);
  }

  function confirmAction(options) {
    const opts = options || {};
    return new Promise((resolve) => {
      if (confirmState) settleConfirm(false);
      const layer = $("#confirmLayer");
      $("#confirmTitle").textContent = opts.title || "Are you sure?";
      $("#confirmCopy").textContent = opts.copy || "";
      const accept = $("#confirmAcceptBtn");
      accept.textContent = opts.confirmLabel || "Confirm";
      accept.className = `btn ${opts.tone === "danger" ? "danger" : "primary"}`;
      const iconWrap = $("#confirmIcon");
      iconWrap.className = `confirm-icon${opts.tone === "danger" ? " danger" : ""}`;
      iconWrap.innerHTML = icon(opts.icon || "alert");
      confirmState = { resolve };
      openLayer(layer, document.activeElement);
      setTimeout(() => {
        const cancel = $("#confirmCancelBtn");
        if (cancel && !layer.hidden) cancel.focus({ preventScroll: true });
      }, 30);
    });
  }

  function focusables(container) {
    return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', container)
      .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
  }

  function topContainer() {
    const confirmLayer = $("#confirmLayer");
    if (confirmLayer && !confirmLayer.hidden) return confirmLayer;
    const layers = visibleLayers();
    if (layers.length) return layers[layers.length - 1];
    const drawer = $("#cardDrawer");
    if (drawer && drawer.classList.contains("is-open")) return drawer;
    return null;
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (confirmState) {
        event.preventDefault();
        settleConfirm(false);
        return;
      }
      if (closeFilterMenus()) {
        event.preventDefault();
        return;
      }
      if (FB.closeNestedPickers && FB.closeNestedPickers()) {
        event.preventDefault();
        return;
      }
      const layers = visibleLayers();
      if (layers.length) {
        event.preventDefault();
        closeLayer(layers[layers.length - 1]);
        return;
      }
      const drawer = $("#cardDrawer");
      if (drawer && drawer.classList.contains("is-open")) {
        event.preventDefault();
        if (FB.requestCloseDrawer) FB.requestCloseDrawer();
        return;
      }
      const railScrim = $("#railScrim");
      if (railScrim && !railScrim.hidden) {
        event.preventDefault();
        railScrim.click();
      }
      return;
    }

    if (event.key === "Tab") {
      const container = topContainer();
      if (!container) return;
      const list = focusables(container);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (!container.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  /* ---------- Move dialog ---------- */
  function openMoveDialog(cardId, trigger) {
    if (!can("move")) {
      toast("Viewers cannot move cards.", { tone: "danger", icon: "lock" });
      return;
    }
    const card = FB.card(cardId);
    if (!card) return;
    state.moveCardId = cardId;
    const currentColumn = FB.column(card.columnId);

    $("#moveCardPreview").innerHTML = `
      <span class="card-key">${escape(card.key)}</span>
      <strong>${escape(card.title)}</strong>
      <span class="badge">${escape(currentColumn.name)}</span>`;

    $("#moveColumnList").innerHTML = columns.map((column) => {
      const count = cards.filter((item) => item.columnId === column.id && item.id !== card.id).length;
      const checked = column.id === card.columnId;
      return `<label class="radio-row${checked ? " is-selected" : ""}">
        <input type="radio" name="moveDest" value="${column.id}" ${checked ? "checked" : ""} />
        <span class="column-dot" style="background:var(--dot-${column.tone})" aria-hidden="true"></span>
        <span>${escape(column.name)}</span>
        <span class="count">${count} card${count === 1 ? "" : "s"}</span>
        <span class="check">${icon("check")}</span>
      </label>`;
    }).join("");

    $("#movePosition").value = "bottom";
    openLayer($("#moveLayer"), trigger);
  }

  function bindMoveDialog() {
    const list = $("#moveColumnList");
    list.addEventListener("change", (event) => {
      if (!event.target.matches('input[name="moveDest"]')) return;
      $$(".radio-row", list).forEach((row) => {
        const checked = row.querySelector("input").checked;
        row.classList.toggle("is-selected", checked);
      });
    });

    $("#moveConfirmBtn").addEventListener("click", () => {
      const selected = $('#moveColumnList input[name="moveDest"]:checked');
      if (!selected) return;
      const cardId = state.moveCardId;
      const destination = selected.value;
      const position = $("#movePosition").value;
      const remaining = cards.filter((card) => card.columnId === destination && card.id !== cardId);
      const index = position === "top" ? 0 : remaining.length;
      closeLayer($("#moveLayer"));
      FB.moveCard(cardId, destination, index);
    });
  }

  /* ---------- Column settings ---------- */
  function renderColumnPreview() {
    const name = ($("#columnName").value || "").trim() || "Untitled column";
    const preview = $("#settingsPreview");
    preview.dataset.tone = state.selectedColumnTone;
    $("#settingsPreviewName").textContent = name;
    const column = FB.column(state.columnEditId);
    const count = column ? cards.filter((card) => card.columnId === column.id).length : 0;
    preview.querySelector(".count").textContent = `${count} card${count === 1 ? "" : "s"}`;
  }

  function openColumnDialog(columnId, trigger) {
    if (!can("manageBoard")) {
      toast("Only managers and owners can configure columns.", { tone: "danger", icon: "lock" });
      return;
    }
    const column = FB.column(columnId);
    if (!column) return;
    state.columnEditId = columnId;
    state.selectedColumnTone = column.tone;
    $("#columnName").value = column.name;
    $("#columnNameError").hidden = true;
    $$("#colorOptions .color-swatch").forEach((swatch) => {
      const selected = swatch.dataset.tone === column.tone;
      swatch.classList.toggle("is-selected", selected);
      swatch.setAttribute("aria-checked", String(selected));
    });
    renderColumnPreview();
    openLayer($("#columnLayer"), trigger);
  }

  function bindColumnDialog() {
    $("#columnName").addEventListener("input", () => {
      $("#columnNameError").hidden = true;
      renderColumnPreview();
    });

    $$("#colorOptions .color-swatch").forEach((swatch) => {
      swatch.addEventListener("click", () => {
        state.selectedColumnTone = swatch.dataset.tone;
        $$("#colorOptions .color-swatch").forEach((item) => {
          const selected = item === swatch;
          item.classList.toggle("is-selected", selected);
          item.setAttribute("aria-checked", String(selected));
        });
        renderColumnPreview();
      });
    });

    $("#columnSaveBtn").addEventListener("click", () => {
      const name = $("#columnName").value.trim();
      if (!name) {
        $("#columnNameError").hidden = false;
        $("#columnName").focus();
        return;
      }
      const column = FB.column(state.columnEditId);
      if (!column) return;
      column.name = name.slice(0, 60);
      column.tone = state.selectedColumnTone;
      closeLayer($("#columnLayer"));
      FB.renderAll();
      if (FB.refreshDrawerAfterMove) FB.refreshDrawerAfterMove();
      toast("Column updated.", { icon: "check" });
    });
  }

  /* ---------- Share ---------- */
  function renderMemberList() {
    const base = ["alice", "charlie", "david", "eve"].map((id) => {
      const person = people[id];
      return `<div class="member-row">
        <span class="avatar ${person.tone}" aria-hidden="true">${person.initials}</span>
        <span class="member-copy"><strong>${escape(person.name)}</strong><span>${person.id}@example.com</span></span>
        <span class="member-role">${person.role}</span>
      </div>`;
    }).join("");

    const pending = (state.pendingInvites || []).map((invite) => {
      const initial = (invite.email[0] || "?").toUpperCase();
      return `<div class="member-row">
        <span class="avatar" aria-hidden="true">${escape(initial)}</span>
        <span class="member-copy"><strong>${escape(invite.email)}</strong><span>Invitation not sent in this prototype</span></span>
        <span class="member-role"><span class="badge warn">${escape(invite.role)} · pending</span></span>
      </div>`;
    }).join("");

    $("#memberList").innerHTML = base + pending;
  }

  function openShareDialog(trigger) {
    if (!can("invite")) {
      toast("Only owners and managers can invite people.", { tone: "danger", icon: "lock" });
      return;
    }
    renderMemberList();
    $("#inviteError").hidden = true;
    $("#inviteEmail").value = "";
    openLayer($("#shareLayer"), trigger);
  }

  function bindShareDialog() {
    $("#inviteBtn").addEventListener("click", () => {
      const email = $("#inviteEmail").value.trim();
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!valid) {
        $("#inviteError").hidden = false;
        $("#inviteEmail").focus();
        return;
      }
      $("#inviteError").hidden = true;
      state.pendingInvites = state.pendingInvites || [];
      state.pendingInvites.push({ email, role: $("#inviteRole").value });
      $("#inviteEmail").value = "";
      renderMemberList();
      toast("Invitation prepared. No email is sent in this design prototype.", { icon: "user-plus" });
    });

    $("#copyLinkBtn").addEventListener("click", async () => {
      const link = "https://flowboard.local/acme/website-redesign";
      try {
        await navigator.clipboard.writeText(link);
        toast("Project link copied.", { icon: "link" });
      } catch (error) {
        toast("Clipboard is unavailable in this preview.", { tone: "danger", icon: "alert" });
      }
    });
  }

  function bindDialogChrome() {
    $$("[data-close-dialog]").forEach((button) => {
      button.addEventListener("click", () => closeLayer($("#" + button.dataset.closeDialog)));
    });

    $$(".dialog-layer").forEach((layer) => {
      layer.addEventListener("click", (event) => {
        if (event.target !== layer) return;
        if (layer.id === "confirmLayer") {
          settleConfirm(false);
        } else {
          closeLayer(layer);
        }
      });
    });

    $("#confirmAcceptBtn").addEventListener("click", () => settleConfirm(true));
    $("#confirmCancelBtn").addEventListener("click", () => settleConfirm(false));

    $("#shareBtn").addEventListener("click", (event) => {
      if (!can("invite")) {
        toast("Only owners and managers can invite people.", { tone: "danger", icon: "lock" });
        return;
      }
      openShareDialog(event.currentTarget);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindDialogChrome();
    bindMoveDialog();
    bindColumnDialog();
    bindShareDialog();
  });

  FB.toast = toast;
  FB.openLayer = openLayer;
  FB.closeLayer = closeLayer;
  FB.confirmAction = confirmAction;
  FB.openMoveDialog = openMoveDialog;
  FB.openColumnDialog = openColumnDialog;
  FB.openShareDialog = openShareDialog;
  FB.closeAllDialogs = closeAllDialogs;
})();
