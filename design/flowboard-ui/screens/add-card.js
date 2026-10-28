/* Flowboard UI artifact — add card with save-first attachments. */
(function () {
  "use strict";

  const SD = window.SD;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const escape = window.Screens.escape;
  const PROJECT_ID = "website-redesign";

  let savedCard = null;
  let dirty = false;
  let navigating = false;

  function me() { return window.Screens.currentUser(); }

  function eligibleAssignees() {
    const project = SD.project(PROJECT_ID);
    if (!project) return [];
    return project.memberIds
      .map((id) => window.FB.person(id))
      .filter((person) => person && person.assignable);
  }

  function selectedAssignees() {
    return $$('input[name="assignee"]:checked').map((input) => input.value);
  }

  function markDirty() {
    if (savedCard) return;
    dirty = true;
    const note = $("#dirtyNote");
    note.classList.add("is-dirty");
    note.innerHTML = '<span class="dot"></span>Unsaved card details';
  }

  function clearDirty() {
    dirty = false;
    const note = $("#dirtyNote");
    if (!note) return;
    note.classList.remove("is-dirty");
    note.innerHTML = '<span class="dot"></span>No unsaved changes';
  }

  function renderAssignees() {
    const current = me();
    const people = eligibleAssignees();
    $("#assigneeList").innerHTML = people.map((person) => {
      const checked = person.id === current.id;
      return `<label class="check-row">
        <input type="checkbox" name="assignee" value="${person.id}"${checked ? " checked" : ""} />
        ${window.Screens.avatar(person.id)}
        <span>${escape(person.name)}</span>
        <span class="role-mini">${escape(person.role)}</span>
      </label>`;
    }).join("");
    renderAssigneeSummary();
  }

  function renderAssigneeSummary() {
    const ids = selectedAssignees();
    const summary = $("#assigneeSummary");
    if (!ids.length) {
      summary.innerHTML = '<span class="hint"><svg class="icon" aria-hidden="true"><use href="#i-users"></use></svg>Unassigned. The card can be assigned later.</span>';
      return;
    }
    summary.innerHTML = `<span class="tiny faint">Assigned to</span>${ids.map((id) => {
      const person = window.FB.person(id);
      return `<span class="assignee-chip">${window.Screens.avatar(id)}${escape(person.name)}</span>`;
    }).join("")}`;
  }

  function renderMeta() {
    const user = me();
    $("#creatorName").textContent = user.name;
    $("#nextKey").textContent = SD.nextCardKey();
    const project = SD.project(PROJECT_ID);
    if (project && project.status === "archived") {
      $("#saveCardBtn").disabled = true;
    }
  }

  function countChars(input, output, max) {
    const length = input.value.length;
    output.textContent = `${length.toLocaleString()} / ${max.toLocaleString()}`;
    output.classList.toggle("is-over", length > max);
  }

  function validate() {
    const title = $("#cardTitle");
    const description = $("#cardDescription");
    const due = $("#cardDue");
    const titleError = $("#titleError");
    const dueError = $("#dueError");
    const priority = $("#cardPriority");
    const priorityError = $("#priorityError");
    let valid = true;

    title.classList.remove("is-invalid");
    due.classList.remove("is-invalid");
    priority.classList.remove("is-invalid");
    priority.removeAttribute("aria-invalid");
    priorityError.hidden = true;
    titleError.hidden = true;
    dueError.hidden = true;

    const value = title.value.trim();
    if (!value) {
      titleError.textContent = "Enter a title before saving the card.";
      titleError.hidden = false;
      title.classList.add("is-invalid");
      valid = false;
    } else if (value.length > 200) {
      titleError.textContent = "Keep the title to 200 characters or fewer.";
      titleError.hidden = false;
      title.classList.add("is-invalid");
      valid = false;
    }

    if (!["low", "medium", "high", "urgent"].includes(priority.value)) {
      priorityError.hidden = false;
      priority.classList.add("is-invalid");
      priority.setAttribute("aria-invalid", "true");
      valid = false;
    }

    if (description.value.length > 20000) {
      valid = false;
      window.Screens.toast("Description is longer than 20,000 characters.", { tone: "danger" });
    }

    if (due.value && !/^\d{4}-\d{2}-\d{2}$/.test(due.value)) {
      dueError.textContent = "Use a date-only value in YYYY-MM-DD format.";
      dueError.hidden = false;
      due.classList.add("is-invalid");
      valid = false;
    }

    if (!valid) {
      const first = $(".is-invalid", $("#addCardForm"));
      if (first) first.focus();
    }
    return valid;
  }

  function saveCard(event) {
    event.preventDefault();
    if (!validate()) return;

    const title = $("#cardTitle").value.trim();
    const description = $("#cardDescription").value.trim();
    const columnId = $("#cardColumn").value;
    const column = window.FB.column(columnId);
    const priority = $("#cardPriority").value;
    const due = $("#cardDue").value || null;
    const assignees = selectedAssignees();
    const key = SD.nextCardKey();
    const now = new Date().toISOString();
    const card = {
      id: `card_${Date.now()}`,
      key,
      title,
      description,
      columnId,
      priority,
      assignees,
      due,
      createdAt: now,
      images: [],
      comments: [],
      activity: [
        { id: `act_${Date.now()}`, actorId: me().id, icon: "plus", text: "created this card", at: now }
      ],
      projectId: PROJECT_ID,
      boardId: "board_website",
      savedFirst: true
    };

    SD.createdCards.push(card);
    savedCard = card;
    clearDirty();
    renderSaved(card, column);
    window.Screens.toast(`${key} saved. Images and comments can attach now.`, { tone: "success", icon: "check-circle" });
  }

  function renderSaved(card, column) {
    $("#addCardForm").hidden = true;
    $("#savedState").hidden = false;
    $("#savedKeyBadge").textContent = card.key;
    $("#savedKeyInline").textContent = card.key;
    $("#savedTitle").textContent = card.title;
    $("#savedColumn").textContent = column ? column.name : "No column";
    $("#savedPriority").textContent = card.priority === "none" ? "No priority" : `${card.priority.charAt(0).toUpperCase()}${card.priority.slice(1)} priority`;
    $("#savedDue").textContent = card.due ? `Due ${window.Screens.formatDate(card.due)}` : "No due date";
    $("#savedAssignees").textContent = card.assignees.length
      ? card.assignees.map((id) => window.Screens.personName(id)).join(", ")
      : "Unassigned";

    const params = new URLSearchParams();
    if (window.Screens.role !== "owner") params.set("role", window.Screens.role);
    $("#openBoard").href = `../index.html${params.toString() ? "?" + params.toString() : ""}`;

    $$(".step").forEach((step, index) => {
      step.classList.toggle("is-done", index < 2);
      step.classList.toggle("is-active", index === 2);
    });
    renderAttachments();
    renderComments();
    $("#firstComment").focus({ preventScroll: true });
  }

  function renderAttachments() {
    const card = savedCard;
    if (!card) return;
    const grid = $("#attachGrid");
    grid.innerHTML = card.images.map((image) => `<div class="attach-tile" data-image-id="${image.id}">
      <img src="${image.src}" alt="${escape(image.label)}" />
      <span class="attach-shade" aria-hidden="true"></span>
      <span class="attach-private">${window.Screens.icon("lock")}Private</span>
      <span class="attach-label">${escape(image.label)}</span>
      <button class="attach-remove" type="button" data-remove-image="${image.id}" aria-label="Remove ${escape(image.label)}">${window.Screens.icon("x")}</button>
    </div>`).join("");
    const count = card.images.length;
    $("#imageNote").textContent = count
      ? `${count} private image${count === 1 ? "" : "s"} attached to ${card.key}. Each image is a separate save.`
      : "No images attached. This prototype generates a local placeholder instead of reading a file.";
    const badge = $(".success-card .badge");
    if (badge) badge.textContent = `${count} / 6`;
  }

  function addImage() {
    if (!savedCard) return;
    if (savedCard.images.length >= 6) {
      window.Screens.toast("This prototype allows up to six images per card.", { tone: "danger", icon: "alert" });
      return;
    }
    const n = savedCard.images.length + 1;
    const palettes = [
      ["#d7e2d9", "#7f9f88", "#365a41"],
      ["#e7d9c0", "#b28a53", "#6f4d22"],
      ["#c9d6e4", "#6e8cad", "#2f4d70"],
      ["#ddd8ce", "#8f887b", "#4f4a41"]
    ];
    const palette = palettes[(n - 1) % palettes.length];
    const image = window.FB.helpers.image(`img_new_${Date.now()}`, `Private image ${n}`, palette[0], palette[1], palette[2], n + 10);
    savedCard.images.push(image);
    renderAttachments();
    window.Screens.toast(`Image ${n} attached to ${savedCard.key}.`, { tone: "success", icon: "image" });
  }

  function removeImage(id) {
    if (!savedCard) return;
    const image = savedCard.images.find((item) => item.id === id);
    savedCard.images = savedCard.images.filter((item) => item.id !== id);
    renderAttachments();
    window.Screens.toast(`${image ? image.label : "Image"} removed.`, { icon: "trash" });
  }

  function renderComments() {
    const card = savedCard;
    if (!card) return;
    $("#commentCountBadge").textContent = `${card.comments.length} comment${card.comments.length === 1 ? "" : "s"}`;
    $("#commentList").innerHTML = card.comments.map((comment) => {
      const author = window.FB.person(comment.authorId);
      return `<div class="comment">
        ${window.Screens.avatar(comment.authorId)}
        <div class="comment-main">
          <div class="comment-head">
            <span class="comment-author">${escape(author ? author.name : "Unknown")}</span>
            <span class="comment-role">${escape(author ? author.role : "")}</span>
            <span class="comment-time">${escape(window.Screens.relativeTime(comment.at))}</span>
          </div>
          <p class="comment-body">${escape(comment.body)}</p>
        </div>
      </div>`;
    }).join("");
  }

  function postComment() {
    if (!savedCard) return;
    const field = $("#firstComment");
    const body = field.value.trim();
    if (!body) {
      field.classList.add("is-invalid");
      field.focus();
      window.Screens.toast("Write a comment before posting.", { tone: "danger", icon: "alert" });
      return;
    }
    field.classList.remove("is-invalid");
    savedCard.comments.push({
      id: `comment_${Date.now()}`,
      authorId: me().id,
      body,
      at: new Date().toISOString()
    });
    savedCard.activity.push({
      id: `act_${Date.now()}`,
      actorId: me().id,
      icon: "comment",
      text: "posted a comment",
      at: new Date().toISOString()
    });
    field.value = "";
    countChars(field, $("#commentCount"), 5000);
    renderComments();
    window.Screens.toast(`Comment posted to ${savedCard.key}. Mention emails are simulated, not sent.`, { tone: "success", icon: "send" });
  }

  function resetForm() {
    savedCard = null;
    dirty = false;
    $("#savedState").hidden = true;
    $("#addCardForm").hidden = false;
    $("#addCardForm").reset();
    $("#cardColumn").value = "col_backlog";
    $("#cardPriority").value = "";
    $("#priorityError").hidden = true;
    $("#cardPriority").classList.remove("is-invalid");
    $("#cardPriority").removeAttribute("aria-invalid");
    $("#titleError").hidden = true;
    $("#dueError").hidden = true;
    $("#cardTitle").classList.remove("is-invalid");
    $("#cardDue").classList.remove("is-invalid");
    countChars($("#cardTitle"), $("#titleCount"), 200);
    countChars($("#cardDescription"), $("#descriptionCount"), 20000);
    countChars($("#firstComment"), $("#commentCount"), 5000);
    $$(".step").forEach((step, index) => {
      step.classList.toggle("is-active", index === 0);
      step.classList.remove("is-done");
    });
    renderAssignees();
    renderMeta();
    clearDirty();
    $("#cardTitle").focus({ preventScroll: true });
    window.Screens.toast("Ready for another card. The previous card remains in this prototype's memory.", { icon: "plus" });
  }

  function requestLeave(target) {
    if (savedCard || !dirty) {
      window.location.href = target;
      return;
    }
    navigating = true;
    window.Screens.openDialog("discardLayer");
  }

  function renderDenied() {
    $("#addContent").hidden = true;
    const denied = $("#addDenied");
    denied.innerHTML = window.Screens.accessDenied({
      title: "Only project editors can create cards",
      copy: `${me().name} is previewing the ${window.Screens.roleLabel()} role. Viewers can read cards, comments and images, but they cannot create cards, upload images or post comments.`,
      needed: "Owner, Manager or Member",
      backHref: "../index.html",
      backLabel: "Back to board"
    });
    denied.hidden = false;
  }

  function bind() {
    $("#addCardForm").addEventListener("submit", saveCard);
    $("#addCardForm").addEventListener("input", (event) => {
      if (event.target === $("#cardTitle")) countChars(event.target, $("#titleCount"), 200);
      if (event.target === $("#cardDescription")) countChars(event.target, $("#descriptionCount"), 20000);
      markDirty();
    });
    $("#firstComment").addEventListener("input", (event) => {
      countChars(event.target, $("#commentCount"), 5000);
    });
    $("#addCardForm").addEventListener("change", (event) => {
      if (event.target === $("#cardPriority") && ["low", "medium", "high", "urgent"].includes(event.target.value)) {
        $("#priorityError").hidden = true;
        event.target.classList.remove("is-invalid");
        event.target.removeAttribute("aria-invalid");
      }
      if (event.target.name === "assignee") renderAssigneeSummary();
      markDirty();
    });
    $("#clearDue").addEventListener("click", () => {
      $("#cardDue").value = "";
      markDirty();
      $("#cardDue").focus();
    });
    $("#assigneeList").addEventListener("change", renderAssigneeSummary);
    $("#imageDrop").addEventListener("click", addImage);
    $("#imageDrop").addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        addImage();
      }
    });
    $("#attachGrid").addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove-image]");
      if (remove) removeImage(remove.dataset.removeImage);
    });
    $("#postCommentBtn").addEventListener("click", postComment);
    $("#addAnother").addEventListener("click", resetForm);
    $("#viewCard").addEventListener("click", () => {
      if (!savedCard) return;
      window.Screens.toast(`${savedCard.key} exists only in this prototype. The approved board artifact cannot open it.`, { icon: "info" });
    });
    $("#cancelTop").addEventListener("click", (event) => {
      event.preventDefault();
      requestLeave("../index.html");
    });
    $("#cancelBottom").addEventListener("click", (event) => {
      event.preventDefault();
      requestLeave("../index.html");
    });
    $("#discardConfirm").addEventListener("click", () => {
      window.Screens.closeDialog("discardLayer");
      window.location.href = "../index.html";
    });
    $$("[data-close-dialog]").forEach((button) => {
      button.addEventListener("click", () => {
        window.Screens.closeDialog(button.dataset.closeDialog);
        navigating = false;
      });
    });
  }

  function render() {
    if (!window.Screens.can("editCard")) {
      renderDenied();
      return;
    }
    $("#addContent").hidden = false;
    $("#addDenied").hidden = true;
    renderMeta();
    renderAssignees();
    if (!savedCard) {
      countChars($("#cardTitle"), $("#titleCount"), 200);
      countChars($("#cardDescription"), $("#descriptionCount"), 20000);
    }
  }

  window.FBPage = {
    init() {
      $("#cardColumn").innerHTML = window.FB.columns
        .map((column) => `<option value="${column.id}">${escape(column.name)}</option>`)
        .join("");
      bind();
      render();
      $("#cardTitle").focus({ preventScroll: true });
    },
    render() {
      render();
    },
    beforeRoleChange() {
      if (savedCard || !dirty) return true;
      return window.Screens.confirm({
        title: "Change role and discard the draft?",
        copy: "The unsaved card details will be lost. The role preview is a design-review control, not a permission change.",
        confirmLabel: "Discard draft",
        tone: "danger",
        icon: "alert"
      });
    },
    beforeUnload() {
      return Boolean(dirty && !savedCard && !navigating);
    }
  };
})();
