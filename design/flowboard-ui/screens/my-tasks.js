/* My tasks: synthetic, access-filtered portfolio preview. No server writes. */
(function () {
  "use strict";
  const S = window.Screens, FB = window.FB, P = window.Portfolio;
  const $ = (selector) => document.querySelector(selector);
  const esc = S.escape, icon = S.icon;
  const params = new URLSearchParams(location.search);
  const priorities = ["urgent", "high", "medium", "low", "none"];
  const dueFilters = ["overdue", "today", "week", "later", "none"];
  const state = { q: "", project: params.get("project") || "", priority: priorities.includes(params.get("priority")) ? params.get("priority") : "", due: dueFilters.includes(params.get("due")) ? params.get("due") : "", showDone: params.get("completed") === "1" };
  const buckets = [
    { id:"overdue", label:"Overdue", icon:"alert" },
    { id:"today", label:"Due today", icon:"calendar" },
    { id:"week", label:"Next 7 days", icon:"clock" },
    { id:"later", label:"Later", icon:"calendar" },
    { id:"none", label:"No due date", icon:"list" }
  ];
  const ranks = { urgent:0, high:1, medium:2, low:3, none:4 };
  function assigned() {
    return P.projects().filter(p => p.status !== "archived").flatMap(p => P.cards({ projectId:p.id }))
      .filter(c => Array.isArray(c.assignees) && c.assignees.includes(S.currentUser().id));
  }
  function bucket(card) {
    if (!card.due) return "none";
    const days = FB.helpers.daysUntil(card.due);
    if (days === null) return "none";
    if (days < 0) return "overdue";
    if (days === 0) return "today";
    return days <= 7 ? "week" : "later";
  }
  function matches(card) {
    if (state.project && state.project !== card.projectId) return false;
    if (state.priority && state.priority !== (card.priority || "none")) return false;
    if (state.due && state.due !== bucket(card)) return false;
    const q = state.q.trim().toLowerCase();
    return !q || [card.title, card.key, card.projectName, card.boardName, card.columnName].join(" ").toLowerCase().includes(q);
  }
  function sort(a,b) {
    if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
    if (a.due && !b.due) return -1;
    if (!a.due && b.due) return 1;
    return (ranks[a.priority] ?? 9) - (ranks[b.priority] ?? 9) || a.title.localeCompare(b.title);
  }
  function dueLabel(card, done) {
    if (done) return "Completed";
    if (!card.due) return "No due date";
    const group = bucket(card);
    if (group === "today") return "Due today";
    return `${group === "overdue" ? "Overdue" : "Due"} · ${FB.helpers.formatShort(card.due)}`;
  }
  function row(card, done) {
    const href = P.cardHref(card), priority = card.priority || "none", due = bucket(card);
    const label = priority === "none" ? "No priority" : priority[0].toUpperCase() + priority.slice(1);
    return `<article class="work-row ${done ? "is-done" : ""}" data-due="${esc(due)}">
      <span class="row-marker" aria-hidden="true">${icon(done ? "check-circle" : "board")}</span>
      <div class="work-row-main"><div class="work-row-title"><a href="${esc(href)}">${esc(card.title)}</a><span class="work-key">${esc(card.key)}</span></div>
      <div class="work-row-context"><span>${esc(card.projectName)}</span><span aria-hidden="true">/</span><span>${esc(card.boardName)}</span><span aria-hidden="true">·</span><span>${esc(card.columnName)}</span></div></div>
      <div class="work-row-meta"><span class="priority-label priority-${esc(priority)}">${esc(label)}</span><span class="due-label ${done ? "done" : esc(due)}">${icon(done ? "check" : "calendar")}${esc(dueLabel(card,done))}</span></div>
      <a class="work-open" href="${esc(href)}" aria-label="Open ${esc(card.key)} on ${esc(card.boardName)}">${icon("arrow-right")}</a></article>`;
  }
  function empty(title, text, showClear) {
    return `<div class="queue-empty">${icon("check-circle")}<strong>${esc(title)}</strong><span>${esc(text)}</span>${showClear ? '<button type="button" data-clear-filters>Clear filters</button>' : ''}</div>`;
  }
  function render() {
    const projects = P.projects().filter(p => p.status !== "archived");
    if (state.project && !projects.some(p => p.id === state.project)) state.project = "";
    const selector = $("#taskProject");
    selector.innerHTML = '<option value="">All projects</option>' + projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
    selector.value = state.project;
    const all = assigned(), open = all.filter(c => c.category !== "done"), completed = all.filter(c => c.category === "done");
    const visible = open.filter(matches), done = completed.filter(matches).sort(sort);
    const count = (key) => open.filter(c => bucket(c) === key).length;
    $("#openCount").textContent = open.length;
    const taskLink = document.querySelector('#rail a[href^="my-tasks.html"]');
    let taskBadge = taskLink?.querySelector('[data-nav-badge="tasks"]');
    if (taskLink && open.length && !taskBadge) { taskBadge = document.createElement("span"); taskBadge.className = "nav-badge quiet"; taskBadge.dataset.navBadge = "tasks"; taskLink.appendChild(taskBadge); }
    if (taskBadge) { taskBadge.textContent = open.length ? String(open.length) : ""; taskBadge.hidden = !open.length; }
    for (const [id,key] of [["statOverdue","overdue"],["statToday","today"],["statWeek","week"]]) $("#"+id).textContent = count(key);
    $(".work-overview").classList.toggle("has-overdue", count("overdue") > 0);
    document.querySelectorAll("[data-quick-due]").forEach(b => b.setAttribute("aria-pressed", String(state.due === b.dataset.quickDue)));
    $("#taskSub").textContent = `${open.length} open ${open.length === 1 ? "task" : "tasks"} across ${new Set(open.map(c => c.projectId)).size} ${new Set(open.map(c => c.projectId)).size === 1 ? "project" : "projects"}`;
    $("#taskTotalBadge").textContent = `${visible.length} ${visible.length === 1 ? "task" : "tasks"}`;
    const filtered = !!(state.q || state.project || state.priority || state.due);
    $("#clearTaskFilters").hidden = !filtered;
    $("#taskFilterSummary").textContent = filtered ? `${visible.length} matching ${visible.length === 1 ? "task" : "tasks"}` : "All open tasks";
    $("#taskPriority").value = state.priority; $("#taskDue").value = state.due;
    if (!visible.length) $("#taskList").innerHTML = filtered ? empty("No matching tasks", "Try a different filter or search.", true) : empty("Your queue is clear", "Assigned tasks will appear here.", false);
    else $("#taskList").innerHTML = buckets.map(g => {
      const cards = visible.filter(c => bucket(c) === g.id).sort(sort); if (!cards.length) return "";
      return `<section class="work-group" data-group="${g.id}" aria-labelledby="group-${g.id}"><div class="work-group-heading">${icon(g.icon)}<h3 id="group-${g.id}">${g.label}</h3><span>${cards.length}</span></div>${cards.map(c => row(c,false)).join("")}</section>`;
    }).join("");
    $("#completedCount").textContent = done.length;
    $("#completedToggle").setAttribute("aria-expanded", String(state.showDone));
    $("#completedList").hidden = !state.showDone;
    $("#completedList").innerHTML = state.showDone ? (done.length ? done.map(c => row(c,true)).join("") : empty("No completed tasks", "Completed tasks appear here.", false)) : "";
    syncUrl();
  }
  function syncUrl() {
    const url = new URL(location.href);
    for (const [key, value] of [["project",state.project],["priority",state.priority],["due",state.due],["completed",state.showDone ? "1" : ""]]) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    url.searchParams.delete("q");
    if (url.href !== location.href) history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  function clear() { state.q = state.project = state.priority = state.due = ""; $("#taskSearch").value = ""; render(); }
  function init() {
    $("#taskSearch").addEventListener("input", e => { state.q = e.target.value; render(); });
    for (const [id,key] of [["taskProject","project"],["taskPriority","priority"],["taskDue","due"]]) $("#"+id).addEventListener("change", e => { state[key] = e.target.value; render(); });
    $("#clearTaskFilters").addEventListener("click", clear);
    $("#taskList").addEventListener("click", e => { if (e.target.closest("[data-clear-filters]")) clear(); });
    document.querySelectorAll("[data-quick-due]").forEach(b => b.addEventListener("click", () => { state.due = state.due === b.dataset.quickDue ? "" : b.dataset.quickDue; render(); }));
    $("#completedToggle").addEventListener("click", () => { state.showDone = !state.showDone; render(); });
    render();
  }
  window.FBPage = { init, render };
})();
