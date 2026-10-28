/* Flowboard UI artifact — create-only XLSX import with sample previews. */
(function () {
  "use strict";

  const SD = window.SD;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const escape = window.Screens.escape;
  const MAX_BYTES = 5 * 1024 * 1024;
  const params = new URLSearchParams(window.location.search);

  const state = {
    stage: "upload",
    sample: params.get("sample") === "errors" ? "errors" : params.get("sample") === "clean" ? "clean" : null,
    file: null,
    board: "board_website",
    result: null,
    fileError: ""
  };

  if (state.sample) {
    state.stage = ["preview", "confirm", "done"].includes(params.get("stage")) ? params.get("stage") : "preview";
    if (state.stage === "done" && state.sample !== "clean") state.stage = "preview";
    if (state.stage === "confirm" && sampleCounts().blocking) state.stage = "preview";
    if (state.stage === "done") state.result = buildResult();
  }

  function me() { return window.Screens.currentUser(); }
  function sampleData() { return state.sample ? SD.importSamples[state.sample] : null; }
  function sampleRows() {
    return (sampleData() ? sampleData().rows : []).map((row) => {
      if (!["low", "medium", "high", "urgent"].includes(row.priority)) {
        return { ...row, result: "invalid", field: "Priority", message: "Choose Low, Medium, High or Urgent for every new card." };
      }
      return row;
    });
  }

  function sampleCounts() {
    const rows = sampleRows();
    const ready = rows.filter((row) => row.result === "ready").length;
    const invalid = rows.filter((row) => row.result === "invalid").length;
    const conflict = rows.filter((row) => row.result === "conflict").length;
    return { total: rows.length, ready, invalid, conflict, blocking: invalid + conflict > 0 };
  }

  function destinationBoard() {
    return SD.board(state.board) || SD.board("board_website");
  }

  function destinationProject() {
    const board = destinationBoard();
    return board ? SD.project(board.projectId) : null;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function setStage(stage) {
    state.stage = stage;
    updateUrl();
    render();
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    if (state.sample) url.searchParams.set("sample", state.sample);
    else url.searchParams.delete("sample");
    if (state.stage === "upload") url.searchParams.delete("stage");
    else url.searchParams.set("stage", state.stage);
    history.replaceState(null, "", url.pathname.split("/").pop() + url.search + url.hash);
  }

  function renderHeader() {
    const project = destinationProject();
    $("#importBoardLink").href = window.Screens.boardHref();
    $("#importBoardLink").innerHTML = `${window.Screens.icon("board")}Back to board`;
    const projectLink = $("#importProjectLink");
    if (projectLink) projectLink.href = window.Screens.screenHref("project", { project: project ? project.id : "website-redesign" });
  }

  function renderSteps() {
    const order = ["upload", "preview", "confirm", "done"];
    const activeIndex = order.indexOf(state.stage);
    $$("[data-import-step]").forEach((step) => {
      const index = order.indexOf(step.dataset.importStep);
      step.classList.toggle("is-active", index === activeIndex);
      step.classList.toggle("is-done", index < activeIndex);
    });
  }

  function statHTML(label, value, tone) {
    return `<div class="preview-stat${tone ? " " + tone : ""}"><span class="label">${label}</span><span class="value">${value}</span></div>`;
  }

  function previewSummaryHTML() {
    const counts = sampleCounts();
    return `<div class="preview-summary">
      ${statHTML("Nonempty rows", counts.total)}
      ${statHTML("Ready", counts.ready, "ok")}
      ${statHTML("Invalid", counts.invalid, counts.invalid ? "bad" : "")}
      ${statHTML("Conflicts", counts.conflict, counts.conflict ? "warn" : "")}
      ${statHTML("Would create", counts.blocking ? 0 : counts.ready, counts.blocking ? "bad" : "ok")}
    </div>`;
  }

  function rowResultHTML(row) {
    if (row.result === "invalid") {
      return `<span class="status-chip invalid">Invalid</span><p class="row-message">${escape(row.field)}: ${escape(row.message)}</p>`;
    }
    if (row.result === "conflict") {
      return `<span class="status-chip conflict">Conflict</span><p class="row-message warn">${escape(row.field)}: ${escape(row.message)}</p>`;
    }
    return '<span class="status-chip ready">Ready</span>';
  }

  function rowHTML(row) {
    const resultClass = row.result === "invalid" ? "is-error" : row.result === "conflict" ? "is-conflict" : "";
    const dueClass = row.result === "invalid" && row.field === "Due Date" ? "is-error" : "";
    const externalClass = row.result === "conflict" && row.field === "External ID" ? "is-conflict" : "";
    return `<tr>
      <td class="mono">${row.row}</td>
      <td class="${externalClass} mono">${escape(row.externalId)}</td>
      <td><strong>${escape(row.title)}</strong><span class="tiny faint" style="display:block;margin-top:2px;">Description blank or plain text</span></td>
      <td style="text-transform:capitalize;">${escape(row.priority)}</td>
      <td class="${dueClass}">${escape(row.due)}</td>
      <td>${row.assignees.map((email) => `<span class="tiny">${escape(email)}</span>`).join("<br />")}</td>
      <td>${escape(row.status)}</td>
      <td class="${resultClass}">${rowResultHTML(row)}</td>
    </tr>`;
  }

  function previewTableHTML() {
    return `<div class="table-wrap"><table class="data-table preview-table">
      <thead><tr><th>Row</th><th>External ID</th><th>Title</th><th>Priority</th><th>Due Date</th><th>Assignees</th><th>Status</th><th>Result</th></tr></thead>
      <tbody>${sampleRows().map(rowHTML).join("")}</tbody>
    </table></div>`;
  }

  function uploadStage() {
    return `<section class="panel" aria-labelledby="uploadTitle">
      <div class="panel-head">
        <div class="panel-head-copy">
          <h2 class="panel-title" id="uploadTitle">Upload a workbook</h2>
          <p class="panel-sub">Choose the destination board, then select one .xlsx file.</p>
        </div>
        <div class="panel-actions"><span class="badge">Step 1 of 4</span></div>
      </div>
      <div class="panel-body stack">
        <div class="form-grid">
          <div class="field">
            <label class="field-label" for="importProject">Project</label>
            <select class="control" id="importProject" disabled>
              <option>Website Redesign</option>
            </select>
            <p class="field-help">An import cannot create or switch projects.</p>
          </div>
          <div class="field">
            <label class="field-label" for="importBoard">Destination board</label>
            <select class="control" id="importBoard">
              <option value="board_website"${state.board === "board_website" ? " selected" : ""}>Website Kanban</option>
              <option value="board_brand" disabled>Brand Guidelines · archived project</option>
            </select>
            <p class="field-help">Cards inherit this board's project access.</p>
          </div>
        </div>

        <div>
          <label class="sr-only" for="importFile">Workbook file</label>
          <input id="importFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden />
          <div class="dropzone dropzone-lg" id="importDrop" role="button" tabindex="0" aria-label="Choose an XLSX workbook">
            ${window.Screens.icon("upload")}
            <strong>Drop an .xlsx workbook here</strong>
            <span>or choose a file · maximum 5 MiB · 200 nonempty rows</span>
          </div>
          <p class="form-error" id="importFileError"${state.fileError ? "" : " hidden"}>${escape(state.fileError)}</p>
        </div>

        <div class="row" style="justify-content:space-between;">
          <span class="small muted">Need sample data for review?</span>
          <div class="row">
            <button class="btn sm" type="button" data-sample="errors">${window.Screens.icon("alert")}Preview errors</button>
            <button class="btn sm" type="button" data-sample="clean">${window.Screens.icon("check")}Preview clean</button>
          </div>
        </div>

        <div class="note">
          <svg class="icon" aria-hidden="true"><use href="#i-file"></use></svg>
          <span><strong>Template:</strong> seven columns and a priority dropdown. Extra blank rows are ignored. <a class="link-inline" href="Flowboard_Card_Import_Template.xlsx" download>Download the workbook</a>.</span>
        </div>
        <div class="note warn">
          <svg class="icon" aria-hidden="true"><use href="#i-alert"></use></svg>
          <span><strong>This prototype cannot parse XLSX.</strong> A selected file is validated by name and size only. The preview uses the clean sample rows and clearly labels that substitution.</span>
        </div>
      </div>
    </section>`;
  }

  function previewStage() {
    const data = sampleData();
    const counts = sampleCounts();
    const board = destinationBoard();
    const fileLabel = state.file ? state.file.name : data ? data.name : "sample.xlsx";
    const sizeLabel = state.file ? state.file.sizeLabel : data ? data.size : "—";
    return `<section class="panel" aria-labelledby="previewTitle">
      <div class="panel-head">
        <div class="panel-head-copy">
          <h2 class="panel-title" id="previewTitle">Preview mapped rows</h2>
          <p class="panel-sub">Validation happens before any card exists. Fix the workbook and upload again if a row blocks commit.</p>
        </div>
        <div class="panel-actions"><span class="badge">Step 2 of 4</span></div>
      </div>
      <div class="panel-body stack">
        <div class="file-selected">
          ${window.Screens.icon("file")}
          <span class="file-copy">
            <strong>${escape(fileLabel)}</strong>
            <span>${escape(sizeLabel)} · ${counts.total} nonempty row${counts.total === 1 ? "" : "s"} · ${escape(board ? board.name : "Website Kanban")} · <span class="badge accent">Sample data</span></span>
          </span>
          <button class="btn sm" type="button" data-back-upload>Choose another</button>
        </div>

        ${previewSummaryHTML()}

        ${counts.blocking
          ? `<div class="note danger">
              ${window.Screens.icon("x-circle")}
              <span><strong>${counts.invalid + counts.conflict} blocking row${counts.invalid + counts.conflict === 1 ? "" : "s"}.</strong> ${counts.invalid} invalid and ${counts.conflict} conflicting. No cards will be created until every row is ready. There is no partial success.</span>
            </div>`
          : `<div class="note success">
              ${window.Screens.icon("check-circle")}
              <span><strong>Every row is ready.</strong> ${counts.ready} card${counts.ready === 1 ? "" : "s"} can be created. Nothing has been written yet.</span>
            </div>`}

        ${previewTableHTML()}

        <div class="note">
          <svg class="icon" aria-hidden="true"><use href="#i-info"></use></svg>
          <span>Description is mapped but not expanded here. Comments, images, mentions and activity are not part of the workbook contract and are never imported.</span>
        </div>

        <div class="form-actions">
          <button class="btn" type="button" data-back-upload>${window.Screens.icon("arrow-left")}Back to upload</button>
          ${counts.blocking ? `<button class="btn" type="button" data-sample="clean">${window.Screens.icon("check")}Use clean sample</button>` : ""}
          <span class="spacer"></span>
          <button class="btn primary" type="button" data-continue${counts.blocking ? " disabled" : ""}>
            Continue to confirm ${window.Screens.icon("arrow-right")}
          </button>
        </div>
      </div>
    </section>`;
  }

  function confirmStage() {
    const data = sampleData();
    const counts = sampleCounts();
    const board = destinationBoard();
    return `<section class="panel" aria-labelledby="confirmTitle">
      <div class="panel-head">
        <div class="panel-head-copy">
          <h2 class="panel-title" id="confirmTitle">Confirm the batch</h2>
          <p class="panel-sub">No cards exist yet. This is the explicit commit step.</p>
        </div>
        <div class="panel-actions"><span class="badge">Step 3 of 4</span></div>
      </div>
      <div class="panel-body stack">
        ${previewSummaryHTML()}
        <div class="file-selected">
          ${window.Screens.icon("board")}
          <span class="file-copy">
            <strong>${escape(board ? board.name : "Website Kanban")}</strong>
            <span>${escape(data ? data.name : "sample.xlsx")} · ${counts.ready} card${counts.ready === 1 ? "" : "s"} · create-only</span>
          </span>
          <span class="status-chip ready">Ready</span>
        </div>
        <div class="note">
          <svg class="icon" aria-hidden="true"><use href="#i-shield"></use></svg>
          <span><strong>All-or-nothing.</strong> If a person, column or External ID changed since preview, the server rejects the entire batch. Nothing is silently skipped.</span>
        </div>
        <div class="note">
          <svg class="icon" aria-hidden="true"><use href="#i-columns"></use></svg>
          <span>Cards append to their mapped columns. The server assigns card keys and preserves manual order.</span>
        </div>
        <div class="note warn">
          <svg class="icon" aria-hidden="true"><use href="#i-alert"></use></svg>
          <span><strong>Prototype only.</strong> Confirming creates in-memory result rows. No workbook bytes, API request or database write is involved.</span>
        </div>
        <div class="form-actions">
          <button class="btn" type="button" data-back-preview>${window.Screens.icon("arrow-left")}Back to preview</button>
          <span class="spacer"></span>
          <button class="btn primary" type="button" data-open-commit>${window.Screens.icon("upload")}Confirm import</button>
        </div>
      </div>
    </section>`;
  }

  function resultStage() {
    const result = state.result;
    if (!result) return uploadStage();
    return `<section class="panel" aria-labelledby="resultTitle">
      <div class="panel-head">
        <div class="panel-head-copy">
          <h2 class="panel-title" id="resultTitle">Import result</h2>
          <p class="panel-sub">Committed as one batch. No rows were skipped or partially written.</p>
        </div>
        <div class="panel-actions"><span class="badge">Step 4 of 4</span></div>
      </div>
      <div class="panel-body stack">
        <div class="result-banner">
          <span class="success-icon">${window.Screens.icon("check-circle")}</span>
          <div>
            <h2>${result.created.length} card${result.created.length === 1 ? "" : "s"} created</h2>
            <p>${escape(result.created.length)} of ${escape(result.total)} rows committed to ${escape(result.boardName)}. Invalid rows: 0. Conflicts: 0. Comments and images imported: 0.</p>
          </div>
        </div>
        <div class="result-list">
          ${result.created.map((card) => `<div class="result-list-row">
            <span class="card-key">${escape(card.key)}</span>
            <span>${escape(card.title)}</span>
            <span class="spacer"></span>
            <span class="tiny faint mono">${escape(card.externalId)}</span>
            <span class="status-chip ready">Created</span>
          </div>`).join("")}
        </div>
        <div class="note">
          <svg class="icon" aria-hidden="true"><use href="#i-image"></use></svg>
          <span>Imported cards start with no comments and no images. Assignees, priority, due date and column come from the workbook.</span>
        </div>
        <div class="note warn">
          <svg class="icon" aria-hidden="true"><use href="#i-alert"></use></svg>
          <span><strong>Prototype result.</strong> Reloading forgets these cards. The API, atomic transaction and idempotency key are not implemented.</span>
        </div>
        <div class="form-actions">
          <a class="btn primary" href="${window.Screens.boardHref()}">${window.Screens.icon("board")}Open board</a>
          <button class="btn" type="button" data-back-upload>Import another file</button>
          <a class="btn ghost" href="${window.Screens.screenHref("project", { project: "website-redesign" })}">Project overview</a>
        </div>
      </div>
    </section>`;
  }

  function renderStage() {
    const container = $("#importStage");
    if (state.stage === "preview") container.innerHTML = previewStage();
    else if (state.stage === "confirm") container.innerHTML = confirmStage();
    else if (state.stage === "done") container.innerHTML = resultStage();
    else container.innerHTML = uploadStage();
    bindStage();
  }

  function render() {
    if (!window.Screens.can("import")) {
      $("#importContent").hidden = true;
      const denied = $("#importDenied");
      denied.innerHTML = window.Screens.accessDenied({
        title: "Import is limited to Owner and Manager",
        copy: `${me().name} is previewing the ${window.Screens.roleLabel()} role. Members can create and edit cards but cannot upload or confirm an Excel import. Viewers are read-only.`,
        needed: "Owner or Manager",
        backHref: "../index.html",
        backLabel: "Back to board"
      });
      denied.hidden = false;
      return;
    }
    $("#importContent").hidden = false;
    $("#importDenied").hidden = true;
    renderHeader();
    renderSteps();
    renderStage();
  }

  function validateFile(file) {
    state.fileError = "";
    if (!file) return false;
    const name = file.name || "workbook.xlsx";
    if (!/\.xlsx$/i.test(name)) {
      state.fileError = "Choose an .xlsx workbook. Legacy .xls and CSV files are not supported.";
      window.Screens.toast(state.fileError, { tone: "danger", icon: "alert" });
      return false;
    }
    if (file.size > MAX_BYTES) {
      state.fileError = `This file is ${formatBytes(file.size)}. The maximum upload is 5 MiB.`;
      window.Screens.toast(state.fileError, { tone: "danger", icon: "alert" });
      return false;
    }
    state.file = { name, size: file.size, sizeLabel: formatBytes(file.size) };
    state.sample = "clean";
    state.stage = "preview";
    updateUrl();
    render();
    window.Screens.toast("File accepted by name and size. Preview uses the clean sample; XLSX parsing is not implemented.", { tone: "success", icon: "file" });
    return true;
  }

  function pickSample(sample) {
    state.sample = sample;
    state.file = null;
    state.result = null;
    state.stage = "preview";
    updateUrl();
    render();
    window.Screens.toast(sample === "errors" ? "Loaded sample with blocking rows." : "Loaded clean sample.", { icon: "file" });
  }

  function buildResult() {
    const rows = sampleRows().filter((row) => row.result === "ready");
    let next = Number((SD.nextCardKey().split("-")[1] || "113"));
    const created = rows.map((row) => {
      const key = `WEB-${next}`;
      next += 1;
      return { key, title: row.title, externalId: row.externalId, row: row.row, priority: row.priority };
    });
    return {
      sample: state.sample,
      total: sampleRows().length,
      created,
      boardName: destinationBoard() ? destinationBoard().name : "Website Kanban",
      at: new Date().toISOString()
    };
  }

  function openCommit() {
    if (sampleCounts().blocking) return;
    const counts = sampleCounts();
    $("#commitCopy").textContent = `${counts.ready} card${counts.ready === 1 ? "" : "s"} will be created in ${destinationBoard() ? destinationBoard().name : "Website Kanban"}. This commits the whole batch; nothing is partially written.`;
    $("#commitSummary").innerHTML = previewSummaryHTML();
    window.Screens.openDialog("commitLayer");
  }

  function commit() {
    if (sampleCounts().blocking) {
      window.Screens.closeDialog("commitLayer");
      window.Screens.toast("Blocking rows remain. Nothing was created.", { tone: "danger", icon: "alert" });
      return;
    }
    const result = buildResult();
    state.result = result;
    SD.importResults.push(result);
    result.created.forEach((card) => {
      SD.createdCards.push({
        id: `import_${card.externalId}_${Date.now()}`,
        key: card.key,
        title: card.title,
        description: "",
        columnId: "col_backlog",
        priority: card.priority,
        assignees: [],
        due: null,
        images: [],
        comments: [],
        activity: [],
        projectId: "website-redesign",
        boardId: "board_website",
        imported: true
      });
    });
    window.Screens.closeDialog("commitLayer");
    state.stage = "done";
    updateUrl();
    render();
    window.Screens.toast(`${result.created.length} cards created. No rows skipped.`, { tone: "success", icon: "check-circle" });
  }

  function bindStage() {
    const drop = $("#importDrop");
    const input = $("#importFile");
    if (drop && input) {
      drop.addEventListener("click", () => input.click());
      drop.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          input.click();
        }
      });
      drop.addEventListener("dragover", (event) => {
        event.preventDefault();
        drop.classList.add("is-dragover");
      });
      drop.addEventListener("dragleave", () => drop.classList.remove("is-dragover"));
      drop.addEventListener("drop", (event) => {
        event.preventDefault();
        drop.classList.remove("is-dragover");
        const file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
        validateFile(file);
      });
      input.addEventListener("change", () => {
        const file = input.files && input.files[0] ? input.files[0] : null;
        validateFile(file);
        input.value = "";
      });
    }
    const board = $("#importBoard");
    if (board) {
      board.addEventListener("change", () => {
        state.board = board.value;
        render();
      });
    }
    $$("[data-sample]", $("#importStage")).forEach((button) => {
      button.addEventListener("click", () => pickSample(button.dataset.sample));
    });
    $$("[data-back-upload]", $("#importStage")).forEach((button) => {
      button.addEventListener("click", () => {
        state.stage = "upload";
        state.sample = null;
        state.file = null;
        state.result = null;
        state.fileError = "";
        updateUrl();
        render();
      });
    });
    $$("[data-back-preview]", $("#importStage")).forEach((button) => {
      button.addEventListener("click", () => setStage("preview"));
    });
    $$("[data-continue]", $("#importStage")).forEach((button) => {
      button.addEventListener("click", () => {
        if (sampleCounts().blocking) return;
        setStage("confirm");
      });
    });
    $$("[data-open-commit]", $("#importStage")).forEach((button) => {
      button.addEventListener("click", openCommit);
    });
  }

  window.FBPage = {
    init() {
      $$("[data-close-dialog]").forEach((button) => {
        button.addEventListener("click", () => window.Screens.closeDialog(button.dataset.closeDialog));
      });
      $("#confirmCommit").addEventListener("click", commit);
      render();
    },
    render() {
      render();
    },
    beforeRoleChange() {
      window.Screens.closeDialog("commitLayer");
      return true;
    }
  };
})();
