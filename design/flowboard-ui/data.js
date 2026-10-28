/* Flowboard UI artifact — synthetic data and shared helpers.
   Everything here is design evidence, not product data. */
(function () {
  "use strict";

  const DAY = 86400000;

  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(offset) {
    return new Date(startOfToday().getTime() + offset * DAY);
  }

  function isoDate(offset) {
    const d = addDays(offset);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function hoursAgo(hours) {
    return new Date(Date.now() - hours * 3600000).toISOString();
  }

  function parseDateOnly(value) {
    if (!value) return null;
    const parts = value.split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function daysUntil(value) {
    const due = parseDateOnly(value);
    if (!due) return null;
    return Math.round((due.getTime() - startOfToday().getTime()) / DAY);
  }

  function formatShort(value) {
    const d = parseDateOnly(value);
    if (!d) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function dueInfo(card) {
    if (!card.due) return null;
    const days = daysUntil(card.due);
    const done = window.FB ? window.FB.isDone(card) : card.columnId === "col_completed";
    if (done) return { label: `Done · ${formatShort(card.due)}`, state: "done" };
    if (days < 0) {
      const n = Math.abs(days);
      return { label: `Overdue · ${formatShort(card.due)}`, state: "overdue", detail: `${n} day${n === 1 ? "" : "s"} overdue` };
    }
    if (days === 0) return { label: "Due today", state: "soon" };
    if (days === 1) return { label: "Due tomorrow", state: "soon" };
    if (days <= 7) return { label: `Due ${formatShort(card.due)}`, state: "soon" };
    return { label: `Due ${formatShort(card.due)}`, state: "normal" };
  }

  function relativeTime(iso) {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 45000) return "Just now";
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function makeArt(from, to, accent, seed) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
      </linearGradient></defs>
      <rect width="320" height="240" fill="url(#g)"/>
      <circle cx="${80 + (seed % 5) * 17}" cy="${74 + (seed % 4) * 11}" r="${48 + (seed % 3) * 10}" fill="${accent}" opacity=".55"/>
      <circle cx="${228 - (seed % 4) * 13}" cy="${168 - (seed % 3) * 12}" r="${30 + (seed % 4) * 8}" fill="#ffffff" opacity=".26"/>
      <path d="M-20 ${180 + (seed % 5) * 8} C 70 ${120 + (seed % 4) * 12}, 180 ${215 - (seed % 3) * 15}, 350 ${130 + (seed % 4) * 10}" fill="none" stroke="${accent}" stroke-width="2" opacity=".5"/>
      <rect x="${34 + (seed % 3) * 10}" y="${160 - (seed % 4) * 8}" width="${72 + (seed % 3) * 12}" height="1.5" fill="#ffffff" opacity=".55"/>
      <rect x="${34 + (seed % 3) * 10}" y="${168 - (seed % 4) * 8}" width="${44 + (seed % 3) * 8}" height="1.5" fill="#ffffff" opacity=".32"/>
    </svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function image(id, label, from, to, accent, seed) {
    return { id, label, src: makeArt(from, to, accent, seed) };
  }

  const people = {
    alice: { id: "alice", name: "Alice Owner", initials: "AO", role: "Owner", tone: "alice", assignable: true, mentionable: true },
    charlie: { id: "charlie", name: "Charlie Manager", initials: "CM", role: "Manager", tone: "charlie", assignable: true, mentionable: true },
    david: { id: "david", name: "David Member", initials: "DM", role: "Member", tone: "david", assignable: true, mentionable: true },
    eve: { id: "eve", name: "Eve Viewer", initials: "EV", role: "Viewer", tone: "eve", assignable: false, mentionable: true }
  };

  const roleMeta = {
    owner: { label: "Owner", userId: "alice", description: "Full workspace and project access" },
    manager: { label: "Manager", userId: "charlie", description: "Runs this project; cannot grant managers" },
    member: { label: "Member", userId: "david", description: "Works on cards; no board settings or trash" },
    viewer: { label: "Viewer", userId: "eve", description: "Read-only, including comments and images" }
  };

  const permissions = {
    owner: { read: true, edit: true, move: true, comment: true, upload: true, manageBoard: true, deleteCard: true, invite: true, moderate: true },
    manager: { read: true, edit: true, move: true, comment: true, upload: true, manageBoard: true, deleteCard: true, invite: true, moderate: true },
    member: { read: true, edit: true, move: true, comment: true, upload: true, manageBoard: false, deleteCard: false, invite: false, moderate: false },
    viewer: { read: true, edit: false, move: false, comment: false, upload: false, manageBoard: false, deleteCard: false, invite: false, moderate: false }
  };

  const columns = [
    { id: "col_backlog", name: "Not started", tone: "backlog" },
    { id: "col_progress", name: "In progress", tone: "progress" },
    { id: "col_testing", name: "Testing", tone: "testing" },
    { id: "col_blocked", name: "Blocked", tone: "blocked" },
    { id: "col_completed", name: "Completed", tone: "completed" }
  ];

  function act(actorId, icon, text, hours) {
    return { id: "act_" + Math.random().toString(36).slice(2, 8), actorId, icon, text, at: hoursAgo(hours) };
  }

  function comment(id, authorId, body, hours) {
    return { id, authorId, body, at: hoursAgo(hours) };
  }

  const cards = [
    {
      id: "card_101", key: "WEB-101", title: "Finalize homepage copy",
      description: "Tighten the hero and feature copy. Keep the approved product claims unchanged and flag anything that needs a legal read.",
      columnId: "col_backlog", priority: "high", assignees: ["david"], due: isoDate(2), createdAt: hoursAgo(72),
      images: [],
      comments: [
        comment("c_101_1", "david", "Hero copy is ready for review. I kept the project-scoped access claim because it is the part customers ask about most.", 20),
        comment("c_101_2", "charlie", "@David Member can you also check the empty-state line? It should say no cards match, not that the column is empty.", 8)
      ],
      activity: [
        act("alice", "plus", "created this card", 72),
        act("alice", "user", "assigned David Member", 70),
        act("charlie", "calendar", "set the due date", 48),
        act("david", "comment", "posted a comment", 20)
      ]
    },
    {
      id: "card_102", key: "WEB-102", title: "Collect logo files from brand team",
      description: "Source SVG and PNG lockups, then confirm usage rights in writing. Keep the files private to the project.",
      columnId: "col_backlog", priority: "low", assignees: ["alice"], due: isoDate(-2), createdAt: hoursAgo(96),
      images: [
        image("img_102_1", "Primary lockup", "#eee5f3", "#cdb4db", "#684b7c", 2),
        image("img_102_2", "Compact mark", "#fceaf1", "#ffafcc", "#79384f", 5)
      ],
      comments: [
        comment("c_102_1", "alice", "Brand sent SVG and PNG. Both are uploaded here; they stay private to this project.", 30)
      ],
      activity: [
        act("alice", "plus", "created this card", 96),
        act("alice", "image", "added 2 private images", 80),
        act("charlie", "move", "moved this card from In progress to Not started", 40)
      ]
    },
    {
      id: "card_103", key: "WEB-103", title: "Draft pricing page outline",
      description: "Outline sections and open questions for the pricing page. No final numbers yet; this is a structure-only draft.",
      columnId: "col_backlog", priority: "medium", assignees: [], due: null, createdAt: hoursAgo(52),
      images: [], comments: [],
      activity: [act("charlie", "plus", "created this card", 52)]
    },
    {
      id: "card_104", key: "WEB-104", title: "Build responsive navigation",
      description: "Mobile drawer, keyboard focus order and a reduced-motion variant. Escape must close the drawer and return focus.",
      columnId: "col_progress", priority: "high", assignees: ["charlie"], due: isoDate(4), createdAt: hoursAgo(120),
      images: [image("img_104_1", "Mobile nav exploration", "#e7f3fc", "#a2d2ff", "#315a76", 3)],
      comments: [
        comment("c_104_1", "charlie", "Keyboard order now follows the visual order. Escape closes the drawer and focus returns to the menu button.", 16),
        comment("c_104_2", "alice", "Please keep the board's own scrolling native. Smooth page scrolling should not fight drag and drop.", 11),
        comment("c_104_3", "david", "Tested at 200% zoom on Chrome. The focus ring is visible on every control.", 4)
      ],
      activity: [
        act("charlie", "plus", "created this card", 120),
        act("charlie", "move", "moved this card from Not started to In progress", 50),
        act("alice", "user", "assigned Charlie Manager", 46),
        act("charlie", "image", "added a private image", 30),
        act("david", "comment", "posted a comment", 4)
      ]
    },
    {
      id: "card_105", key: "WEB-105", title: "Set up analytics events",
      description: "Document event names and the properties we actually need. Do not collect comment text, image filenames or private URLs.",
      columnId: "col_progress", priority: "urgent", assignees: ["david"], due: isoDate(8), createdAt: hoursAgo(88),
      images: [],
      comments: [
        comment("c_105_1", "david", "I am not logging comment text or image filenames. Event names are in the description field for now.", 22),
        comment("c_105_2", "charlie", "Good. Add one event for restore so we can tell a restored card from a new one.", 5)
      ],
      activity: [
        act("david", "plus", "created this card", 88),
        act("david", "move", "moved this card from Not started to In progress", 60),
        act("david", "comment", "posted a comment", 22)
      ]
    },
    {
      id: "card_106", key: "WEB-106", title: "QA mobile menu and focus states",
      description: "Test keyboard traps, Escape behavior and focus return on iOS Safari and Chrome. Include the viewer read-only state.",
      columnId: "col_testing", priority: "medium", assignees: ["alice"], due: isoDate(1), createdAt: hoursAgo(100),
      images: [image("img_106_1", "Focus state capture", "#e8f4fc", "#bde0fe", "#39759e", 7)],
      comments: [
        comment("c_106_1", "alice", "Found one focus trap on iOS Safari when the drawer is open. The fix is in progress.", 26),
        comment("c_106_2", "david", "Reproduced it once. It only happens when the on-screen keyboard is visible.", 18),
        comment("c_106_3", "charlie", "Moved to Testing so we do not lose the reproduction steps.", 12),
        comment("c_106_4", "alice", "Retested on device after the fix. Focus returns to the source card.", 3)
      ],
      activity: [
        act("alice", "plus", "created this card", 100),
        act("charlie", "move", "moved this card from In progress to Testing", 12),
        act("alice", "image", "added a private image", 10),
        act("alice", "comment", "posted a comment", 3)
      ]
    },
    {
      id: "card_107", key: "WEB-107", title: "Define type scale and spacing tokens",
      description: "Settle the 4px spacing base and the responsive heading scale for board and detail views.",
      columnId: "col_completed", priority: "none", assignees: ["charlie"], due: isoDate(-6), createdAt: hoursAgo(260),
      images: [
        image("img_107_1", "Type scale", "#eee5f3", "#cdb4db", "#543866", 4),
        image("img_107_2", "Spacing ramp", "#e7f3fc", "#a2d2ff", "#315a76", 8)
      ],
      comments: [
        comment("c_107_1", "charlie", "Tokens are in the design file. The 4px base survived the compact board test.", 60),
        comment("c_107_2", "alice", "Approved. Please keep 12px as the smallest metadata size.", 52)
      ],
      activity: [
        act("charlie", "plus", "created this card", 260),
        act("alice", "check", "moved this card to Completed", 54)
      ]
    },
    {
      id: "card_108", key: "WEB-108", title: "Create reusable button styles",
      description: "Primary, secondary, ghost and destructive states with visible focus in both themes.",
      columnId: "col_completed", priority: "low", assignees: ["david"], due: isoDate(-8), createdAt: hoursAgo(300),
      images: [image("img_108_1", "Button states", "#fceaf1", "#ffc8dd", "#79384f", 6)],
      comments: [],
      activity: [
        act("david", "plus", "created this card", 300),
        act("david", "image", "added a private image", 240),
        act("charlie", "check", "moved this card to Completed", 230)
      ]
    },
    {
      id: "card_109", key: "WEB-109", title: "Audit color contrast",
      description: "Check body text, muted metadata and overdue cues in both themes. Include focus indicators.",
      columnId: "col_completed", priority: "medium", assignees: ["alice"], due: isoDate(-4), createdAt: hoursAgo(210),
      images: [],
      comments: [
        comment("c_109_1", "alice", "Muted metadata needed one step darker in light mode. Overdue text now passes.", 100),
        comment("c_109_2", "charlie", "Dark mode borders were too faint. Raised them one step.", 90),
        comment("c_109_3", "alice", "Rechecked both themes at normal and large text.", 80)
      ],
      activity: [
        act("alice", "plus", "created this card", 210),
        act("charlie", "check", "moved this card to Completed", 78)
      ]
    },
    {
      id: "card_110", key: "WEB-110", title: "Set up project board",
      description: "Create the four working columns and invite the core team. No board-only guest access.",
      columnId: "col_completed", priority: "none", assignees: ["charlie"], due: isoDate(-14), createdAt: hoursAgo(400),
      images: [],
      comments: [comment("c_110_1", "charlie", "Board is ready. Everyone here has project access; there are no board-only grants.", 380)],
      activity: [
        act("alice", "plus", "created this card", 400),
        act("charlie", "check", "moved this card to Completed", 380)
      ]
    },
    {
      id: "card_111", key: "WEB-111", title: "Write image privacy notes",
      description: "Explain authenticated delivery and why a signed link cannot outlive project access.",
      columnId: "col_completed", priority: "none", assignees: ["david"], due: isoDate(-5), createdAt: hoursAgo(280),
      images: [image("img_111_1", "Privacy sketch", "#e8f4fc", "#bde0fe", "#39759e", 9)],
      comments: [
        comment("c_111_1", "david", "Added a note that previously downloaded bytes cannot be recalled after revocation.", 150),
        comment("c_111_2", "alice", "Accurate. Keep the wording plain and avoid promising DRM.", 140)
      ],
      activity: [
        act("david", "plus", "created this card", 280),
        act("david", "image", "added a private image", 200),
        act("alice", "check", "moved this card to Completed", 130)
      ]
    },
    {
      id: "card_112", key: "WEB-112", title: "Confirm 24-hour trash copy",
      description: "Confirm deletion wording states the exact recovery window and never implies permanent deletion is immediate.",
      columnId: "col_completed", priority: "low", assignees: ["alice"], due: isoDate(-3), createdAt: hoursAgo(180),
      images: [],
      comments: [comment("c_112_1", "alice", "Copy says restore before the server deadline. It avoids the phrase permanent delete.", 120)],
      activity: [
        act("alice", "plus", "created this card", 180),
        act("alice", "check", "moved this card to Completed", 118)
      ]
    }
  ];

  const state = {
    role: "owner",
    theme: "light",
    filters: { q: "", assignees: [], due: "any" },
    composerColumn: null,
    quickAddText: "",
    quickAddPriority: "",
    quickAddError: "",
    expandedCompleted: false,
    activeCardId: null,
    draft: null,
    dirty: false,
    tab: "comments",
    moveCardId: null,
    columnEditId: null,
    lastFocus: null,
    undo: null,
    selectedColumnTone: "backlog",
    commentDraft: ""
  };

  window.FB = {
    people,
    roleMeta,
    permissions,
    columns,
    cards,
    state,
    helpers: {
      isoDate, hoursAgo, parseDateOnly, daysUntil, formatShort, dueInfo,
      relativeTime, escapeHTML, image, makeArt
    },
    currentUser() {
      return people[roleMeta[state.role].userId];
    },
    can(action) {
      return Boolean(permissions[state.role] && permissions[state.role][action]);
    },
    column(id) {
      return columns.find((c) => c.id === id) || null;
    },
    card(id) {
      return cards.find((c) => c.id === id) || null;
    },
    createCard(card) {
      const allowedPriorities = ["low", "medium", "high", "urgent"];
      if (!card || !allowedPriorities.includes(card.priority)) {
        return { ok: false, error: "Choose a priority before creating the card." };
      }
      if (!String(card.title || "").trim()) {
        return { ok: false, error: "Enter a card title before creating the card." };
      }
      cards.push(card);
      return { ok: true, card };
    },
    person(id) {
      return people[id] || null;
    },
    isDone(card) {
      return (columns.find((column) => column.id === card.columnId)?.category || (card.columnId === "col_completed" ? "done" : "active")) === "done";
    }
  };
})();
