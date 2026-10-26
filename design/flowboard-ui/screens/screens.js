/* Flowboard UI artifact — shared shell, role preview, dialogs and helpers
   for the remaining screens. Design-only; synthetic data; no API calls. */
(function () {
  "use strict";

  const FB = window.FB;
  const H = FB.helpers;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const page = document.body.dataset.page || "hub";

  const state = { role: "owner", theme: "light", railOpen: false };
  const themeListeners = [];

  const rolePermissions = {
    owner: {
      manageProject: true, manageBoard: true, invite: true, grantManager: true,
      archiveProject: true, createProject: true, browseTrash: true, restore: true,
      import: true, managePeople: true, editCard: true, comment: true, upload: true,
      moderate: true, deleteCard: true
    },
    manager: {
      manageProject: true, manageBoard: true, invite: true, grantManager: false,
      archiveProject: false, createProject: false, browseTrash: true, restore: true,
      import: true, managePeople: true, editCard: true, comment: true, upload: true,
      moderate: true, deleteCard: true
    },
    member: {
      manageProject: false, manageBoard: false, invite: false, grantManager: false,
      archiveProject: false, createProject: false, browseTrash: false, restore: false,
      import: false, managePeople: false, editCard: true, comment: true, upload: true,
      moderate: false, deleteCard: false
    },
    viewer: {
      manageProject: false, manageBoard: false, invite: false, grantManager: false,
      archiveProject: false, createProject: false, browseTrash: false, restore: false,
      import: false, managePeople: false, editCard: false, comment: false, upload: false,
      moderate: false, deleteCard: false
    }
  };

  const PAGE_META = {
    hub: { nav: "hub", crumbs: [{ label: "Design review" }, { label: "Screen library" }] },
    projects: { nav: "projects", crumbs: [{ label: "Acme Corp", href: "projects.html" }, { label: "Projects" }] },
    project: { nav: "projects", crumbs: [{ label: "Acme Corp", href: "projects.html" }, { label: "Projects", href: "projects.html" }, { label: "Project" }] },
    "add-card": { nav: "board", crumbs: [{ label: "Website Redesign", href: "project.html" }, { label: "Website Kanban", href: "../index.html" }, { label: "New card" }] },
    inbox: { nav: "inbox", crumbs: [{ label: "Acme Corp", href: "projects.html" }, { label: "Inbox" }] },
    activity: { nav: "activity", crumbs: [{ label: "Website Redesign", href: "project.html" }, { label: "Activity" }] },
    trash: { nav: "trash", crumbs: [{ label: "Website Redesign", href: "project.html" }, { label: "Trash" }] },
    people: { nav: "people", crumbs: [{ label: "Website Redesign", href: "project.html" }, { label: "People" }] },
    import: { nav: "import", crumbs: [{ label: "Website Redesign", href: "project.html" }, { label: "Import" }] },
    settings: { nav: "settings", crumbs: [{ label: "Website Redesign", href: "project.html" }, { label: "Settings" }] }
  };

  function icon(name, cls) {
    return `<svg class="icon${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }

  function escape(value) {
    return H.escapeHTML(value);
  }

  function personName(personId) {
    const person = FB.person(personId);
    return person ? person.name : "Unknown person";
  }

  function avatar(personId, extra) {
    const person = FB.person(personId);
    if (!person) return "";
    return `<span class="avatar ${person.tone}${extra ? " " + extra : ""}" title="${escape(person.name)}" aria-hidden="true">${person.initials}</span>`;
  }

  function currentUser() {
    return FB.people[FB.roleMeta[state.role].userId];
  }

  function can(action) {
    return Boolean(rolePermissions[state.role] && rolePermissions[state.role][action]);
  }

  function roleLabel() {
    return FB.roleMeta[state.role].label;
  }

  function plural(count, singular, pluralWord) {
    return `${count} ${count === 1 ? singular : (pluralWord || singular + "s")}`;
  }

  function link(href) {
    if (!href || state.role === "owner") return href;
    const hashIndex = href.indexOf("#");
    const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
    const base = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
    const parts = base.split("?");
    const params = new URLSearchParams(parts[1] || "");
    params.set("role", state.role);
    return `${parts[0]}?${params.toString()}${hash}`;
  }

  function boardHref(cardId) {
    const params = new URLSearchParams();
    if (state.role !== "owner") params.set("role", state.role);
    if (cardId) params.set("card", cardId);
    return `../index.html${params.toString() ? "?" + params.toString() : ""}`;
  }

  function screenHref(pageName, params) {
    const search = new URLSearchParams(params || {});
    if (state.role !== "owner") search.set("role", state.role);
    return `${pageName}.html${search.toString() ? "?" + search.toString() : ""}`;
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? H.parseDateOnly(value)
      : new Date(value);
    if (!date || Number.isNaN(date.getTime())) return escape(String(value));
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    }).format(date);
  }

  function formatDeadline(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short"
    }).format(date);
  }

  function relativeTime(value) {
    return H.relativeTime(value);
  }

  function serverNow() {
    return new Date();
  }

  function countdown(until) {
    const diff = new Date(until).getTime() - serverNow().getTime();
    const abs = Math.abs(diff);
    const hours = Math.floor(abs / 3600000);
    const minutes = Math.floor((abs % 3600000) / 60000);
    const label = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    if (diff <= 0) return { expired: true, label: `Expired ${label} ago`, diff };
    return { expired: false, label: `${label} left`, diff };
  }

  function statusChip(label, tone) {
    return `<span class="status-chip${tone ? " " + tone : ""}">${escape(label)}</span>`;
  }

  function spriteHTML() {
    return `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false" id="fbSprite">
      <defs>
        <symbol id="i-board" viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M9.5 4v16M15 4v9"/></symbol>
        <symbol id="i-folder" viewBox="0 0 24 24"><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3l2 2h7a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z"/></symbol>
        <symbol id="i-inbox" viewBox="0 0 24 24"><path d="M4 13.5 6.5 5h11L20 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 13.5h4l1.5 2.5h5l1.5-2.5h4"/></symbol>
        <symbol id="i-activity" viewBox="0 0 24 24"><path d="M3 12h4l2.2-5.5 3.6 11L15 12h6"/></symbol>
        <symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.8a3.2 3.2 0 0 1 0 5.9M17.5 14.2A5.5 5.5 0 0 1 20.5 19"/></symbol>
        <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l.8 12.1a1.8 1.8 0 0 0 1.8 1.7h5.8a1.8 1.8 0 0 0 1.8-1.7L17.5 7"/><path d="M10 11v6M14 11v6"/></symbol>
        <symbol id="i-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.2 13.5a7.6 7.6 0 0 0 0-3l1.6-1.2-1.8-3.1-1.9.7a7.5 7.5 0 0 0-2.6-1.5L14.2 3h-3.6l-.3 2.4a7.5 7.5 0 0 0-2.6 1.5l-1.9-.7-1.8 3.1 1.6 1.2a7.6 7.6 0 0 0 0 3l-1.6 1.2 1.8 3.1 1.9-.7a7.5 7.5 0 0 0 2.6 1.5l.3 2.4h3.6l.3-2.4a7.5 7.5 0 0 0 2.6-1.5l1.9.7 1.8-3.1z"/></symbol>
        <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
        <symbol id="i-search" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.5 15.5 4.2 4.2"/></symbol>
        <symbol id="i-filter" viewBox="0 0 24 24"><path d="M4 6h16l-6.2 7.2V19l-3.6-2v-3.8z"/></symbol>
        <symbol id="i-x" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></symbol>
        <symbol id="i-more" viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor" stroke="none"/></symbol>
        <symbol id="i-move" viewBox="0 0 24 24"><path d="M12 3.5v17M3.5 12h17"/><path d="m8.5 7 3.5-3.5L15.5 7M8.5 17l3.5 3.5 3.5-3.5M7 8.5 3.5 12 7 15.5M17 8.5l3.5 3.5-3.5 3.5"/></symbol>
        <symbol id="i-calendar" viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3.5v4M16 3.5v4"/></symbol>
        <symbol id="i-message" viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.6 8.6 0 0 1-3.2-.6L4 20l1.4-4.2A7.4 7.4 0 0 1 4 11.5a7.5 7.5 0 0 1 8-7.5 7.5 7.5 0 0 1 8 7.5Z"/></symbol>
        <symbol id="i-comment" viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.6 8.6 0 0 1-3.2-.6L4 20l1.4-4.2A7.4 7.4 0 0 1 4 11.5a7.5 7.5 0 0 1 8-7.5 7.5 7.5 0 0 1 8 7.5Z"/></symbol>
        <symbol id="i-image" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.7"/><path d="m4.5 17 5-5 4 4 2.5-2.5 4 4"/></symbol>
        <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.5v2"/></symbol>
        <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/></symbol>
        <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/></symbol>
        <symbol id="i-chevron-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
        <symbol id="i-chevron-up" viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></symbol>
        <symbol id="i-chevron-right" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></symbol>
        <symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></symbol>
        <symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></symbol>
        <symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 4 21 19.5H3z"/><path d="M12 9.5v4.5M12 17.2v.1"/></symbol>
        <symbol id="i-undo" viewBox="0 0 24 24"><path d="M4 9h9.5a5.5 5.5 0 1 1 0 11H8"/><path d="M7.5 5.5 4 9l3.5 3.5"/></symbol>
        <symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 16V4.5M7.5 9 12 4.5 16.5 9"/><path d="M4 16.5v2A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-2"/></symbol>
        <symbol id="i-download" viewBox="0 0 24 24"><path d="M12 4v11.5M7.5 11 12 15.5 16.5 11"/><path d="M4 16.5v2A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-2"/></symbol>
        <symbol id="i-at" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.7"/><path d="M15.7 8.3v4.4a2.6 2.6 0 0 0 5.2 0V12a8.9 8.9 0 1 0-3.3 6.9"/></symbol>
        <symbol id="i-link" viewBox="0 0 24 24"><path d="M9.5 14.5 14.5 9.5"/><path d="M11 7.5 12.8 5.7a4.2 4.2 0 0 1 5.9 5.9L16.8 13.5M13 16.5l-1.8 1.8a4.2 4.2 0 0 1-5.9-5.9L7.2 10.5"/></symbol>
        <symbol id="i-copy" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></symbol>
        <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.5l3.5 2"/></symbol>
        <symbol id="i-edit" viewBox="0 0 24 24"><path d="M4 20h4.5L20 8.5 15.5 4 4 15.5z"/><path d="m13.5 6 4.5 4.5"/></symbol>
        <symbol id="i-user-plus" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.4"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M18 7v6M15 10h6"/></symbol>
        <symbol id="i-user-check" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.4"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M15.5 15.5l2 2 4-4.5"/></symbol>
        <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3.5 19.5 6v6.2c0 4.3-3 7.3-7.5 8.8-4.5-1.5-7.5-4.5-7.5-8.8V6z"/><path d="m8.8 12 2.2 2.2 4.2-4.2"/></symbol>
        <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 10.5V16M12 8v.1"/></symbol>
        <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></symbol>
        <symbol id="i-grid" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></symbol>
        <symbol id="i-file" viewBox="0 0 24 24"><path d="M6 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V5a1.5 1.5 0 0 1 1-1.5Z"/><path d="M13 3.5v5h5M8.5 13h7M8.5 16.5h5"/></symbol>
        <symbol id="i-archive" viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="4.5" rx="1.5"/><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5M10 12.5h4"/></symbol>
        <symbol id="i-restore" viewBox="0 0 24 24"><path d="M4.5 9.5h9a5 5 0 1 1-4.7 6.7"/><path d="M7.5 5.5 4 9.5l3.5 4"/></symbol>
        <symbol id="i-mail" viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7 7.5 5.5L19.5 7"/></symbol>
        <symbol id="i-bell" viewBox="0 0 24 24"><path d="M6 9.5a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0"/></symbol>
        <symbol id="i-key" viewBox="0 0 24 24"><circle cx="8.5" cy="15.5" r="4.5"/><path d="m12 12 8-8M16.5 7.5 19 10M14 10l2 2"/></symbol>
        <symbol id="i-palette" viewBox="0 0 24 24"><path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.5 0 2-1 2-2s-.8-2-.8-3c0-1.2 1-2 2.3-2h2.3c1.6 0 2.7-1.2 2.7-3A8.5 8.5 0 0 0 12 3.5Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="11" cy="7" r="1"/><circle cx="15" cy="8" r="1"/></symbol>
        <symbol id="i-columns" viewBox="0 0 24 24"><rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="9.5" y="4" width="5" height="16" rx="1.5"/><rect x="15.5" y="4" width="5" height="16" rx="1.5"/></symbol>
        <symbol id="i-check-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m8 12 2.7 2.7L16.5 9"/></symbol>
        <symbol id="i-x-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/></symbol>
        <symbol id="i-arrow-right" viewBox="0 0 24 24"><path d="M4 12h15M14 7l5 5-5 5"/></symbol>
        <symbol id="i-arrow-left" viewBox="0 0 24 24"><path d="M20 12H5M10 7l-5 5 5 5"/></symbol>
        <symbol id="i-external" viewBox="0 0 24 24"><path d="M13 4.5h6.5V11M19 5l-8 8"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></symbol>
        <symbol id="i-send" viewBox="0 0 24 24"><path d="m3.5 11 17-7-5.5 17-3.5-7z"/><path d="m11.5 14 9-10"/></symbol>
        <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14-4.5L4 8.5"/><path d="M4 4.5v4h4"/><path d="M4 13a8 8 0 0 0 14 4.5l2-2"/><path d="M20 19.5v-4h-4"/></symbol>
        <symbol id="i-list" viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none"/></symbol>
      </defs>
    </svg>`;
  }

  function railHTML() {
    const user = currentUser();
    const unread = window.SD ? window.SD.unreadCount(user.id) : 0;
    const trashCount = window.SD && can("browseTrash") ? window.SD.trash.length : 0;
    const activeNav = (PAGE_META[page] || PAGE_META.hub).nav;

    const item = (id, label, iconName, href, badge, quiet, manageOnly) => {
      const active = activeNav === id;
      return `<a class="nav-item" href="${link(href)}"${active ? ' aria-current="page"' : ""}${manageOnly ? ' data-manage-only' : ""}>
        ${icon(iconName)}<span>${label}</span>
        ${badge ? `<span class="nav-badge${quiet ? " quiet" : ""}" data-nav-badge="${id}">${badge}</span>` : ""}
      </a>`;
    };

    return `<div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
            <path d="M4.5 6.5h6"/><path d="M4.5 12h15"/><path d="M13.5 17.5h6"/>
          </svg>
        </span>
        <span class="brand-name">Flowboard</span>
        <span class="brand-tag">Prototype</span>
      </div>

      <a class="workspace-switch" href="${link("projects.html")}" title="Switch project">
        <span class="workspace-avatar" aria-hidden="true">AC</span>
        <span class="workspace-copy">
          <strong>Acme Corp</strong>
          <span>1 active · 4 people</span>
        </span>
        ${icon("chevron-down")}
      </a>

      <nav class="rail-nav" aria-label="Primary">
        <div class="nav-group">
          <p class="nav-label">Workspace</p>
          ${item("board", "Board", "board", "../index.html")}
          ${item("projects", "Projects", "folder", "projects.html")}
          ${item("inbox", "Inbox", "inbox", "inbox.html", unread || "", false, false)}
          ${item("activity", "Activity", "activity", "activity.html")}
        </div>

        <div class="nav-group">
          <p class="nav-label">Project</p>
          ${item("trash", "Trash", "trash", "trash.html", trashCount || "", true, true)}
          ${item("people", "People", "users", "people.html")}
          ${item("import", "Import", "upload", "import.html", "", false, true)}
          ${item("settings", "Settings", "settings", "settings.html")}
        </div>

        <div class="nav-group">
          <p class="nav-label">Design review</p>
          ${item("hub", "Screen library", "grid", "index.html")}
        </div>

        <div class="rail-note">
          ${icon("lock", "icon-sm")}
          <span>Private by default. Projects are invisible unless you are granted access.</span>
        </div>
      </nav>

      <div class="rail-user">
        ${avatar(user.id, "rail-avatar")}
        <span class="rail-user-copy">
          <strong>${escape(user.name)}</strong>
          <span>${escape(roleLabel())}</span>
        </span>
        ${icon("chevron-down", "icon-sm")}
      </div>`;
  }

  function topbarHTML() {
    const user = currentUser();
    const meta = PAGE_META[page] || PAGE_META.hub;
    const crumbs = meta.crumbs.map((crumb, index) => {
      const isLast = index === meta.crumbs.length - 1;
      const label = escape(crumb.label);
      const node = crumb.href && !isLast
        ? `<a href="${link(crumb.href)}">${label}</a>`
        : `<span${isLast ? ' class="current"' : ""}>${label}</span>`;
      return `${node}${isLast ? "" : '<span class="sep">/</span>'}`;
    }).join("");

    return `<button class="icon-btn menu-btn" id="menuBtn" type="button" aria-label="Open navigation" aria-controls="rail" aria-expanded="false">
        ${icon("menu", "icon-lg")}
      </button>
      <nav class="crumbs" id="crumbs" aria-label="Breadcrumb">${crumbs}</nav>
      <div class="topbar-spacer"></div>
      <div class="presence" aria-label="3 people online">
        <span class="presence-label">3 online</span>
        ${avatar("alice")}${avatar("charlie")}${avatar("david")}
      </div>
      <label class="role-control" title="Preview as a fixed design fixture: Alice (Owner), Charlie (Manager), David (Member) or Eve (Viewer). Roster edits do not change these preview identities.">
        <span>View as</span>
        <select id="roleSelect" aria-label="Preview role">
          <option value="owner">Owner</option>
          <option value="manager">Manager</option>
          <option value="member">Member</option>
          <option value="viewer">Viewer</option>
        </select>
      </label>
      <button class="icon-btn" id="themeToggle" type="button" aria-label="Switch to dark theme" aria-pressed="false">
        ${icon("sun", "theme-icon-light")}
        ${icon("moon", "theme-icon-dark")}
      </button>
      <a class="icon-btn topbar-user" id="accountBtn" href="${link("settings.html?tab=account")}" aria-label="Account settings for ${escape(user.name)}">
        ${avatar(user.id, "topbar-avatar")}
      </a>`;
  }

  function injectChrome() {
    if (!$("#fbSprite")) {
      const mount = document.createElement("div");
      mount.id = "fbSpriteMount";
      mount.innerHTML = spriteHTML();
      document.body.appendChild(mount);
    }
    if (!$("#toasts")) {
      const toasts = document.createElement("div");
      toasts.className = "toasts";
      toasts.id = "toasts";
      toasts.setAttribute("role", "status");
      toasts.setAttribute("aria-live", "polite");
      toasts.setAttribute("aria-atomic", "false");
      document.body.appendChild(toasts);
    }
    if (!$("#confirmLayer")) {
      const layer = document.createElement("div");
      layer.className = "dialog-layer";
      layer.id = "confirmLayer";
      layer.hidden = true;
      layer.innerHTML = `<div class="dialog confirm" role="alertdialog" aria-modal="true" aria-labelledby="screensConfirmTitle" aria-describedby="screensConfirmCopy">
        <div class="dialog-head">
          <div class="dialog-head-copy">
            <div class="confirm-icon" id="screensConfirmIcon">${icon("alert")}</div>
            <h2 id="screensConfirmTitle">Are you sure?</h2>
            <p class="confirm-copy" id="screensConfirmCopy"></p>
          </div>
        </div>
        <footer class="dialog-foot">
          <span class="spacer"></span>
          <button class="btn" id="screensConfirmCancel" type="button">Cancel</button>
          <button class="btn primary" id="screensConfirmAccept" type="button">Confirm</button>
        </footer>
      </div>`;
      document.body.appendChild(layer);
    }
  }

  function refreshShell() {
    const rail = $("#rail");
    const topbar = $("#topbar");
    if (!rail || !topbar) return;
    rail.innerHTML = railHTML();
    topbar.innerHTML = topbarHTML();
    $$("[data-manage-only]").forEach((el) => { el.hidden = !can("manageBoard"); });
    const select = $("#roleSelect");
    if (select) select.value = state.role;
    bindTopbar();
    syncThemeToggle();
  }

  function syncThemeToggle() {
    const toggle = $("#themeToggle");
    if (!toggle) return;
    toggle.setAttribute("aria-pressed", String(state.theme === "dark"));
    toggle.setAttribute("aria-label", state.theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }

  function setRail(open) {
    const rail = $("#rail");
    const scrim = $("#railScrim");
    const menuBtn = $("#menuBtn");
    if (!rail) return;
    state.railOpen = Boolean(open);
    rail.classList.toggle("is-open", state.railOpen);
    if (menuBtn) menuBtn.setAttribute("aria-expanded", String(state.railOpen));
    if (scrim) scrim.hidden = !state.railOpen;
    document.body.style.overflow = state.railOpen ? "hidden" : "";
  }

  function bindTopbar() {
    const menuBtn = $("#menuBtn");
    if (menuBtn) {
      menuBtn.addEventListener("click", () => setRail(!state.railOpen));
    }
    const themeToggle = $("#themeToggle");
    if (themeToggle) {
      themeToggle.addEventListener("click", () => {
        setTheme(state.theme === "dark" ? "light" : "dark", true);
      });
    }
    const roleSelect = $("#roleSelect");
    if (roleSelect) {
      roleSelect.value = state.role;
      roleSelect.addEventListener("change", async (event) => {
        const next = event.target.value;
        if (next === state.role) return;
        if (window.FBPage && typeof window.FBPage.beforeRoleChange === "function") {
          const accepted = await window.FBPage.beforeRoleChange(next);
          if (!accepted) {
            event.target.value = state.role;
            return;
          }
        }
        applyRole(next, { announce: true, render: true });
      });
    }
  }

  function renderShell() {
    injectChrome();
    refreshShell();
    const scrim = $("#railScrim");
    if (scrim && !scrim.dataset.bound) {
      scrim.dataset.bound = "true";
      scrim.addEventListener("click", () => setRail(false));
    }
    if (!window._fbResizeBound) {
      window._fbResizeBound = true;
      window.addEventListener("resize", () => {
        if (window.innerWidth > 980) setRail(false);
      });
    }
  }

  function applyRole(role, options) {
    const opts = options || {};
    if (!FB.roleMeta[role]) return;
    state.role = role;
    document.body.dataset.role = role;
    if (!opts.silentUrl) {
      const url = new URL(window.location.href);
      if (role === "owner") url.searchParams.delete("role");
      else url.searchParams.set("role", role);
      history.replaceState(null, "", url.pathname.split("/").pop() + url.search + url.hash);
    }
    setRail(false);
    refreshShell();
    if (opts.render && window.FBPage && typeof window.FBPage.render === "function") {
      window.FBPage.render(role);
    }
    if (opts.announce) {
      toast(`Previewing as ${currentUser().name} — ${roleLabel().toLowerCase()}`, { tone: "success", icon: "eye" });
    }
  }

  function setTheme(theme, announce) {
    state.theme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = state.theme;
    try { localStorage.setItem("flowboard-ui-theme", state.theme); } catch (error) { /* file previews can block storage */ }
    syncThemeToggle();
    themeListeners.forEach((listener) => {
      try { listener(state.theme); } catch (error) { /* a page preview must not break the shell */ }
    });
    if (announce) {
      toast(state.theme === "dark" ? "Dark theme preview" : "Light theme preview", {
        icon: state.theme === "dark" ? "moon" : "sun"
      });
    }
  }

  function onTheme(listener) {
    if (typeof listener === "function") themeListeners.push(listener);
  }

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

  let confirmState = null;

  function focusables(container) {
    return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', container)
      .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
  }

  function topLayer() {
    const confirm = $("#confirmLayer");
    if (confirm && !confirm.hidden) return confirm;
    const layers = $$(".dialog-layer").filter((layer) => !layer.hidden && layer.id !== "confirmLayer");
    return layers.length ? layers[layers.length - 1] : null;
  }

  function openDialog(id, trigger) {
    const layer = typeof id === "string" ? document.getElementById(id) : id;
    if (!layer) return;
    layer._returnFocus = trigger || document.activeElement;
    layer.hidden = false;
    requestAnimationFrame(() => {
      const preferred = layer.querySelector("[data-autofocus]")
        || layer.querySelector("input:not([type=hidden]), select, textarea, button");
      if (preferred) preferred.focus({ preventScroll: true });
      else layer.focus({ preventScroll: true });
    });
  }

  function closeDialog(id) {
    const layer = typeof id === "string" ? document.getElementById(id) : id;
    if (!layer || layer.hidden) return;
    layer.hidden = true;
    const returnFocus = layer._returnFocus;
    layer._returnFocus = null;
    requestAnimationFrame(() => {
      if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    });
  }

  function settleConfirm(value) {
    const current = confirmState;
    confirmState = null;
    const layer = $("#confirmLayer");
    if (layer && !layer.hidden) closeDialog(layer);
    if (current) current.resolve(value);
  }

  function confirmAction(options) {
    const opts = options || {};
    return new Promise((resolve) => {
      if (confirmState) settleConfirm(false);
      const layer = $("#confirmLayer");
      if (!layer) { resolve(false); return; }
      $("#screensConfirmTitle").textContent = opts.title || "Are you sure?";
      $("#screensConfirmCopy").textContent = opts.copy || "";
      const accept = $("#screensConfirmAccept");
      accept.textContent = opts.confirmLabel || "Confirm";
      accept.className = `btn ${opts.tone === "danger" ? "danger" : "primary"}`;
      const iconWrap = $("#screensConfirmIcon");
      iconWrap.className = `confirm-icon${opts.tone === "danger" ? " danger" : ""}`;
      iconWrap.innerHTML = icon(opts.icon || "alert");
      confirmState = { resolve };
      openDialog(layer, document.activeElement);
      setTimeout(() => {
        const cancel = $("#screensConfirmCancel");
        if (cancel && !layer.hidden) cancel.focus({ preventScroll: true });
      }, 30);
    });
  }

  function accessDenied(options) {
    const opts = options || {};
    return `<section class="access-denied" aria-labelledby="deniedTitle">
      <div class="access-icon" aria-hidden="true">${icon("lock", "icon-lg")}</div>
      <p class="eyebrow">Restricted surface</p>
      <h1 id="deniedTitle">${escape(opts.title || "You do not have access")}</h1>
      <p class="access-copy">${escape(opts.copy || "This screen is limited to another project role.")}</p>
      <div class="access-meta">
        <span class="badge">Signed in as ${escape(currentUser().name)}</span>
        <span class="badge accent">${escape(roleLabel())}</span>
        <span class="badge">${escape(opts.needed || "Owner or Manager")} only</span>
      </div>
      <div class="access-actions">
        <button class="btn primary" type="button" data-preview-owner>Preview as Owner</button>
        <a class="btn" href="${link(opts.backHref || boardHref())}">${escape(opts.backLabel || "Back to board")}</a>
      </div>
      <p class="hint">${icon("shield")} Role preview is a design-review tool. Production authorization must be enforced by the API on every request.</p>
    </section>`;
  }

  function setBreadcrumb(items) {
    const crumbs = $("#crumbs");
    if (!crumbs) return;
    crumbs.innerHTML = items.map((item, index) => {
      const last = index === items.length - 1;
      const label = escape(item.label);
      const node = item.href && !last ? `<a href="${link(item.href)}">${label}</a>` : `<span${last ? ' class="current"' : ""}>${label}</span>`;
      return `${node}${last ? "" : '<span class="sep">/</span>'}`;
    }).join("");
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (confirmState) {
        event.preventDefault();
        settleConfirm(false);
        return;
      }
      const layer = topLayer();
      if (layer) {
        event.preventDefault();
        closeDialog(layer);
      }
      return;
    }
    if (event.key !== "Tab") return;
    const layer = topLayer();
    if (!layer) return;
    const items = focusables(layer);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.addEventListener("click", (event) => {
    const preview = event.target.closest("[data-preview-owner]");
    if (preview) {
      applyRole("owner", { announce: true, render: true });
      return;
    }
    const layer = event.target.closest(".dialog-layer");
    if (layer && event.target === layer && layer.id !== "confirmLayer") {
      closeDialog(layer);
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    let savedTheme = "light";
    try { savedTheme = localStorage.getItem("flowboard-ui-theme") || "light"; } catch (error) { savedTheme = "light"; }
    const themeParam = params.get("theme");
    state.theme = themeParam === "dark" ? "dark" : themeParam === "light" ? "light" : savedTheme;
    const roleParam = params.get("role");
    state.role = roleParam && FB.roleMeta[roleParam] ? roleParam : "owner";
    document.body.dataset.role = state.role;
    document.documentElement.dataset.theme = state.theme;

    renderShell();
    setTheme(state.theme, false);

    const cancel = $("#screensConfirmCancel");
    const accept = $("#screensConfirmAccept");
    if (cancel) cancel.addEventListener("click", () => settleConfirm(false));
    if (accept) accept.addEventListener("click", () => settleConfirm(true));

    if (window.FBPage && typeof window.FBPage.init === "function") {
      window.FBPage.init();
    }
    if (window.FBPage && typeof window.FBPage.beforeUnload === "function") {
      window.addEventListener("beforeunload", (event) => {
        if (window.FBPage.beforeUnload()) {
          event.preventDefault();
          event.returnValue = "";
        }
      });
    }
  });

  window.Screens = {
    get role() { return state.role; },
    get theme() { return state.theme; },
    can,
    currentUser,
    roleLabel,
    roleMeta: FB.roleMeta,
    people: FB.people,
    icon,
    escape,
    avatar,
    personName,
    link,
    boardHref,
    screenHref,
    toast,
    confirm: confirmAction,
    openDialog,
    closeDialog,
    accessDenied,
    setBreadcrumb,
    formatDate,
    formatDateTime,
    formatDeadline,
    relativeTime,
    serverNow,
    countdown,
    plural,
    statusChip,
    onTheme,
    setTheme,
    projectById: (id) => (window.SD ? window.SD.project(id) : null),
    boardById: (id) => (window.SD ? window.SD.board(id) : null),
    membersForProject(projectId) {
      const project = window.SD ? window.SD.project(projectId) : null;
      if (!project) return [];
      return project.memberIds.map((personId) => {
        const member = window.SD.members.find((item) => item.personId === personId);
        return member ? { ...member, person: FB.person(personId) } : null;
      }).filter(Boolean);
    }
  };
})();


