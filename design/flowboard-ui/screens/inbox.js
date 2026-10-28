/* Flowboard Inbox — triage desk controller.
   Design artifact: session-only read state, synthetic data, no API calls.
   Structure: lane buckets → thread rows → reading pane. Motion is scoped —
   GSAP for the triage sequence, Lenis for the notification stream only. */
(function () {
  "use strict";

  const SD = window.SD;
  const FB = window.FB;
  const S = window.Screens;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const escape = S.escape;

  const LANES = [
    { id: "needs", label: "Needs you", hint: "Unread mentions, assignments and replies" },
    { id: "updates", label: "Updates", hint: "Card events, imports and restores" },
    { id: "access", label: "Access", hint: "Invitations and membership changes" }
  ];
  const LANE_IDS = ["all"].concat(LANES.map((lane) => lane.id));
  const ACTIONABLE = ["mention", "assignment", "comment"];
  const TYPE = {
    mention: {
      icon: "at", label: "Mention",
      rule: ""
    },
    assignment: {
      icon: "user-check", label: "Assignment",
      rule: ""
    },
    comment: {
      icon: "comment", label: "Reply",
      rule: ""
    },
    import: {
      icon: "upload", label: "Import",
      rule: ""
    },
    restore: {
      icon: "restore", label: "Restore",
      rule: ""
    },
    invite: {
      icon: "mail", label: "Access",
      rule: ""
    }
  };

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motionOK = () => !motionQuery.matches;

  const params = new URLSearchParams(window.location.search);
  const state = {
    lane: LANE_IDS.includes(params.get("lane")) ? params.get("lane") : "all",
    q: "",
    selected: params.get("thread") || null,
    read: Object.create(null),
    lenis: null,
    rafId: 0,
    searchTimer: 0,
    resizeTimer: 0
  };

  const dom = {};

  /* ---------- model ---------- */

  function me() { return S.currentUser(); }
  function sourceBoard(item) {
    const project = SD.project(item.projectId);
    const card = item.cardId ? FB.card(item.cardId) : null;
    const id = item.boardId || card?.boardId || (project?.boardIds?.length === 1 ? project.boardIds[0] : "");
    const board = id ? window.Portfolio?.board(id) : null;
    return board?.projectId === item.projectId ? board : null;
  }
  function loadReadState() {
    try {
      const value = JSON.parse(sessionStorage.getItem(`flowboard-inbox-read-${me().id}`) || "{}");
      state.read = value && typeof value === "object" && !Array.isArray(value) ? value : Object.create(null);
    } catch (_) { state.read = Object.create(null); }
  }
  function saveReadState() {
    try { sessionStorage.setItem(`flowboard-inbox-read-${me().id}`, JSON.stringify(state.read)); } catch (_) { /* retained in memory until the tab closes */ }
  }
  function items() {
    return SD.inboxFor(me().id).filter((item) => {
      if (!item.projectId || !window.Portfolio?.project(item.projectId)) return false;
      if (item.cardId || ["import", "restore"].includes(item.type)) return Boolean(sourceBoard(item));
      return true;
    });
  }
  function readOf(item) {
    return Object.prototype.hasOwnProperty.call(state.read, item.id) ? state.read[item.id] : Boolean(item.read);
  }
  function threadKey(item) { return item.cardId ? "card:" + item.cardId : "item:" + item.id; }
  function timeOf(item) { return new Date(item.at).getTime(); }

  function buildThreads() {
    const groups = new Map();
    items().forEach((item) => {
      const key = threadKey(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    const threads = Array.from(groups.entries()).map(([id, group]) => {
      const sorted = group.slice().sort((a, b) => timeOf(b) - timeOf(a));
      const unread = sorted.filter((item) => !readOf(item));
      const lane = unread.some((item) => ACTIONABLE.includes(item.type))
        ? "needs"
        : (sorted.some((item) => item.type === "invite") ? "access" : "updates");
      return {
        id,
        items: sorted,
        latest: sorted[0],
        unread,
        unreadCount: unread.length,
        lane,
        type: sorted[0].type
      };
    });
    return threads.sort((a, b) => timeOf(b.latest) - timeOf(a.latest));
  }

  function findThread(id) {
    return buildThreads().find((thread) => thread.id === id) || null;
  }

  function haystack(thread) {
    const latest = thread.latest;
    const card = latest.cardId ? FB.card(latest.cardId) : null;
    const project = SD.project(latest.projectId);
    const board = sourceBoard(latest);
    return [
      card ? card.key : "",
      card ? card.title : "",
      project ? project.name : "",
      board ? board.name : "",
      thread.items.map((item) => S.personName(item.actorId)).join(" "),
      thread.items.map((item) => item.text).join(" "),
      thread.items.map((item) => item.excerpt).join(" ")
    ].join(" ").toLowerCase();
  }

  function matches(thread, query) {
    return !query || haystack(thread).includes(query);
  }

  function visibleThreads() {
    const query = state.q.trim().toLowerCase();
    return buildThreads()
      .filter((thread) => state.lane === "all" || thread.lane === state.lane)
      .filter((thread) => matches(thread, query));
  }

  function otherLaneMatches() {
    const query = state.q.trim().toLowerCase();
    if (!query || state.lane === "all") return 0;
    return buildThreads().filter((thread) => thread.lane !== state.lane && matches(thread, query)).length;
  }

  /* ---------- descriptions ---------- */

  function dueLabel(card) {
    const info = card ? FB.helpers.dueInfo(card) : null;
    return info ? info.label : "No due date";
  }

  function describe(thread) {
    const latest = thread.latest;
    const card = latest.cardId ? FB.card(latest.cardId) : null;
    const project = SD.project(latest.projectId);
    const board = sourceBoard(latest);
    const type = TYPE[latest.type] || TYPE.mention;
    const view = {
      key: card ? card.key : "UPDATE",
      title: card ? card.title : "",
      kind: latest.type,
      kindLabel: type.label,
      rule: type.rule,
      card,
      project,
      board,
      subtitle: [project ? project.name : "", board ? board.name : ""].filter(Boolean).join(" / "),
      facts: [],
      cta: { label: "Open card", icon: "external", href: "" },
      meta: []
    };

    if (card) {
      const column = FB.column(card.columnId);
      view.facts = [
        { label: "Project", value: project ? project.name : "—" },
        { label: "Board", value: board ? board.name : "—" },
        { label: "Column", value: column ? column.name : "—" },
        { label: "Priority", value: card.priority.charAt(0).toUpperCase() + card.priority.slice(1) },
        { label: "Due", value: dueLabel(card) },
        { label: "Assignees", value: card.assignees.length ? card.assignees.map((id) => S.personName(id)).join(", ") : "Unassigned" }
      ];
      view.meta = [{ text: column ? column.name : "", kind: "column" }, { text: dueLabel(card), kind: "due" }];
      view.cta = { label: "Open card", icon: "external", href: board ? window.Portfolio.boardHref(board.id, card.id) : "" };
      return view;
    }

    if (latest.type === "import") {
      view.key = "IMPORT";
      view.title = "Import completed";
      view.facts = [
        { label: "Project", value: project ? project.name : "—" },
        { label: "Board", value: board ? board.name : "—" }
      ];
      view.cta = { label: "Open board", icon: "board", href: board ? window.Portfolio.boardHref(board.id) : "" };
      return view;
    }

    if (latest.type === "restore") {
      const keyMatch = /WEB-\d+/.exec(`${latest.text} ${latest.excerpt}`);
      const restored = latest.excerpt.split(" before ")[0].replace(/\.$/, "");
      view.key = keyMatch ? keyMatch[0] : "RESTORE";
      view.title = restored || "Card restored";
      view.facts = [
        { label: "Project", value: project ? project.name : "—" },
        { label: "Board", value: board ? board.name : "—" },
        { label: "Restored to", value: restored.replace(/^Restored to /i, "") || "—" },
        { label: "Trash window", value: "24 hours" }
      ];
      view.meta = ["24-hour window"];
      view.cta = { label: "Open board", icon: "board", href: board ? window.Portfolio.boardHref(board.id) : "" };
      return view;
    }

    const aboutMe = latest.text.indexOf("invited you") === 0;
    const subjectId = aboutMe ? me().id : latest.actorId;
    const member = SD.members.find((entry) => entry.personId === subjectId);
    view.key = "ACCESS";
    view.title = latest.excerpt.split(". ")[0].replace(/\.$/, "") || "Membership changed";
    view.facts = [
      { label: "Project", value: project ? project.name : "—" },
      { label: "Person", value: S.personName(subjectId) },
      { label: "Role", value: member ? member.role : "—" },
      { label: "Status", value: aboutMe ? "Accepted" : "Active" }
    ];
    view.meta = [member ? member.role : "", "Access"];
    const peopleParams = new URLSearchParams({ project: latest.projectId });
    if (S.role !== "owner") peopleParams.set("role", S.role);
    if (document.documentElement.dataset.theme === "dark") peopleParams.set("theme", "dark");
    view.cta = { label: "Open people", icon: "users", href: project ? `people.html?${peopleParams}` : "" };
    return view;
  }

  /* ---------- list rendering ---------- */

  function rowHTML(thread) {
    const view = describe(thread);
    const latest = thread.latest;
    const unread = thread.unreadCount > 0;
    const type = TYPE[latest.type] || TYPE.mention;
    const actor = S.personName(latest.actorId);
    const action = latest.text.replace(/\s+(?:in|to)\s+WEB-\d+$/i, "");
    return `<button class="thread-row${unread ? " is-unread" : ""}" type="button" data-category="${escape(thread.lane)}" data-thread="${escape(thread.id)}" aria-current="${state.selected === thread.id ? "true" : "false"}">
      <span class="thread-glyph ${latest.type}" aria-hidden="true">${S.icon(type.icon)}</span>
      <span class="thread-main">
        <span class="thread-title">
          <span class="thread-key">${escape(view.key)}</span>
          <span class="thread-name">${escape(view.title)}</span>
        </span>
        <span class="thread-line"><strong>${escape(actor)}</strong> ${escape(action)}</span>
        ${latest.excerpt ? `<span class="thread-quote">${escape(latest.excerpt)}</span>` : ""}
        <span class="thread-meta">
          <span class="project-dot" aria-hidden="true"></span>
          <span>${escape(view.subtitle)}</span>
          ${view.meta.map((part) => typeof part === "string" ? part : part.text).filter(Boolean).map((part) => `<span class="dot" aria-hidden="true"></span><span>${escape(part)}</span>`).join("")}
        </span>
      </span>
      <span class="thread-side">
        <span class="thread-time">${escape(S.relativeTime(latest.at))}</span>
        <span class="thread-state">
          ${thread.items.length > 1 ? `<span class="thread-stack" aria-label="${thread.items.length} events">${thread.items.length}</span>` : ""}
          ${unread
            ? `<span class="unread-dot" aria-label="${thread.unreadCount} unread"></span>`
            : `<span class="read-check" aria-hidden="true">${S.icon("check")}</span>`}
        </span>
      </span>
    </button>`;
  }

  function emptyHTML() {
    const query = state.q.trim();
    if (query) {
      const others = otherLaneMatches();
      return `<div class="stream-empty">
        <span class="empty-glyph" aria-hidden="true">${S.icon("search")}</span>
        <h3>No notifications match “${escape(query)}”</h3>
        <p>Search covers card keys, titles, people, projects and comment text.</p>
        <div class="empty-actions">
          <button class="btn soft" type="button" data-clear-search>Clear search</button>
          ${others ? `<button class="btn" type="button" data-search-all>Search all lanes <span class="lane-count">${others}</span></button>` : ""}
        </div>
      </div>`;
    }
    if (state.lane === "all") {
      return `<div class="stream-empty">
        <span class="empty-glyph" aria-hidden="true">${S.icon("check-circle")}</span>
        <h3>You're all caught up</h3>
        <p>New mentions, assignments, imports and access changes appear here.</p>
      </div>`;
    }
    const lane = LANES.find((entry) => entry.id === state.lane);
    const copy = {
      needs: "Unread mentions, assignments and replies land here. Reading one moves it to Updates.",
      updates: "Card events, imports and restores you have already read stay here.",
      access: "Invitations and membership changes appear here."
    }[state.lane];
    return `<div class="stream-empty">
      <span class="empty-glyph" aria-hidden="true">${S.icon(state.lane === "needs" ? "check-circle" : "inbox")}</span>
      <h3>${state.lane === "needs" ? "Needs you is clear" : `No ${lane ? lane.label.toLowerCase() : "notifications"} yet`}</h3>
      <p>${copy}</p>
      ${state.lane === "needs" ? "" : `<div class="empty-actions"><button class="btn soft" type="button" data-show-all>Show all notifications</button></div>`}
    </div>`;
  }

  function listHTML(threads) {
    if (!threads.length) return emptyHTML();
    if (state.lane !== "all") return threads.map(rowHTML).join("");
    return LANES.map((lane) => {
      const inLane = threads.filter((thread) => thread.lane === lane.id);
      if (!inLane.length) return "";
      return `<section class="lane" data-category="${lane.id}" aria-labelledby="lane-${lane.id}">
        <header class="lane-head" id="lane-${lane.id}">
          <span class="lane-dot ${lane.id}" aria-hidden="true"></span>
          <span>${lane.label}</span>
          <span class="lane-count">${inLane.length}</span>
          <span class="lane-hint">${lane.hint}</span>
        </header>
        ${inLane.map(rowHTML).join("")}
      </section>`;
    }).join("");
  }

  function measureRows() {
    const first = new Map();
    $$(".thread-row", dom.inner).forEach((row) => {
      first.set(row.dataset.thread, row.getBoundingClientRect().top);
    });
    return first;
  }

  function playFlip(first) {
    if (!window.gsap || !motionOK()) return;
    const rows = $$(".thread-row", dom.inner);
    rows.forEach((row, index) => {
      const before = first.get(row.dataset.thread);
      if (before === undefined) {
        window.gsap.from(row, {
          opacity: 0, duration: 0.18, ease: "power1.out",
          delay: Math.min(index * 0.01, 0.08), clearProps: "opacity"
        });
        return;
      }
      const delta = before - row.getBoundingClientRect().top;
      if (Math.abs(delta) > 1) {
        window.gsap.fromTo(row, { y: delta }, {
          y: 0, duration: 0.28, ease: "power2.out", clearProps: "transform"
        });
      }
    });
  }

  function playEntrance() {
    if (!window.gsap || !motionOK()) return;
    const rows = $$(".thread-row", dom.inner);
    if (!rows.length) return;
    window.gsap.from(rows, {
      opacity: 0, y: 6, duration: 0.22, ease: "power2.out",
      stagger: 0.024, clearProps: "opacity,transform"
    });
  }

  function renderList(options) {
    const opts = options || {};
    dom.inner.innerHTML = listHTML(visibleThreads());
    if (opts.first) playFlip(opts.first);
    else if (opts.entrance) playEntrance();
  }

  /* ---------- pane ---------- */

  function eventHTML(item) {
    const read = readOf(item);
    const actor = S.personName(item.actorId);
    return `<li class="event${read ? "" : " is-unread"}">
      ${S.avatar(item.actorId)}
      <div class="event-copy">
        <strong>${escape(actor)}</strong> ${escape(item.text)}
        ${item.excerpt ? `<span class="event-quote">${escape(item.excerpt)}</span>` : ""}
      </div>
      <div class="event-side">
        <span class="event-time">${escape(S.relativeTime(item.at))}</span>
        <button class="icon-btn" type="button" data-item="${escape(item.id)}"
          aria-label="${read ? "Mark unread" : "Mark read"}: ${escape(actor)} ${escape(item.text)}"
          title="${read ? "Mark unread" : "Mark read"}">${S.icon(read ? "check-circle" : "check")}</button>
      </div>
    </li>`;
  }

  function detailHTML(thread) {
    if (!thread) {
      const lane = LANES.find((entry) => entry.id === state.lane);
      const query = state.q.trim();
      const title = query ? "No thread matches" : (lane ? `${lane.label} is clear` : "Inbox clear");
      const copy = query
        ? `Nothing in this lane matches “${query}”. Clear the search to look across every lane.`
        : (lane
          ? "Pick another lane to keep triaging. Read threads stay in Updates and Access."
          : "New mentions, assignments, imports and access changes appear here.");
      return `<div class="detail-empty">
        <span class="empty-glyph" aria-hidden="true">${S.icon(query ? "search" : (state.lane === "needs" ? "check-circle" : "inbox"))}</span>
        <h3>${escape(title)}</h3>
        <p>${escape(copy)}</p>
        <div class="empty-actions">
          ${query ? `<button class="btn soft" type="button" data-clear-search>Clear search</button>` : ""}
          ${state.lane !== "all" ? `<button class="btn" type="button" data-show-all>Show all notifications</button>` : ""}
        </div>
      </div>`;
    }
    const view = describe(thread);
    const latest = thread.latest;
    const unread = thread.unreadCount > 0;
    return `<div class="detail-head">
        <span class="detail-kind ${latest.type}">${S.icon(TYPE[latest.type] ? TYPE[latest.type].icon : "inbox")}${escape(view.kindLabel)}</span>
        <span class="detail-state${unread ? "" : " is-read"}">${unread ? `${thread.unreadCount} unread` : "Read"}</span>
        <span class="detail-time">${escape(S.relativeTime(latest.at))}</span>
      </div>
      <h2 class="detail-title" id="detailTitle">${escape(view.title)}</h2>
      <p class="detail-sub">${escape(view.key)}${view.subtitle ? ` · ${escape(view.subtitle)}` : ""} · ${thread.items.length === 1 ? "1 event" : `${thread.items.length} events`}</p>
      <div class="detail-cta">
        ${view.cta.href ? `<a class="btn primary" href="${escape(view.cta.href)}" target="_blank" rel="noopener" data-open-thread="${escape(thread.id)}">
          ${S.icon(view.cta.icon)}${escape(view.cta.label)}
        </a>` : ""}
        <button class="btn soft" type="button" data-toggle-thread="${escape(thread.id)}">
          ${S.icon(unread ? "check-circle" : "refresh")}${unread ? "Mark read" : "Mark unread"}
        </button>
      </div>
      ${latest.excerpt ? `<blockquote class="detail-quote">${escape(latest.excerpt)}</blockquote>` : ""}
      <div class="detail-facts">
        ${view.facts.map((fact) => `<div class="fact"><span>${escape(fact.label)}</span><strong>${escape(fact.value)}</strong></div>`).join("")}
      </div>
      <div class="detail-events-head">
        <span>Thread</span>
        <span class="spacer"></span>
        <span>${thread.items.length === 1 ? "1 event" : `${thread.items.length} events`}</span>
      </div>
      <ul class="events">${thread.items.map(eventHTML).join("")}</ul>
      `;
  }

  function renderDetail(options) {
    const opts = options || {};
    const thread = findThread(state.selected);
    const id = thread ? thread.id : "";
    const changed = dom.detail.dataset.thread !== id;
    dom.detail.innerHTML = detailHTML(thread);
    dom.detail.dataset.category = thread ? thread.lane : "";
    dom.detail.dataset.thread = id;
    if (changed) dom.detail.scrollTop = 0;
    if (changed && opts.animate && window.gsap && motionOK()) {
      window.gsap.fromTo(dom.detail, { opacity: 0, y: 6 }, {
        opacity: 1, y: 0, duration: 0.18, ease: "power2.out", clearProps: "opacity,transform"
      });
    }
  }

  /* ---------- counters, tabs, url ---------- */

  function setCount(el, next) {
    if (!el) return;
    const previous = el.dataset.count === undefined ? null : Number(el.dataset.count);
    el.dataset.count = String(next);
    if (el._countTween) { el._countTween.kill(); el._countTween = null; }
    if (previous === null || previous === next || !window.gsap || !motionOK()) {
      el.textContent = String(next);
      return;
    }
    const box = { value: previous };
    el._countTween = window.gsap.to(box, {
      value: next, duration: 0.24, ease: "power2.out", snap: { value: 1 },
      onUpdate() { el.textContent = String(Math.round(box.value)); },
      onComplete() { el.textContent = String(next); el._countTween = null; }
    });
  }

  function renderCounts() {
    const threads = buildThreads();
    const unread = threads.reduce((total, thread) => total + thread.unreadCount, 0);
    const total = items().length;
    setCount(dom.countAll, threads.length);
    LANES.forEach((lane) => {
      setCount(dom.counts[lane.id], threads.filter((thread) => thread.lane === lane.id).length);
    });
    const needsButton = $('[data-lane="needs"]', dom.tabs);
    if (needsButton) needsButton.classList.toggle("has-attention", threads.some((thread) => thread.lane === "needs" && thread.unreadCount > 0));
    dom.sub.innerHTML = `<span>${unread ? `${unread} unread` : "All caught up"}</span>
      <span class="dot" aria-hidden="true"></span>
      <span>${S.plural(total, "notification")}</span>
      <span class="dot" aria-hidden="true"></span>
      <span>${S.plural(threads.length, "thread")}</span>`;
    dom.markAll.disabled = unread === 0;
    dom.markAll.setAttribute("aria-disabled", unread === 0 ? "true" : "false");
    const inboxLink = document.querySelector('#rail a[href^="inbox.html"]');
    let badge = inboxLink?.querySelector('[data-nav-badge="inbox"]');
    if (inboxLink && unread && !badge) {
      badge = document.createElement("span");
      badge.className = "nav-badge";
      badge.dataset.navBadge = "inbox";
      inboxLink.appendChild(badge);
    }
    if (badge) {
      badge.textContent = unread ? String(unread) : "";
      badge.hidden = !unread;
    }
  }

  function renderTabs() {
    $$("[data-lane]", dom.tabs).forEach((tab) => {
      const active = tab.dataset.lane === state.lane;
      tab.setAttribute("aria-pressed", active ? "true" : "false");
      tab.tabIndex = 0;
    });
  }

  function syncUrl() {
    const url = new URL(window.location.href);
    if (state.lane === "all") url.searchParams.delete("lane");
    else url.searchParams.set("lane", state.lane);
    url.searchParams.delete("q");
    if (state.selected) url.searchParams.set("thread", state.selected);
    else url.searchParams.delete("thread");
    const next = url.pathname.split("/").pop() + url.search;
    const current = window.location.pathname.split("/").pop() + window.location.search;
    if (next !== current) window.history.replaceState(null, "", next);
  }

  function announce(message) {
    if (!dom.live) return;
    dom.live.textContent = "";
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => { dom.live.textContent = message; });
    });
  }

  /* ---------- state changes ---------- */

  function normalizeSelection() {
    const threads = visibleThreads();
    if (state.selected && threads.some((thread) => thread.id === state.selected)) return;
    state.selected = threads.length ? threads[0].id : null;
  }

  function refresh(options) {
    const opts = options || {};
    const first = motionOK() ? measureRows() : null;
    normalizeSelection();
    renderCounts();
    renderTabs();
    renderList({ first, entrance: opts.entrance });
    renderDetail({ animate: opts.animate });
    syncUrl();
  }

  function setLane(lane, options) {
    if (!LANE_IDS.includes(lane) || lane === state.lane) return;
    const opts = options || {};
    state.lane = lane;
    state.selected = null;
    refresh({ entrance: true, animate: true });
    announce(`${state.lane === "all" ? "All lanes" : (LANES.find((entry) => entry.id === lane) || {}).label}: ${visibleThreads().length} threads`);
    if (opts.focusList) focusRow(state.selected);
  }

  function select(id, options) {
    const opts = options || {};
    if (!id || state.selected === id) {
      if (opts.focus) focusRow(id);
      return;
    }
    state.selected = id;
    $$(".thread-row", dom.inner).forEach((row) => {
      row.setAttribute("aria-current", row.dataset.thread === id ? "true" : "false");
    });
    renderDetail({ animate: true });
    syncUrl();
    if (opts.scroll) scrollToRow(id);
    if (opts.focus) focusRow(id);
    if (opts.pane) revealPane();
    const thread = findThread(id);
    if (thread) {
      const view = describe(thread);
      announce(`${view.title}. ${thread.items.length === 1 ? "1 event" : `${thread.items.length} events`}, ${thread.unreadCount} unread.`);
    }
  }

  function moveSelection(delta) {
    const threads = visibleThreads();
    if (!threads.length) return;
    const index = threads.findIndex((thread) => thread.id === state.selected);
    const next = threads[(index + delta + threads.length) % threads.length];
    select(next.id, { focus: true, scroll: true });
  }

  function toggleThread(thread) {
    if (!thread) return;
    const read = thread.unreadCount > 0;
    thread.items.forEach((item) => { state.read[item.id] = read; });
    saveReadState();
    refresh({ animate: true });
    const row = rowFor(thread.id);
    if (row) {
      const glyph = $(".thread-glyph", row);
      if (glyph) {
        glyph.classList.remove("is-pop");
        void glyph.offsetWidth;
        glyph.classList.add("is-pop");
        window.setTimeout(() => glyph.classList.remove("is-pop"), 260);
      }
    }
    announce(`${describe(thread).title} marked ${read ? "read" : "unread"}.`);
  }

  function toggleItem(id) {
    const item = items().find((entry) => entry.id === id);
    if (!item) return;
    state.read[id] = !readOf(item);
    saveReadState();
    refresh({ animate: true });
    announce(`${readOf(item) ? "Read" : "Unread"}: ${S.personName(item.actorId)} ${item.text}.`);
  }

  function markThreadSeen(thread) {
    if (!thread) return;
    const unread = thread.items.filter((item) => !readOf(item));
    if (!unread.length) return;
    unread.forEach((item) => { state.read[item.id] = true; });
    saveReadState();
    refresh({ animate: true });
    announce(`${describe(thread).title} marked read.`);
  }

  function openThread(thread) {
    if (!thread) return;
    const view = describe(thread);
    const href = view.cta.href;
    if (!href) return;
    window.setTimeout(() => markThreadSeen(thread), 0);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function markAllRead() {
    const actorId = me().id;
    const unread = items().filter((item) => !readOf(item));
    if (!unread.length) {
      S.toast("Nothing unread in your inbox.", { icon: "check-circle" });
      return;
    }
    const before = unread.map((item) => [item.id, readOf(item)]);
    unread.forEach((item) => { state.read[item.id] = true; });
    saveReadState();
    refresh({ animate: true });
    announce(`${unread.length} notifications marked read.`);
    S.toast(`${S.plural(unread.length, "notification")} marked read`, {
      icon: "check-circle",
      undo() {
        if (me().id !== actorId) return;
        before.forEach(([id, value]) => { state.read[id] = value; });
        saveReadState();
        refresh({ animate: true });
        announce("Read state restored.");
      }
    });
  }

  function nextUnread() {
    const threads = visibleThreads();
    const index = threads.findIndex((thread) => thread.id === state.selected);
    const ordered = threads.slice(index + 1).concat(threads.slice(0, index + 1));
    let target = ordered.find((thread) => thread.unreadCount > 0);
    if (!target) {
      const query = state.q.trim().toLowerCase();
      const anywhere = buildThreads().find((thread) => thread.unreadCount > 0 && matches(thread, query));
      if (!anywhere) {
        S.toast(query ? "No unread notifications match your search." : "No unread notifications.", { icon: "check-circle" });
        return;
      }
      state.lane = "all";
      state.selected = null;
      refresh({ entrance: true, animate: true });
      target = findThread(anywhere.id);
    }
    if (target) select(target.id, { focus: true, scroll: true });
  }

  /* ---------- focus and scroll ---------- */

  function rowFor(id) {
    if (!id) return null;
    return $$(".thread-row", dom.inner).find((row) => row.dataset.thread === id) || null;
  }

  function focusRow(id) {
    const row = rowFor(id);
    if (row) row.focus({ preventScroll: true });
    else if (dom.scroll) dom.scroll.focus({ preventScroll: true });
  }

  function scrollToRow(id) {
    const row = rowFor(id);
    if (!row) return;
    if (state.lenis) {
      state.lenis.scrollTo(row, { offset: -8, duration: 0.45 });
    } else {
      row.scrollIntoView({ block: "nearest" });
    }
  }

  function revealPane() {
    if (window.innerWidth > 1180) return;
    const rect = dom.detail.getBoundingClientRect();
    if (rect.top < window.innerHeight - 48) return;
    dom.detail.scrollIntoView({ behavior: motionOK() ? "smooth" : "auto", block: "start" });
  }

  /* ---------- Lenis ---------- */

  function startLenis() {
    if (state.lenis || !window.Lenis) return;
    try {
      state.lenis = new window.Lenis({
        wrapper: dom.scroll,
        content: dom.inner,
        duration: 0.9,
        wheelMultiplier: 0.9,
        smoothWheel: true,
        touchMultiplier: 1.4
      });
    } catch (error) {
      state.lenis = null;
      return;
    }
    const raf = (time) => {
      if (!state.lenis) return;
      state.lenis.raf(time);
      state.rafId = window.requestAnimationFrame(raf);
    };
    state.rafId = window.requestAnimationFrame(raf);
  }

  function stopLenis() {
    if (state.rafId) window.cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    if (state.lenis) {
      state.lenis.destroy();
      state.lenis = null;
    }
  }

  function syncLenis() {
    const wanted = motionOK() && window.innerWidth > 1180 && Boolean(window.Lenis);
    if (wanted) startLenis();
    else stopLenis();
  }

  /* ---------- search ---------- */

  function applySearch(value) {
    state.q = value;
    const threads = visibleThreads();
    if (state.selected && !threads.some((thread) => thread.id === state.selected)) {
      state.selected = threads.length ? threads[0].id : null;
    }
    refresh({ animate: true });
    announce(`${threads.length} ${threads.length === 1 ? "thread" : "threads"} match ${state.q.trim() || "your search"}.`);
  }

  function clearSearch(options) {
    const opts = options || {};
    dom.search.value = "";
    state.q = "";
    refresh({ animate: true });
    if (opts.focus) dom.search.focus();
    announce("Search cleared.");
  }

  /* ---------- events ---------- */

  function bind() {
    dom.tabs.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-lane]");
      if (tab) setLane(tab.dataset.lane);
    });

    dom.tabs.addEventListener("keydown", (event) => {
      const tabs = $$("[data-lane]", dom.tabs);
      const index = tabs.indexOf(document.activeElement);
      if (index < 0) return;
      let next = null;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      tabs[next].focus();
      setLane(tabs[next].dataset.lane);
    });

    dom.search.addEventListener("input", () => {
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(() => applySearch(dom.search.value), 90);
    });

    dom.inner.addEventListener("click", (event) => {
      const clear = event.target.closest("[data-clear-search]");
      if (clear) { clearSearch({ focus: true }); return; }
      const all = event.target.closest("[data-search-all]");
      if (all) {
        state.lane = "all";
        state.selected = null;
        refresh({ entrance: true, animate: true });
        dom.search.focus();
        return;
      }
      const showAll = event.target.closest("[data-show-all]");
      if (showAll) { setLane("all", { focusList: true }); return; }
      const row = event.target.closest("[data-thread]");
      if (!row) return;
      select(row.dataset.thread, { scroll: false, pane: true });
    });

    dom.inner.addEventListener("dblclick", (event) => {
      const row = event.target.closest("[data-thread]");
      if (row) openThread(findThread(row.dataset.thread));
    });

    dom.detail.addEventListener("click", (event) => {
      const clear = event.target.closest("[data-clear-search]");
      if (clear) { clearSearch({ focus: true }); return; }
      const showAll = event.target.closest("[data-show-all]");
      if (showAll) { setLane("all", { focusList: true }); return; }
      const open = event.target.closest("[data-open-thread]");
      if (open) {
        window.setTimeout(() => markThreadSeen(findThread(open.dataset.openThread)), 0);
        return;
      }
      const toggle = event.target.closest("[data-toggle-thread]");
      if (toggle) { toggleThread(findThread(toggle.dataset.toggleThread)); return; }
      const item = event.target.closest("[data-item]");
      if (item) toggleItem(item.dataset.item);
    });

    dom.markAll.addEventListener("click", markAllRead);
    dom.nextUnread.addEventListener("click", nextUnread);
    dom.shortcuts.addEventListener("click", () => S.openDialog("shortcutsLayer", dom.shortcuts));

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA"
        || target.tagName === "SELECT" || target.isContentEditable);
      const dialogOpen = $$(".dialog-layer").some((layer) => !layer.hidden);

      if (event.key === "Escape") {
        if (dialogOpen) return;
        if (typing && target === dom.search) {
          event.preventDefault();
          if (dom.search.value) clearSearch({ focus: true });
          else { dom.search.blur(); focusRow(state.selected); }
          return;
        }
        if (state.q) { event.preventDefault(); clearSearch({ focus: false }); }
        return;
      }
      if (typing || dialogOpen) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case "j":
        case "J":
        case "ArrowDown":
          if (event.key === "ArrowDown" && !dom.scroll.contains(target)) break;
          event.preventDefault();
          moveSelection(1);
          break;
        case "k":
        case "K":
        case "ArrowUp":
          if (event.key === "ArrowUp" && !dom.scroll.contains(target)) break;
          event.preventDefault();
          moveSelection(-1);
          break;
        case "Enter": {
          const row = event.target.closest && event.target.closest("[data-thread]");
          const id = row ? row.dataset.thread : state.selected;
          if (!id) break;
          if (row || event.target === document.body || event.target === dom.scroll) {
            event.preventDefault();
            if (row && state.selected !== id) select(id, { focus: false });
            openThread(findThread(id));
          }
          break;
        }
        case "e":
        case "E":
          event.preventDefault();
          toggleThread(findThread(state.selected));
          break;
        case "u":
        case "U":
          event.preventDefault();
          nextUnread();
          break;
        case "/":
          event.preventDefault();
          dom.search.focus();
          dom.search.select();
          break;
        case "?":
          event.preventDefault();
          S.openDialog("shortcutsLayer", dom.shortcuts);
          break;
        default:
          break;
      }
    });

    window.addEventListener("resize", () => {
      window.clearTimeout(state.resizeTimer);
      state.resizeTimer = window.setTimeout(syncLenis, 160);
    });

    const onMotionChange = () => {
      syncLenis();
      if (!motionOK() && window.gsap) window.gsap.killTweensOf($$(".thread-row", dom.inner));
    };
    if (motionQuery.addEventListener) motionQuery.addEventListener("change", onMotionChange);
    else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);
  }

  /* ---------- boot ---------- */

  function init() {
    dom.sub = $("#inboxSub");
    dom.tabs = $("#laneTabs");
    dom.search = $("#inboxSearch");
    dom.inner = $("#streamInner");
    dom.scroll = $("#streamScroll");
    dom.detail = $("#inboxDetail");
    dom.live = $("#inboxLive");
    dom.markAll = $("#markAllBtn");
    dom.nextUnread = $("#nextUnreadBtn");
    dom.shortcuts = $("#shortcutsBtn");
    dom.countAll = $("#countAll");
    dom.counts = {
      needs: $("#countNeeds"),
      updates: $("#countUpdates"),
      access: $("#countAccess")
    };
    if (!dom.inner || !dom.tabs) return;

    loadReadState();
    dom.search.value = state.q;
    bind();
    normalizeSelection();
    renderCounts();
    renderTabs();
    renderList({ entrance: true });
    renderDetail({ animate: false });
    syncUrl();
    syncLenis();
  }

  window.FBPage = {
    init,
    render() {
      loadReadState();
      state.q = "";
      state.selected = null;
      if (dom.search) dom.search.value = "";
      refresh({ entrance: true, animate: true });
      syncLenis();
    }
  };
})();
