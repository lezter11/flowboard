/* Flowboard UI artifact — comments, mentions, activity and tabs. */
(function () {
  "use strict";

  const { state, people, helpers, can } = FB;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const escape = helpers.escapeHTML;

  const icon = (name, cls) =>
    `<svg class="icon${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${name === "user" ? "users" : name}"></use></svg>`;

  function activeCard() {
    return state.activeCardId ? FB.card(state.activeCardId) : null;
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlightMentions(body) {
    let html = escape(body || "");
    const names = Object.values(people)
      .filter((person) => person.mentionable)
      .map((person) => person.name)
      .sort((a, b) => b.length - a.length);
    names.forEach((name) => {
      const safe = escape(name);
      html = html.replace(new RegExp("@" + escapeRegExp(safe), "g"), `<span class="mention">@${safe}</span>`);
    });
    return html;
  }

  function applyTab(tab) {
    const next = tab === "activity" ? "activity" : "comments";
    state.tab = next;
    const commentsTab = $("#commentsTab");
    const activityTab = $("#activityTab");
    const commentsPanel = $("#commentsPanel");
    const activityPanel = $("#activityPanel");
    if (!commentsTab || !activityTab) return;
    const commentsSelected = next === "comments";
    commentsTab.setAttribute("aria-selected", String(commentsSelected));
    activityTab.setAttribute("aria-selected", String(!commentsSelected));
    commentsTab.tabIndex = commentsSelected ? 0 : -1;
    activityTab.tabIndex = commentsSelected ? -1 : 0;
    commentsPanel.hidden = !commentsSelected;
    activityPanel.hidden = commentsSelected;
  }

  function renderComments(card) {
    const list = $("#commentList");
    if (!list) return;
    const current = FB.currentUser();
    const sorted = card.comments.slice().sort((a, b) => new Date(a.at) - new Date(b.at));

    if (!sorted.length) {
      list.innerHTML = `<div class="comment-empty">No comments yet.${can("comment") ? " Start the discussion below." : ""}</div>`;
      return;
    }

    list.innerHTML = sorted.map((comment) => {
      const author = FB.person(comment.authorId) || { name: "Former member", initials: "?", tone: "", role: "Former" };
      const own = comment.authorId === current.id;
      const canEdit = can("comment") && own;
      const canDelete = can("comment") && (own || can("moderate"));
      const editing = state.editingCommentId === comment.id;
      const body = editing
        ? `<div class="comment-edit">
            <label class="sr-only" for="edit-${comment.id}">Edit comment</label>
            <textarea class="comment-edit-input" id="edit-${comment.id}" data-edit-input rows="3">${escape(comment.body)}</textarea>
            <div class="comment-edit-actions">
              <button class="btn ghost sm" type="button" data-cancel-edit>Cancel</button>
              <button class="btn primary sm" type="button" data-save-edit>Save comment</button>
            </div>
          </div>`
        : `<div class="comment-body">${highlightMentions(comment.body)}</div>`;

      const actions = !editing && (canEdit || canDelete)
        ? `<div class="comment-actions">
            ${canEdit ? `<button class="comment-action" type="button" data-edit-comment="${comment.id}">Edit</button>` : ""}
            ${canDelete ? `<button class="comment-action danger" type="button" data-delete-comment="${comment.id}">${own ? "Delete" : "Remove"}</button>` : ""}
          </div>`
        : "";

      return `<div class="comment" data-comment-id="${comment.id}">
        <span class="avatar ${author.tone}" aria-hidden="true">${author.initials}</span>
        <div class="comment-main">
          <div class="comment-head">
            <span class="comment-author">${escape(author.name)}</span>
            <span class="comment-role">${escape(author.role)}</span>
            <span class="comment-time">${helpers.relativeTime(comment.at)}${comment.editedAt ? " · edited" : ""}</span>
          </div>
          ${body}
          ${actions}
        </div>
      </div>`;
    }).join("");

    if (state.editingCommentId) {
      const input = $(`#edit-${state.editingCommentId}`);
      if (input) {
        input.focus();
        input.selectionStart = input.value.length;
        input.selectionEnd = input.value.length;
      }
    }
  }

  function renderActivity(card) {
    const list = $("#activityList");
    if (!list) return;
    const sorted = card.activity.slice().sort((a, b) => new Date(b.at) - new Date(a.at));
    list.innerHTML = sorted.map((event) => {
      const actor = FB.person(event.actorId) || { name: "Former member" };
      return `<div class="activity-item">
        <span class="activity-icon">${icon(event.icon || "edit")}</span>
        <div class="activity-main">
          <div class="activity-text"><strong>${escape(actor.name)}</strong> ${escape(event.text)}</div>
          <div class="activity-time">${helpers.relativeTime(event.at)}</div>
        </div>
      </div>`;
    }).join("");
  }

  function updatePostState() {
    const input = $("#commentInput");
    const button = $("#postCommentBtn");
    if (!input || !button) return;
    button.disabled = !can("comment") || !input.value.trim();
  }

  function renderMentionMenu() {
    const menu = $("#mentionMenu");
    if (!menu) return;
    menu.innerHTML = Object.values(people)
      .filter((person) => person.mentionable)
      .map((person) => `<button class="mention-option" type="button" data-mention="${person.id}">
        <span class="avatar ${person.tone}" aria-hidden="true">${person.initials}</span>${escape(person.name)}
      </button>`).join("");
  }

  function renderDiscussion(card) {
    if (!card) return;
    $("#commentCount").textContent = card.comments.length;
    $("#activityCount").textContent = card.activity.length;
    renderComments(card);
    renderActivity(card);
    applyTab(state.tab);

    const composer = $("#commentComposer");
    const notice = $("#viewerNotice");
    composer.hidden = !can("comment");
    notice.hidden = can("comment");
    const input = $("#commentInput");
    if (input) {
      input.value = state.commentDraft || "";
      updatePostState();
    }
    renderMentionMenu();
  }

  function postComment() {
    const card = activeCard();
    const input = $("#commentInput");
    if (!card || !input || !can("comment")) return;
    const body = input.value.trim();
    if (!body) return;

    card.comments.push({
      id: `c_${Date.now()}`,
      authorId: FB.currentUser().id,
      body,
      at: new Date().toISOString()
    });
    FB.addActivity(card, "comment", "posted a comment");
    state.commentDraft = "";
    input.value = "";
    renderDiscussion(card);
    FB.renderAll();
    updatePostState();
    input.focus();
    const list = $("#commentList");
    if (list && list.lastElementChild) list.lastElementChild.scrollIntoView({ block: "nearest" });
  }

  async function deleteComment(commentId) {
    const card = activeCard();
    if (!card) return;
    const index = card.comments.findIndex((comment) => comment.id === commentId);
    if (index < 0) return;
    const comment = card.comments[index];
    const author = FB.person(comment.authorId);
    const own = comment.authorId === FB.currentUser().id;
    if (!can("comment") || (!own && !can("moderate"))) return;

    const accepted = await FB.confirmAction({
      title: "Remove this comment?",
      copy: `The comment from ${author ? author.name : "a former member"} will be removed. This cannot be undone.`,
      confirmLabel: "Remove comment",
      tone: "danger",
      icon: "message"
    });
    if (!accepted) return;

    card.comments.splice(index, 1);
    const event = FB.addActivity(card, "comment", "removed a comment");
    renderDiscussion(card);
    FB.renderAll();
    FB.toast("Comment removed.", {
      icon: "message",
      undo() {
        card.comments.splice(index, 0, comment);
        card.activity = card.activity.filter((item) => item.id !== event.id);
        renderDiscussion(card);
        FB.renderAll();
        FB.toast("Comment restored.", { tone: "success", icon: "undo" });
      }
    });
  }

  function startEdit(commentId) {
    state.editingCommentId = commentId;
    const card = activeCard();
    if (card) renderComments(card);
  }

  function cancelEdit() {
    state.editingCommentId = null;
    const card = activeCard();
    if (card) renderComments(card);
  }

  function saveEdit() {
    const card = activeCard();
    if (!card || !state.editingCommentId) return;
    const input = $("[data-edit-input]");
    if (!input) return;
    const body = input.value.trim();
    if (!body) {
      FB.toast("A comment cannot be empty.", { tone: "danger", icon: "alert" });
      input.focus();
      return;
    }
    const comment = card.comments.find((item) => item.id === state.editingCommentId);
    if (!comment) return;
    comment.body = body;
    comment.editedAt = new Date().toISOString();
    FB.addActivity(card, "comment", "edited a comment");
    state.editingCommentId = null;
    renderDiscussion(card);
    FB.renderAll();
  }

  function insertMention(personId) {
    const input = $("#commentInput");
    const person = FB.person(personId);
    if (!input || !person || !can("comment")) return;
    const start = input.selectionStart == null ? input.value.length : input.selectionStart;
    const end = input.selectionEnd == null ? input.value.length : input.selectionEnd;
    const token = `@${person.name} `;
    input.value = input.value.slice(0, start) + token + input.value.slice(end);
    state.commentDraft = input.value;
    const caret = start + token.length;
    input.focus();
    input.selectionStart = caret;
    input.selectionEnd = caret;
    $("#mentionMenu").hidden = true;
    $("#mentionBtn").setAttribute("aria-expanded", "false");
    updatePostState();
  }

  function toggleMentionMenu() {
    const menu = $("#mentionMenu");
    const button = $("#mentionBtn");
    if (!menu || !button || !can("comment")) return;
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    button.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) {
      renderMentionMenu();
      const first = menu.querySelector("button");
      if (first) first.focus();
    } else {
      $("#commentInput").focus();
    }
  }

  function closeDiscussionPickers() {
    let closed = false;
    const menu = $("#mentionMenu");
    if (menu && !menu.hidden) {
      menu.hidden = true;
      $("#mentionBtn").setAttribute("aria-expanded", "false");
      closed = true;
    }
    if (state.editingCommentId) {
      cancelEdit();
      closed = true;
    }
    return closed;
  }

  function bindDiscussion() {
    $("#commentsTab").addEventListener("click", () => applyTab("comments"));
    $("#activityTab").addEventListener("click", () => applyTab("activity"));
    $(".tabs").addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = state.tab === "comments" ? "activity" : "comments";
      applyTab(next);
      const target = next === "comments" ? $("#commentsTab") : $("#activityTab");
      target.focus();
    });

    const input = $("#commentInput");
    input.addEventListener("input", () => {
      state.commentDraft = input.value;
      updatePostState();
    });
    input.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        postComment();
      }
    });
    $("#postCommentBtn").addEventListener("click", postComment);
    $("#mentionBtn").addEventListener("click", toggleMentionMenu);

    $("#mentionMenu").addEventListener("click", (event) => {
      const button = event.target.closest("[data-mention]");
      if (button) insertMention(button.dataset.mention);
    });

    $("#commentList").addEventListener("click", (event) => {
      const edit = event.target.closest("[data-edit-comment]");
      const remove = event.target.closest("[data-delete-comment]");
      const cancel = event.target.closest("[data-cancel-edit]");
      const save = event.target.closest("[data-save-edit]");
      if (edit) startEdit(edit.dataset.editComment);
      else if (remove) deleteComment(remove.dataset.deleteComment);
      else if (cancel) cancelEdit();
      else if (save) saveEdit();
    });

    $("#commentList").addEventListener("keydown", (event) => {
      if (!event.target.matches("[data-edit-input]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelEdit();
      } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        saveEdit();
      }
    });

    document.addEventListener("click", (event) => {
      const menu = $("#mentionMenu");
      const button = $("#mentionBtn");
      if (!menu || menu.hidden) return;
      if (event.target.closest("#mentionMenu") || event.target.closest("#mentionBtn")) return;
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    });
  }

  document.addEventListener("DOMContentLoaded", bindDiscussion);

  FB.renderDiscussion = renderDiscussion;
  FB.closeDiscussionPickers = closeDiscussionPickers;
})();
