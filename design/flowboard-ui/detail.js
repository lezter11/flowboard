/* Flowboard UI artifact — card detail drawer, fields, images and save flow. */
(function () {
  "use strict";

  const { state, columns, cards, people, helpers, can } = FB;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const escape = helpers.escapeHTML;

  const icon = (name, cls) =>
    `<svg class="icon${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${name === "user" ? "users" : name}"></use></svg>`;

  const drawer = () => $("#cardDrawer");
  const scrim = () => $("#drawerScrim");

  function activeCard() {
    return state.activeCardId ? FB.card(state.activeCardId) : null;
  }

  function snapshot(card) {
    return {
      title: card.title,
      description: card.description || "",
      columnId: card.columnId,
      priority: card.priority || "none",
      due: card.due || "",
      assignees: card.assignees.slice()
    };
  }

  function normalized(draft) {
    return {
      title: (draft.title || "").trim(),
      description: draft.description || "",
      columnId: draft.columnId,
      priority: draft.priority || "none",
      due: draft.due || "",
      assignees: (draft.assignees || []).slice().sort()
    };
  }

  function isDirty() {
    const card = activeCard();
    if (!card || !state.draft) return false;
    return JSON.stringify(normalized(state.draft)) !== JSON.stringify(normalized(snapshot(card)));
  }

  function addActivity(card, activityIcon, text) {
    const event = {
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      actorId: FB.currentUser().id,
      icon: activityIcon,
      text,
      at: new Date().toISOString()
    };
    card.activity.unshift(event);
    return event;
  }
  FB.addActivity = addActivity;

  function autoGrow(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function updateDueFlag() {
    const flag = $("#detailDueFlag");
    const card = activeCard();
    if (!card || !state.draft) return;
    if (!state.draft.due) {
      flag.textContent = "No due date";
      flag.className = "due-flag";
      return;
    }
    const info = helpers.dueInfo({ due: state.draft.due, columnId: state.draft.columnId });
    if (info && info.state === "overdue") {
      flag.textContent = info.detail || "Overdue";
      flag.className = "due-flag";
    } else if (info && info.state === "done") {
      flag.textContent = "Completed column · date kept for history";
      flag.className = "due-flag ok";
    } else {
      flag.textContent = "Calendar date only · no time zone";
      flag.className = "due-flag ok";
    }
  }

  function updateDirtyUI() {
    const card = activeCard();
    if (!card || !state.draft) return;
    state.dirty = isDirty();
    const saveState = $("#saveState");
    saveState.classList.toggle("is-dirty", state.dirty);
    const saveLabel = state.dirty ? "Unsaved changes" : "All changes saved";
    if (saveState.dataset.state !== saveLabel) {
      saveState.dataset.state = saveLabel;
      saveState.innerHTML = `<span class="dot"></span>${saveLabel}`;
    }
    $("#saveBtn").disabled = !state.dirty;
    $("#discardBtn").disabled = !state.dirty;

    const column = FB.column(state.draft.columnId);
    const changedColumn = state.draft.columnId !== card.columnId;
    $("#drawerColumnBadge").textContent = `${column ? column.name : "Unknown column"}${changedColumn ? " · unsaved" : ""}`;
    updateDueFlag();
  }

  function assigneeChipsHTML() {
    const draft = state.draft;
    if (!draft) return "";
    if (!draft.assignees.length) return `<span class="hint">Unassigned</span>`;
    return draft.assignees.map((id) => {
      const person = FB.person(id);
      if (!person) return "";
      return `<span class="assignee-chip">
        <span class="avatar ${person.tone}" aria-hidden="true">${person.initials}</span>
        ${escape(person.name)}
        ${can("edit") ? `<button class="remove-assignee" type="button" data-remove-assignee="${person.id}" aria-label="Unassign ${escape(person.name)}">${icon("x")}</button>` : ""}
      </span>`;
    }).join("");
  }

  function renderAssignees() {
    const container = $("#detailAssignees");
    const draft = state.draft;
    if (!container || !draft) return;

    if (!can("edit")) {
      container.innerHTML = `<div class="assignee-chips">${assigneeChipsHTML()}</div>`;
      return;
    }

    const options = ["alice", "charlie", "david"].map((id) => {
      const person = people[id];
      return `<label class="assignee-option">
        <input type="checkbox" data-assignee="${person.id}" ${draft.assignees.includes(person.id) ? "checked" : ""} />
        <span class="avatar ${person.tone}" aria-hidden="true">${person.initials}</span>
        ${escape(person.name)}
        <span class="role-mini">${person.role}</span>
      </label>`;
    }).join("");

    container.innerHTML = `<div class="assignee-chips" id="assigneeChips">${assigneeChipsHTML()}</div>
      <details class="assignee-picker" id="assigneePicker">
        <summary class="add-assignee">${icon("plus")}Assign</summary>
        <div class="assignee-menu">
          <div class="menu-title">Assignable project people</div>
          ${options}
          <div class="menu-note">Viewers can read and be mentioned but cannot be assigned. Up to 20 assignees.</div>
        </div>
      </details>`;
  }

  function renderImages() {
    const card = activeCard();
    const grid = $("#imageGrid");
    if (!card || !grid) return;
    const current = FB.currentUser();

    grid.innerHTML = card.images.length
      ? card.images.map((image) => {
          const removable = can("upload") && (can("moderate") || image.uploaderId === current.id);
          return `<div class="image-tile">
            <img src="${image.src}" alt="Private image: ${escape(image.label)}" loading="lazy" />
            <span class="image-shade"></span>
            <span class="image-lock">${icon("lock")}Private</span>
            <span class="image-label">${escape(image.label)}</span>
            ${removable ? `<button class="image-remove" type="button" data-remove-image="${image.id}" aria-label="Remove image ${escape(image.label)}">${icon("x")}</button>` : ""}
          </div>`;
        }).join("")
      : `<div class="image-empty">${icon("image")}
          <strong>No images yet</strong>
          <span>${can("upload") ? "Upload a private reference or screenshot." : "Images stay hidden from people without project access."}</span>
        </div>`;

    $("#imageCount").textContent = `${card.images.length} / 10`;
    const upload = $("#uploadBtn");
    upload.hidden = !can("upload");
    upload.disabled = card.images.length >= 10;
    upload.title = card.images.length >= 10 ? "Remove an image before uploading another" : "Upload a private image";
  }

  function renderCore() {
    const card = activeCard();
    const draft = state.draft;
    if (!card || !draft) return;

    $("#drawerKey").textContent = card.key;
    const title = $("#detailTitle");
    title.value = draft.title;
    autoGrow(title);
    $("#detailDescription").value = draft.description;

    $("#detailStatus").innerHTML = columns.map((column) =>
      `<option value="${column.id}" ${column.id === draft.columnId ? "selected" : ""}>${escape(column.name)}</option>`
    ).join("");
    $("#detailPriority").value = draft.priority;
    $("#detailDue").value = draft.due;

    const created = [...card.activity].reverse().find((event) => event.icon === "plus") || card.activity[card.activity.length - 1];
    const creator = created ? FB.person(created.actorId) : null;
    $("#drawerCreated").textContent = creator ? `Created by ${creator.name} · ${helpers.relativeTime(created.at)}` : "Created";
    const latest = card.activity[0];
    $("#drawerUpdated").textContent = latest ? `Updated ${helpers.relativeTime(latest.at)}` : "No activity";

    const readOnly = !can("edit");
    title.disabled = readOnly;
    $("#detailDescription").disabled = readOnly;
    $("#detailStatus").disabled = readOnly;
    $("#detailPriority").disabled = readOnly;
    $("#detailDue").disabled = readOnly;
    $("#clearDueBtn").hidden = readOnly;

    const descriptionHint = $("#descriptionHint span");
    if (descriptionHint) {
      descriptionHint.textContent = can("comment")
        ? "Plain text. Use the comment composer for @mentions. Due dates are calendar dates, not times."
        : "Read-only. Viewers can read the description, comments and history but cannot edit or post. Due dates are calendar dates, not times.";
    }

    $("#drawerMoveBtn").hidden = !can("move");
    $("#drawerDeleteBtn").hidden = !can("deleteCard");
    $("#saveActions").hidden = readOnly;
    $("#saveState").hidden = readOnly;
    $("#readonlyFoot").hidden = !readOnly;

    renderAssignees();
    renderImages();
    updateDirtyUI();
    if (FB.renderDiscussion) FB.renderDiscussion(card);
  }

  function renderDrawer() {
    renderCore();
    const card = activeCard();
    if (card) {
      const latest = card.activity[0];
      $("#drawerUpdated").textContent = latest ? `Updated ${helpers.relativeTime(latest.at)}` : "No activity";
    }
  }

  function openCard(cardId, trigger) {
    const card = FB.card(cardId);
    if (!card) return;
    state.activeCardId = cardId;
    state.draft = snapshot(card);
    state.dirty = false;
    state.tab = "comments";
    state.commentDraft = "";
    state.editingCommentId = null;
    state.lastFocus = trigger || document.activeElement;

    const panel = drawer();
    const backdrop = scrim();
    panel.setAttribute("aria-label", `Card details: ${card.title}`);
    panel.setAttribute("aria-hidden", "false");
    panel.classList.add("is-open");
    backdrop.classList.add("is-open");
    document.body.style.overflow = "hidden";
    renderDrawer();
    requestAnimationFrame(() => {
      panel.focus({ preventScroll: true });
      const scroller = $(".drawer-scroll");
      if (scroller) scroller.scrollTop = 0;
    });
  }

  function closeDrawerImmediately(restoreFocus) {
    const card = activeCard();
    const focusTarget = state.lastFocus;
    const panel = drawer();
    if (!panel || !panel.classList.contains("is-open")) {
      state.activeCardId = null;
      state.draft = null;
      state.dirty = false;
      return;
    }

    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    scrim().classList.remove("is-open");
    document.body.style.overflow = "";
    state.activeCardId = null;
    state.draft = null;
    state.dirty = false;
    state.editingCommentId = null;
    state.commentDraft = "";
    state.tab = "comments";

    if (restoreFocus !== false) {
      requestAnimationFrame(() => {
        if (focusTarget && focusTarget.isConnected) focusTarget.focus({ preventScroll: true });
        else {
          const board = $("#board");
          if (board) board.focus({ preventScroll: true });
        }
      });
    }
  }

  async function requestCloseDrawer() {
    if (state.dirty) {
      const accepted = await FB.confirmAction({
        title: "Discard unsaved changes?",
        copy: "Your edits to this card have not been saved. Closing now will lose them.",
        confirmLabel: "Discard & close",
        tone: "danger",
        icon: "alert"
      });
      if (!accepted) return;
    }
    closeDrawerImmediately();
  }

  function discardDraft() {
    const card = activeCard();
    if (!card || !state.draft) return;
    state.draft = snapshot(card);
    state.dirty = false;
    renderDrawer();
    FB.toast("Changes discarded.", { icon: "undo" });
  }

  function saveDraft() {
    const card = activeCard();
    const draft = state.draft;
    if (!card || !draft || !can("edit")) return;

    const title = draft.title.trim();
    if (!title) {
      $("#detailTitle").setAttribute("aria-invalid", "true");
      FB.toast("A card title is required.", { tone: "danger", icon: "alert" });
      $("#detailTitle").focus();
      return;
    }
    if (title.length > 200) {
      FB.toast("Keep the title to 200 characters or fewer.", { tone: "danger", icon: "alert" });
      return;
    }
    if ((draft.description || "").length > 20000) {
      FB.toast("The description is too long.", { tone: "danger", icon: "alert" });
      return;
    }
    if (!FB.column(draft.columnId)) {
      FB.toast("Choose a valid destination column.", { tone: "danger", icon: "alert" });
      return;
    }
    if (draft.due && !helpers.parseDateOnly(draft.due)) {
      FB.toast("Enter a valid calendar date.", { tone: "danger", icon: "alert" });
      return;
    }
    if (draft.assignees.length > 20) {
      FB.toast("A card can have up to 20 assignees.", { tone: "danger", icon: "alert" });
      return;
    }

    const before = snapshot(card);
    const changes = [];
    if (before.title !== title) changes.push(["edit", "updated the title"]);
    if (before.description !== draft.description) changes.push(["edit", "updated the description"]);
    if (before.columnId !== draft.columnId) {
      const from = FB.column(before.columnId);
      const to = FB.column(draft.columnId);
      changes.push(["move", `moved this card from ${from.name} to ${to.name}`]);
    }
    if (before.priority !== draft.priority) {
      changes.push(["alert", `changed priority to ${draft.priority === "none" ? "None" : draft.priority[0].toUpperCase() + draft.priority.slice(1)}`]);
    }
    if (before.due !== draft.due) {
      changes.push(["calendar", draft.due ? `set the due date to ${helpers.formatShort(draft.due)}` : "removed the due date"]);
    }
    if (before.assignees.slice().sort().join(",") !== draft.assignees.slice().sort().join(",")) {
      changes.push(["user", "updated the assignees"]);
    }

    card.title = title;
    card.description = draft.description;
    card.columnId = draft.columnId;
    card.priority = draft.priority;
    card.due = draft.due || null;
    card.assignees = draft.assignees.slice();
    changes.forEach(([activityIcon, text]) => addActivity(card, activityIcon, text));
    $("#cardDrawer").setAttribute("aria-label", `Card details: ${card.title}`);

    state.draft = snapshot(card);
    state.dirty = false;
    $("#detailTitle").removeAttribute("aria-invalid");
    renderDrawer();
    FB.renderAll();
    FB.toast("Changes saved.", { tone: "success", icon: "check" });
    $("#detailTitle").focus({ preventScroll: true });
  }

  async function deleteCard() {
    const card = activeCard();
    if (!card || !can("deleteCard")) return;
    const accepted = await FB.confirmAction({
      title: "Move this card to trash?",
      copy: `“${card.title}” leaves the board now. It can be restored for 24 hours. Comments, images and history are kept.`,
      confirmLabel: "Move to trash",
      tone: "danger",
      icon: "trash"
    });
    if (!accepted) return;

    const index = cards.findIndex((item) => item.id === card.id);
    cards.splice(index, 1);
    closeDrawerImmediately(false);
    FB.renderAll();
    FB.toast("Card moved to trash. Restore within 24 hours.", {
      tone: "danger",
      icon: "trash",
      undo() {
        cards.splice(index, 0, card);
        FB.renderAll();
        FB.toast("Card restored to the board.", { tone: "success", icon: "undo" });
      }
    });
    const board = $("#board");
    if (board) board.focus({ preventScroll: true });
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function handleImageUpload(event) {
    const input = event.target;
    const card = activeCard();
    if (!card || !can("upload")) return;
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length) return;

    const allowed = ["image/png", "image/jpeg", "image/webp"];
    const remaining = 10 - card.images.length;
    if (remaining <= 0) {
      FB.toast("This card already has the maximum of 10 images.", { tone: "danger", icon: "alert" });
      return;
    }

    const valid = [];
    let rejected = 0;
    for (const file of files) {
      if (!allowed.includes(file.type) || file.size > 10 * 1024 * 1024 || valid.length >= remaining) {
        rejected += 1;
      } else {
        valid.push(file);
      }
    }
    if (!valid.length) {
      FB.toast("Use PNG, JPEG or WebP files up to 10 MiB each.", { tone: "danger", icon: "alert" });
      return;
    }

    const progress = $("#uploadProgress");
    progress.hidden = false;
    try {
      const compressed = await Promise.all(valid.map(file => window.compressCardImage(file)));
      const sources = await Promise.all(compressed.map(readFile));
      if (activeCard() !== card || !can("upload")) return;
      if (card.images.length + valid.length > 10) {
        FB.toast("The image limit changed while processing. Choose fewer images and try again.", { tone: "danger", icon: "alert" });
        return;
      }
      valid.forEach((file, index) => {
        card.images.push({
          id: `img_${Date.now()}_${index}`,
          label: file.name,
          src: sources[index],
          uploaderId: FB.currentUser().id,
          uploadedAt: new Date().toISOString()
        });
      });
      addActivity(card, "image", valid.length === 1 ? "added a private image" : `added ${valid.length} private images`);
      renderImages();
      if (FB.renderDiscussion) FB.renderDiscussion(card);
      FB.renderAll();
      FB.toast(valid.length === 1 ? "Image added to this local preview." : `${valid.length} images added to this local preview.`, { tone: "success", icon: "lock" });
      if (rejected) FB.toast(`${rejected} file${rejected === 1 ? " was" : "s were"} skipped. Use PNG, JPEG or WebP up to 10 MiB.`, { tone: "danger", icon: "alert" });
    } catch (error) {
      FB.toast("That image could not be read. Try another file.", { tone: "danger", icon: "alert" });
    } finally {
      setTimeout(() => { progress.hidden = true; }, 350);
    }
  }

  async function removeImage(imageId) {
    const card = activeCard();
    if (!card) return;
    const index = card.images.findIndex((image) => image.id === imageId);
    if (index < 0) return;
    const image = card.images[index];
    const removable = can("upload") && (can("moderate") || image.uploaderId === FB.currentUser().id);
    if (!removable) return;

    const accepted = await FB.confirmAction({
      title: "Remove this image?",
      copy: `“${image.label}” will be removed from the card. Other saved fields are not affected.`,
      confirmLabel: "Remove image",
      tone: "danger",
      icon: "image"
    });
    if (!accepted) return;

    card.images.splice(index, 1);
    const event = addActivity(card, "image", "removed a private image");
    renderImages();
    if (FB.renderDiscussion) FB.renderDiscussion(card);
    FB.renderAll();
    FB.toast("Image removed.", {
      icon: "image",
      undo() {
        card.images.splice(index, 0, image);
        card.activity = card.activity.filter((item) => item.id !== event.id);
        renderImages();
        if (FB.renderDiscussion) FB.renderDiscussion(card);
        FB.renderAll();
        FB.toast("Image restored.", { tone: "success", icon: "undo" });
      }
    });
  }

  function refreshDrawerAfterMove(card) {
    if (!card || card.id !== state.activeCardId || !state.draft) return;
    state.draft.columnId = card.columnId;
    $("#detailStatus").value = card.columnId;
    updateDirtyUI();
    $("#drawerColumnBadge").textContent = FB.column(card.columnId).name;
    if (FB.renderDiscussion) FB.renderDiscussion(card);
  }

  function bindDrawer() {
    $("#drawerCloseBtn").addEventListener("click", requestCloseDrawer);
    scrim().addEventListener("click", requestCloseDrawer);
    $("#saveBtn").addEventListener("click", saveDraft);
    $("#discardBtn").addEventListener("click", discardDraft);
    $("#drawerDeleteBtn").addEventListener("click", deleteCard);
    $("#drawerMoveBtn").addEventListener("click", (event) => {
      if (state.activeCardId && FB.openMoveDialog) FB.openMoveDialog(state.activeCardId, event.currentTarget);
    });

    $("#detailTitle").addEventListener("input", (event) => {
      if (!state.draft) return;
      state.draft.title = event.target.value;
      event.target.removeAttribute("aria-invalid");
      autoGrow(event.target);
      updateDirtyUI();
    });
    $("#detailDescription").addEventListener("input", (event) => {
      if (!state.draft) return;
      state.draft.description = event.target.value;
      updateDirtyUI();
    });
    $("#detailStatus").addEventListener("change", (event) => {
      if (!state.draft) return;
      state.draft.columnId = event.target.value;
      updateDirtyUI();
    });
    $("#detailPriority").addEventListener("change", (event) => {
      if (!state.draft) return;
      state.draft.priority = event.target.value;
      updateDirtyUI();
    });
    $("#detailDue").addEventListener("change", (event) => {
      if (!state.draft) return;
      state.draft.due = event.target.value;
      updateDirtyUI();
    });
    $("#clearDueBtn").addEventListener("click", () => {
      if (!state.draft || !can("edit")) return;
      state.draft.due = "";
      $("#detailDue").value = "";
      updateDirtyUI();
      $("#detailDue").focus();
    });

    $("#detailAssignees").addEventListener("change", (event) => {
      const checkbox = event.target.closest("input[data-assignee]");
      if (!checkbox || !state.draft) return;
      const id = checkbox.dataset.assignee;
      if (checkbox.checked) {
        if (!state.draft.assignees.includes(id)) state.draft.assignees.push(id);
      } else {
        state.draft.assignees = state.draft.assignees.filter((personId) => personId !== id);
      }
      const chips = $("#assigneeChips");
      if (chips) chips.innerHTML = assigneeChipsHTML();
      updateDirtyUI();
    });
    $("#detailAssignees").addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove-assignee]");
      if (!remove || !state.draft) return;
      const id = remove.dataset.removeAssignee;
      state.draft.assignees = state.draft.assignees.filter((personId) => personId !== id);
      const checkbox = $(`input[data-assignee="${id}"]`);
      if (checkbox) checkbox.checked = false;
      const chips = $("#assigneeChips");
      if (chips) chips.innerHTML = assigneeChipsHTML();
      updateDirtyUI();
    });

    $("#uploadBtn").addEventListener("click", () => $("#imageInput").click());
    $("#imageInput").addEventListener("change", handleImageUpload);
    $("#imageGrid").addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-image]");
      if (button) removeImage(button.dataset.removeImage);
    });

    document.addEventListener("click", (event) => {
      const picker = $("#assigneePicker");
      if (picker && picker.open && !event.target.closest("#assigneePicker")) picker.open = false;
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const panel = drawer();
    if (panel) panel.setAttribute("aria-hidden", "true");
    bindDrawer();
  });

  FB.openCard = openCard;
  FB.requestCloseDrawer = requestCloseDrawer;
  FB.closeDrawerImmediately = closeDrawerImmediately;
  FB.refreshDrawerAfterMove = refreshDrawerAfterMove;
  FB.closeNestedPickers = function () {
    let closed = false;
    const picker = $("#assigneePicker");
    if (picker && picker.open) { picker.open = false; closed = true; }
    if (FB.closeDiscussionPickers && FB.closeDiscussionPickers()) closed = true;
    return closed;
  };
})();
