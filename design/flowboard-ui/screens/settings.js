/* Flowboard UI artifact — project, board, account and appearance settings. */
(function () {
  "use strict";

  const SD = window.SD;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const escape = window.Screens.escape;
  let PROJECT_ID = "";
  let BOARD_ID = "";
  const TABS = ["project", "board", "account", "appearance"];
  const PASTELS = [
    { tone: "backlog", name: "Lavender", css: "lavender" },
    { tone: "progress", name: "Ice blue", css: "ice-blue" },
    { tone: "testing", name: "Mist grey", css: "mist-grey" },
    { tone: "completed", name: "Soft green", css: "soft-green" },
    { tone: "blocked", name: "Coral", css: "coral" },
    { tone: "rose", name: "Rose", css: "rose" },
    { tone: "mint", name: "Mint", css: "mint" },
    { tone: "peach", name: "Peach", css: "peach" },
    { tone: "butter", name: "Butter", css: "butter" },
    { tone: "iris", name: "Lilac", css: "lilac" }
  ];
  const PASTEL_TONES = new Set(PASTELS.map((choice) => choice.tone));

  const params = new URLSearchParams(window.location.search);
  const state = {
    tab: TABS.includes(params.get("tab")) ? params.get("tab") : "project",
    projectDirty: false,
    boardDirty: false,
    columnEdit: null,
    columns: []
  };

  function me() { return window.Screens.currentUser(); }
  function project() { return PROJECT_ID ? (window.Portfolio ? window.Portfolio.project(PROJECT_ID) : SD.project(PROJECT_ID)) : null; }
  function board() {
    const b = BOARD_ID ? (window.Portfolio ? window.Portfolio.board(BOARD_ID) : SD.board(BOARD_ID)) : null;
    return b && b.projectId === PROJECT_ID ? b : null;
  }
  function supportsMutation() { return !window.Portfolio && Boolean(SD.project(PROJECT_ID) && SD.board(BOARD_ID)); }
  function defaultColumns() {
    const source = BOARD_ID === "board_website" ? window.FB.columns : window.Portfolio?.columns(BOARD_ID);
    const columns = source?.length ? source : [
      { id: `${BOARD_ID || "board"}_todo`, name: "Not started", tone: "backlog", category: "todo" },
      { id: `${BOARD_ID || "board"}_active`, name: "In progress", tone: "progress", category: "active" },
      { id: `${BOARD_ID || "board"}_done`, name: "Completed", tone: "completed", category: "done" }
    ];
    return columns.map((column) => ({
      ...column,
      tone: PASTEL_TONES.has(column.tone) ? column.tone : "backlog",
      category: column.category || (column.id === "col_backlog" ? "todo" : column.id === "col_completed" ? "done" : "active"),
      cardCount: BOARD_ID === "board_website" ? window.FB.cards.filter((card) => card.columnId === column.id).length : 0
    }));
  }
  function memberRecord(personId) {
    const p = project();
    return p?.memberIds.includes(personId) ? SD.members.find((member) => member.personId === personId) || null : null;
  }
  function canManageProject() { return supportsMutation() && window.Screens.can("manageProject") && Boolean(project()?.memberIds.includes(me().id)); }
  function canManageBoard() { return supportsMutation() && window.Screens.can("manageBoard") && Boolean(project()?.memberIds.includes(me().id)) && Boolean(board()); }
  function canArchive() { return supportsMutation() && window.Screens.can("archiveProject") && project()?.ownerId === me().id; }
  function projectArchived() { const p = project(); return Boolean(p && p.status === "archived"); }

  function renderHeader() {
    const p = project();
    $("#settingsProjectName").textContent = p ? p.name : "Project";
    $("#settingsSub").textContent = p ? p.name : "Project settings";
    $("#settingsRoleBadge").textContent = `${window.Screens.roleLabel()} preview`;
    $("#settingsProjectLink").href = window.Screens.screenHref("project", { project: PROJECT_ID });
    $("#settingsBoardLink").href = window.Screens.boardHref();
  }

  function renderTabs() {
    $$("[data-settings-tab]").forEach((tab) => {
      const selected = tab.dataset.settingsTab === state.tab;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    $$("#settingsPanels > [role=tabpanel]").forEach((panel) => {
      panel.hidden = panel.id !== `panel-${state.tab}`;
    });
    const url = new URL(window.location.href);
    if (state.tab === "project") url.searchParams.delete("tab");
    else url.searchParams.set("tab", state.tab);
    history.replaceState(null, "", url.pathname.split("/").pop() + url.search + url.hash);
  }

  function markProjectDirty() {
    state.projectDirty = true;
    const note = $("#projectDirty");
    note.classList.add("is-dirty");
    note.innerHTML = '<span class="dot"></span>Unsaved project changes';
  }

  function clearProjectDirty() {
    state.projectDirty = false;
    const note = $("#projectDirty");
    note.classList.remove("is-dirty");
    note.innerHTML = '<span class="dot"></span>No unsaved changes';
  }

  function markBoardDirty() {
    state.boardDirty = true;
    const note = $("#boardDirty");
    note.classList.add("is-dirty");
    note.innerHTML = '<span class="dot"></span>Unsaved board changes';
  }

  function clearBoardDirty() {
    state.boardDirty = false;
    const note = $("#boardDirty");
    note.classList.remove("is-dirty");
    note.innerHTML = '<span class="dot"></span>No unsaved changes';
  }

  function renderProject() {
    const p = project();
    if (!p) return;
    const editable = canManageProject() && !projectArchived();
    $("#projectName").value = p.name;
    $("#projectDescription").value = p.description;
    $("#projectName").disabled = !editable;
    $("#projectDescription").disabled = !editable;
    $("#saveProjectBtn").disabled = !editable;
    $("#projectStatusBadge").textContent = projectArchived() ? "Archived" : "Active";
    $("#projectStatusBadge").className = `badge${projectArchived() ? "" : " accent"}`;
    $("#projectSettingsSub").textContent = `Name and description for ${p.name}.`;
    $("#projectRoleNote").innerHTML = !supportsMutation()
      ? `<svg class="icon" aria-hidden="true"><use href="#i-lock"></use></svg><span>Project editing is not connected in this preview.</span>`
      : canManageProject()
      ? projectArchived()
        ? `<svg class="icon" aria-hidden="true"><use href="#i-lock"></use></svg><span>This project is archived. Reopen it before changing its name, description or boards.</span>`
        : `<svg class="icon" aria-hidden="true"><use href="#i-shield"></use></svg><span>You can rename and describe this project. ${canArchive() ? "You can also archive or reopen it." : "Archiving is Owner-only."}</span>`
      : `<svg class="icon" aria-hidden="true"><use href="#i-lock"></use></svg><span>Your role can read project settings but cannot change them. Ask the Owner or a Manager for changes.</span>`;
    $("#projectRoleNote").className = `note${editable ? "" : " warn"}`;

    if (canArchive()) {
      $("#archiveRow").innerHTML = projectArchived()
        ? `<span class="status-chip archived plain">Archived</span><span class="small muted">Boards are read-only. Reopen to edit again.</span><span class="spacer"></span><button class="btn sm soft" type="button" data-reopen-project>${window.Screens.icon("restore")}Reopen project</button>`
        : `<span class="status-chip active plain">Active</span><span class="small muted">Archiving is reversible and Owner-only.</span><span class="spacer"></span><button class="btn sm ghost" type="button" data-archive-project>${window.Screens.icon("archive")}Archive project</button>`;
    } else {
      $("#archiveRow").innerHTML = `<span class="status-chip ${projectArchived() ? "archived" : "active"} plain">${projectArchived() ? "Archived" : "Active"}</span><span class="small muted">Only the Owner can archive or reopen this project.</span>`;
    }
    bindProjectActions();
  }

  function bindProjectActions() {
    const archive = $("[data-archive-project]", $("#archiveRow"));
    if (archive) archive.addEventListener("click", archiveProject);
    const reopen = $("[data-reopen-project]", $("#archiveRow"));
    if (reopen) reopen.addEventListener("click", reopenProject);
  }

  function renderColumns() {
    const editable = canManageBoard() && !projectArchived();
    $("#columnList").innerHTML = state.columns.map((column, index) => {
      const removeBlocked = column.cardCount > 0 || state.columns.length <= 1;
      const removeTitle = column.cardCount > 0
        ? `Cannot remove ${column.name}: ${column.cardCount} active card${column.cardCount === 1 ? "" : "s"} reference this column.`
        : "Cannot remove the final column.";
      return `<div class="column-row settings-column-row" data-tone="${escape(column.tone)}" data-column-id="${escape(column.id)}">
        <span class="column-dot" aria-hidden="true"></span>
        <span class="col-copy">
          <span class="col-name">${escape(column.name)}</span>
          <span class="col-meta">${escape(column.category)}</span>
        </span>
        <span class="col-actions">
          <button class="icon-btn" type="button" data-move-column="${column.id}" data-direction="-1" aria-label="Move ${escape(column.name)} up" title="Move up"${!editable || index === 0 ? " disabled" : ""}>${window.Screens.icon("chevron-up")}</button>
          <button class="icon-btn" type="button" data-move-column="${column.id}" data-direction="1" aria-label="Move ${escape(column.name)} down" title="Move down"${!editable || index === state.columns.length - 1 ? " disabled" : ""}>${window.Screens.icon("chevron-down")}</button>
          <button class="icon-btn" type="button" data-rename-column="${column.id}" aria-label="Rename ${escape(column.name)}" title="Rename"${editable ? "" : " disabled"}>${window.Screens.icon("edit")}</button>
          <button class="icon-btn" type="button" data-remove-column="${column.id}" aria-label="Remove ${escape(column.name)}" title="${escape(removeTitle)}"${!editable || removeBlocked ? " disabled" : ""}>${window.Screens.icon("trash")}</button>
        </span>
      </div>`;
    }).join("");
    $("#addColumnBtn").disabled = !editable || state.columns.length >= 12;
    $("#resetColumnsBtn").disabled = !editable;
    $("#columnNote").textContent = editable
      ? `${state.columns.length} of 12 columns. Changes are preview-only; the approved board artifact is not modified.`
      : "Column editing is not connected in this preview.";
    bindColumnActions();
  }

  function bindColumnActions() {
    $$("[data-move-column]", $("#columnList")).forEach((button) => {
      button.addEventListener("click", () => moveColumn(button.dataset.moveColumn, Number(button.dataset.direction)));
    });
    $$("[data-rename-column]", $("#columnList")).forEach((button) => {
      button.addEventListener("click", () => openColumnDialog("rename", button.dataset.renameColumn));
    });
    $$("[data-remove-column]", $("#columnList")).forEach((button) => {
      button.addEventListener("click", () => removeColumn(button.dataset.removeColumn));
    });
  }

  function renderBoard() {
    const b = board();
    if (!b) return;
    const editable = canManageBoard() && !projectArchived();
    $("#boardName").value = b.name;
    $("#boardDescription").value = b.description;
    $("#boardName").disabled = !editable;
    $("#boardDescription").disabled = !editable;
    $("#saveBoardBtn").disabled = !editable;
    $("#boardStatusBadge").textContent = projectArchived() ? "Read-only" : "Active";
    $("#boardStatusBadge").className = `badge${projectArchived() ? "" : " accent"}`;
    $("#boardSettingsSub").textContent = `Board name and column order for ${b.name}.`;
    $("#boardRoleNote").innerHTML = !supportsMutation()
      ? `<svg class="icon" aria-hidden="true"><use href="#i-lock"></use></svg><span>Board editing is not connected in this preview.</span>`
      : canManageBoard()
      ? projectArchived()
        ? `<svg class="icon" aria-hidden="true"><use href="#i-lock"></use></svg><span>This project is archived. Reopen it before changing board settings or columns.</span>`
        : `<svg class="icon" aria-hidden="true"><use href="#i-shield"></use></svg><span>You can rename this board and change its column order. Removing a column with cards is blocked with an explanation.</span>`
      : `<svg class="icon" aria-hidden="true"><use href="#i-lock"></use></svg><span>Only Owner and Manager can change board settings or columns. Your role can read them.</span>`;
    $("#boardRoleNote").className = `note${editable ? "" : " warn"}`;
    renderColumns();
  }

  function renderAccount() {
    const user = me();
    const record = memberRecord(user.id);
    $("#accountAvatar").className = `avatar xl ${user.tone}`;
    $("#accountAvatar").textContent = user.initials;
    $("#accountName").textContent = user.name;
    $("#accountEmail").textContent = record ? record.email : "No project email";
    $("#accountRole").textContent = window.Screens.roleLabel();
    $("#accountRoleBadge").textContent = window.Screens.roleLabel();
    $("#accountDisplayName").value = user.name;
    $("#accountEmailField").value = record ? record.email : "";
    const projects = SD.projects.filter((p) => p.memberIds.includes(user.id));
    $("#accountProjects").innerHTML = projects.length
      ? projects.map((p) => {
        const member = memberRecord(user.id);
        return `<div class="person-row">
          <span class="project-mark sm ${p.tone}" aria-hidden="true">${escape(p.mark)}</span>
          <div class="person-copy"><strong>${escape(p.name)}</strong><span>${p.status === "archived" ? "Archived" : "Active"} · ${escape(member ? member.role : "Granted")}</span></div>
          <a class="btn sm ghost" href="${window.Screens.screenHref("project", { project: p.id })}">Open</a>
        </div>`;
      }).join("")
      : `<div class="empty-state" style="padding:18px 8px;"><strong>No project grants</strong><span>This account cannot see any project.</span></div>`;
  }

  function updateThemeUI() {
    const theme = window.Screens.theme;
    $$("[data-theme-choice]").forEach((card) => {
      const selected = card.dataset.themeChoice === theme;
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    });
    $("#themeBadge").textContent = theme === "dark" ? "Dark" : "Light";
  }

  function renderAppearance() {
    updateThemeUI();
  }

  function renderScope() {
    const role = window.Screens.role;
    $("#scopeSub").textContent = `${window.Screens.roleLabel()} preview`;
    const rows = [];
    if (role === "owner") {
      rows.push("Edit project name and description.");
      rows.push("Edit board name and column order.");
      rows.push("Archive or reopen the project.");
      rows.push("Invite people and grant Manager.");
      rows.push("Import cards, browse trash and see access events.");
    } else if (role === "manager") {
      rows.push("Edit project name and description.");
      rows.push("Edit board name and column order.");
      rows.push("Invite Member/Viewer and change their grants.");
      rows.push("Import cards, browse trash and see access events.");
      rows.push("Cannot archive the project or grant Manager.");
    } else if (role === "member") {
      rows.push("Read project and board settings.");
      rows.push("Create, edit and move cards.");
      rows.push("Comment and upload private images.");
      rows.push("Cannot change settings, invite people, import or browse trash.");
    } else {
      rows.push("Read project and board settings.");
      rows.push("Read cards, comments and private images.");
      rows.push("Cannot edit cards, comment, upload, import or browse trash.");
      rows.push("Cannot invite people or change any grant.");
    }
    $("#scopePanel").innerHTML = rows.map((row) => `<div class="hub-coverage-item">${window.Screens.icon(role === "viewer" && row.startsWith("Cannot") ? "x" : "check")}<span>${escape(row)}</span></div>`).join("") + `<div class="note">${window.Screens.icon("shield")}<span>${escape(window.Screens.roleMeta[role].description)}. The API enforces this on every request.</span></div>`;
  }

  function render() {
    if (!window.Screens.projectContext.valid || !PROJECT_ID || !project() || !board()) {
      $("#settingsSub").textContent = "This project or board context is unavailable.";
      $("#settingsProjectName").textContent = "Project";
      $(".page-actions").hidden = true;
      $(".review-bar").hidden = true;
      $(".settings-tabs").hidden = true;
      $("#settingsPanels").hidden = true;
      $("#projectName").value = "";
      $("#projectDescription").value = "";
      $("#boardName").value = "";
      $("#boardDescription").value = "";
      $("#accountName").textContent = "";
      $("#accountEmail").textContent = "";
      $("#accountDisplayName").value = "";
      $("#accountEmailField").value = "";
      return;
    }
    $(".page-actions").hidden = false;
    $(".review-bar").hidden = false;
    $(".settings-tabs").hidden = false;
    $("#settingsPanels").hidden = false;
    renderHeader();
    renderTabs();
    renderProject();
    renderBoard();
    renderAccount();
    renderAppearance();
    renderScope();
  }

  function setTab(tab) {
    if (!TABS.includes(tab)) return;
    state.tab = tab;
    renderTabs();
    const target = $(`#tab-${tab}`);
    if (target) target.focus({ preventScroll: true });
  }

  function moveColumn(id, direction) {
    if (!canManageBoard() || projectArchived()) return;
    const index = state.columns.findIndex((column) => column.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= state.columns.length) return;
    const [column] = state.columns.splice(index, 1);
    state.columns.splice(next, 0, column);
    markBoardDirty();
    renderColumns();
  }

  function openColumnDialog(mode, id) {
    if (!canManageBoard() || projectArchived()) return;
    const column = id ? state.columns.find((entry) => entry.id === id) : null;
    state.columnEdit = { mode, id: id || null };
    $("#columnDialogTitle").textContent = mode === "rename" ? "Edit column" : "Add a column";
    $("#columnSubmitBtn").textContent = mode === "rename" ? "Save column" : "Add column";
    $("#columnName").value = column ? column.name : "";
    const tone = column && PASTEL_TONES.has(column.tone) ? column.tone : "backlog";
    renderPastelChoices(tone);
    $("#columnColorError").hidden = true;
    $("#columnColorError").textContent = "";
    $("#columnCategory").value = column ? column.category : "todo";
    updateColumnPreview();
    $("#columnError").hidden = true;
    $("#columnName").classList.remove("is-invalid");
    window.Screens.openDialog("columnLayer");
  }

  function renderPastelChoices(selectedTone) {
    const group = $("#columnToneOptions");
    group.innerHTML = PASTELS.map((choice) => {
      const selected = choice.tone === selectedTone;
      return `<button class="settings-pastel-choice${selected ? " is-selected" : ""}" type="button" role="radio" data-tone="${choice.tone}" aria-label="${choice.name}" aria-checked="${selected}" tabindex="${selected ? "0" : "-1"}"><span class="settings-pastel-chip pastel-${choice.css}" aria-hidden="true"></span><span>${choice.name}</span><span class="settings-pastel-check" aria-hidden="true">✓</span></button>`;
    }).join("");
    $$("[data-tone]", group).forEach((button) => button.addEventListener("click", () => selectPastel(button.dataset.tone, true)));
  }

  function selectedPastel() {
    return $("#columnToneOptions [aria-checked='true']")?.dataset.tone || "";
  }

  function selectPastel(tone, focus) {
    if (!PASTEL_TONES.has(tone)) return;
    $$("[role=radio]", $("#columnToneOptions")).forEach((button) => {
      const selected = button.dataset.tone === tone;
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle("is-selected", selected);
      if (selected && focus) button.focus();
    });
    $("#columnColorError").hidden = true;
    updateColumnPreview();
  }

  function onPastelKeydown(event) {
    const choices = $$("[role=radio]", $("#columnToneOptions"));
    const index = choices.indexOf(event.target.closest("[role=radio]"));
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % choices.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + choices.length) % choices.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = choices.length - 1;
    else return;
    event.preventDefault();
    selectPastel(choices[next].dataset.tone, true);
  }

  function updateColumnPreview() {
    const tone = selectedPastel();
    const choice = PASTELS.find((entry) => entry.tone === tone) || PASTELS[0];
    const name = $("#columnName").value.trim() || "New column";
    const preview = $("#columnColorPreview");
    preview.dataset.tone = choice.tone;
    $("#columnColorPreviewName").textContent = name;
    $("#columnColorPreviewValue").textContent = choice.name;
  }

  function submitColumn(event) {
    event.preventDefault();
    if (!canManageBoard() || projectArchived() || !state.columnEdit) return;
    const name = $("#columnName").value.trim();
    const tone = selectedPastel();
    const category = $("#columnCategory").value;
    const error = $("#columnError");
    error.hidden = true;
    $("#columnName").classList.remove("is-invalid");
    if (!name) {
      error.textContent = "Enter a column name.";
      error.hidden = false;
      $("#columnName").classList.add("is-invalid");
      $("#columnName").focus();
      return;
    }
    if (!PASTEL_TONES.has(tone)) {
      const colorError = $("#columnColorError");
      colorError.textContent = "Choose one of the listed pastel colors before saving.";
      colorError.hidden = false;
      $("#columnToneOptions").querySelector("[role=radio]")?.focus();
      return;
    }
    const duplicate = state.columns.some((column) => column.name.trim().toLowerCase() === name.toLowerCase() && column.id !== state.columnEdit.id);
    if (duplicate) {
      error.textContent = "A column with this name already exists.";
      error.hidden = false;
      $("#columnName").classList.add("is-invalid");
      $("#columnName").focus();
      return;
    }
    if (state.columnEdit.mode === "rename") {
      const column = state.columns.find((entry) => entry.id === state.columnEdit.id);
      if (column) {
        column.name = name;
        column.tone = tone;
        column.category = category;
      }
    } else {
      if (state.columns.length >= 12) {
        error.textContent = "The initial maximum is 12 columns.";
        error.hidden = false;
        return;
      }
      state.columns.push({
        id: `col_${Date.now()}`,
        name,
        tone,
        category,
        cardCount: 0
      });
    }
    window.Screens.closeDialog("columnLayer");
    markBoardDirty();
    renderColumns();
    window.Screens.toast(`${name} ${state.columnEdit.mode === "rename" ? "renamed" : "added"} locally. The board artifact is unchanged.`, { tone: "success", icon: "columns" });
    state.columnEdit = null;
  }

  async function removeColumn(id) {
    if (!canManageBoard() || projectArchived()) return;
    const column = state.columns.find((entry) => entry.id === id);
    if (!column) return;
    if (column.cardCount > 0) {
      window.Screens.toast(`Cannot remove ${column.name}: ${column.cardCount} card${column.cardCount === 1 ? "" : "s"} reference it.`, { tone: "danger", icon: "alert" });
      return;
    }
    if (state.columns.length <= 1) {
      window.Screens.toast("The final column cannot be removed.", { tone: "danger", icon: "alert" });
      return;
    }
    const accepted = await window.Screens.confirm({
      title: `Remove ${column.name}?`,
      copy: "The column has no cards. Removing it is local to this preview and does not change the approved board artifact.",
      confirmLabel: "Remove column",
      tone: "danger",
      icon: "trash"
    });
    if (!accepted) return;
    state.columns = state.columns.filter((entry) => entry.id !== id);
    markBoardDirty();
    renderColumns();
    window.Screens.toast(`${column.name} removed locally.`, { icon: "trash" });
  }

  function saveProject(event) {
    event.preventDefault();
    const p = project();
    if (!p || !canManageProject() || projectArchived()) return;
    const name = $("#projectName").value.trim();
    if (!name) {
      window.Screens.toast("Project name cannot be empty.", { tone: "danger", icon: "alert" });
      $("#projectName").focus();
      return;
    }
    if (name.length > 80) {
      window.Screens.toast("Keep the project name to 80 characters or fewer.", { tone: "danger", icon: "alert" });
      return;
    }
    const duplicate = SD.projects.some((entry) => entry.id !== p.id && entry.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) {
      window.Screens.toast("A project with this name already exists.", { tone: "danger", icon: "alert" });
      $("#projectName").focus();
      return;
    }
    p.name = name;
    p.description = $("#projectDescription").value.trim() || "New project.";
    clearProjectDirty();
    renderHeader();
    renderProject();
    renderAccount();
    window.Screens.toast("Project settings saved locally. No API or persistence was called.", { tone: "success", icon: "folder" });
  }

  function saveBoard(event) {
    event.preventDefault();
    const b = board();
    if (!b || !canManageBoard() || projectArchived()) return;
    const name = $("#boardName").value.trim();
    if (!name) {
      window.Screens.toast("Board name cannot be empty.", { tone: "danger", icon: "alert" });
      $("#boardName").focus();
      return;
    }
    b.name = name;
    b.description = $("#boardDescription").value.trim() || "Board";
    clearBoardDirty();
    renderHeader();
    renderBoard();
    window.Screens.toast("Board name and description saved locally. Column edits stay preview-only.", { tone: "success", icon: "board" });
  }

  async function archiveProject() {
    const p = project();
    if (!p || !canArchive()) return;
    const accepted = await window.Screens.confirm({
      title: `Archive ${p.name}?`,
      copy: "The project disappears from active lists and every board becomes read-only. Data is retained, deleted-card restore deadlines continue, and only the Owner can reopen it. This prototype updates in-memory settings only.",
      confirmLabel: "Archive project",
      tone: "danger",
      icon: "archive"
    });
    if (!accepted) return;
    p.status = "archived";
    p.archivedAt = new Date().toISOString();
    p.archivedBy = me().id;
    state.projectDirty = false;
    state.boardDirty = false;
    render();
    window.Screens.toast(`${p.name} archived. Boards are read-only in production.`, { icon: "archive" });
  }

  async function reopenProject() {
    const p = project();
    if (!p || !canArchive()) return;
    const accepted = await window.Screens.confirm({
      title: `Reopen ${p.name}?`,
      copy: "The project returns to active lists and its boards become editable again. This prototype updates in-memory settings only.",
      confirmLabel: "Reopen project",
      tone: "primary",
      icon: "restore"
    });
    if (!accepted) return;
    p.status = "active";
    p.archivedAt = null;
    p.archivedBy = null;
    render();
    window.Screens.toast(`${p.name} reopened.`, { tone: "success", icon: "restore" });
  }

  function bind() {
    $$("[data-settings-tab]").forEach((tab) => {
      tab.addEventListener("click", () => setTab(tab.dataset.settingsTab));
      tab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const index = TABS.indexOf(state.tab);
        const next = (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
        setTab(TABS[next]);
      });
    });
    $("#projectForm").addEventListener("input", markProjectDirty);
    $("#projectForm").addEventListener("submit", saveProject);
    $("#boardForm").addEventListener("input", markBoardDirty);
    $("#boardForm").addEventListener("submit", saveBoard);
    $("#addColumnBtn").addEventListener("click", () => openColumnDialog("add"));
    $("#resetColumnsBtn").addEventListener("click", () => {
      if (!canManageBoard() || projectArchived()) return;
      state.columns = defaultColumns();
      markBoardDirty();
      renderColumns();
      window.Screens.toast("Columns reset to the approved board order. Save to keep this local preview.", { icon: "refresh" });
    });
    $("#columnForm").addEventListener("submit", submitColumn);
    $("#columnName").addEventListener("input", updateColumnPreview);
    $("#columnToneOptions").addEventListener("keydown", onPastelKeydown);
    $$("[data-close-dialog]").forEach((button) => {
      button.addEventListener("click", () => window.Screens.closeDialog(button.dataset.closeDialog));
    });
    $$("[data-theme-choice]").forEach((card) => {
      card.addEventListener("click", () => {
        window.Screens.setTheme(card.dataset.themeChoice, true);
        updateThemeUI();
      });
    });
  }

  window.FBPage = {
    init() {
      const context = window.Screens.projectContext;
      PROJECT_ID = context.projectId;
      BOARD_ID = context.boardId;
      state.columns = defaultColumns();
      bind();
      window.Screens.onTheme(updateThemeUI);
      render();
    },
    render() {
      render();
    },
    beforeRoleChange() {
      if (!state.projectDirty && !state.boardDirty) return true;
      return window.Screens.confirm({
        title: "Change role and discard settings changes?",
        copy: "Unsaved project or board settings will be lost. Role preview does not change any real grant.",
        confirmLabel: "Discard changes",
        tone: "danger",
        icon: "alert"
      }).then((accepted) => {
        if (accepted) {
          state.projectDirty = false;
          state.boardDirty = false;
        }
        return accepted;
      });
    },
    beforeUnload() {
      return state.projectDirty || state.boardDirty;
    }
  };
})();
