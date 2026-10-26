/* Flowboard UI artifact — synthetic data for the remaining screens.
   Design evidence only. No API calls, no persistence, no real people. */
(function () {
  "use strict";

  const FB = window.FB;
  const H = FB.helpers;

  const projects = [
    {
      id: "website-redesign",
      name: "Website Redesign",
      description: "Marketing site refresh. One board, four working columns and a small project team. Every card, comment and image stays inside this project.",
      status: "active",
      mark: "WR",
      tone: "gold",
      ownerId: "alice",
      createdAt: H.hoursAgo(24 * 32),
      archivedAt: null,
      archivedBy: null,
      boardIds: ["board_website"],
      memberIds: ["alice", "charlie", "david", "eve"]
    },
    {
      id: "brand-refresh",
      name: "Brand Refresh",
      description: "Visual identity exploration retained as an archive. Boards are read-only until the Owner reopens the project.",
      status: "archived",
      mark: "BR",
      tone: "sage",
      ownerId: "alice",
      createdAt: H.hoursAgo(24 * 90),
      archivedAt: H.hoursAgo(24 * 6),
      archivedBy: "alice",
      boardIds: ["board_brand"],
      memberIds: ["alice", "eve"]
    }
  ];

  const boards = [
    {
      id: "board_website",
      projectId: "website-redesign",
      name: "Website Kanban",
      description: "Marketing site refresh",
      status: "active",
      updatedAt: H.hoursAgo(0.2),
      cardCount: FB.cards.length
    },
    {
      id: "board_brand",
      projectId: "brand-refresh",
      name: "Brand Guidelines",
      description: "Identity exploration",
      status: "active",
      updatedAt: H.hoursAgo(24 * 7),
      cardCount: 0
    }
  ];

  const members = [
    { personId: "alice", role: "Owner", email: "alice@acme.test", status: "active", joinedAt: H.hoursAgo(24 * 32), lastActive: H.hoursAgo(0.2) },
    { personId: "charlie", role: "Manager", email: "charlie@acme.test", status: "active", joinedAt: H.hoursAgo(24 * 28), lastActive: H.hoursAgo(1) },
    { personId: "david", role: "Member", email: "david@acme.test", status: "active", joinedAt: H.hoursAgo(24 * 21), lastActive: H.hoursAgo(4) },
    { personId: "eve", role: "Viewer", email: "eve@acme.test", status: "active", joinedAt: H.hoursAgo(24 * 4), lastActive: H.hoursAgo(26) }
  ];

  const pendingInvites = [
    {
      id: "inv_maya",
      name: "Maya Chen",
      email: "maya.chen@acme.test",
      role: "Member",
      invitedBy: "alice",
      invitedAt: H.hoursAgo(52),
      projectId: "website-redesign",
      status: "pending"
    }
  ];

  const inbox = {
    alice: [
      {
        id: "n_a1", type: "mention", read: false, actorId: "charlie",
        text: "mentioned you in WEB-104", excerpt: "Please keep the board's own scrolling native. Smooth page scrolling should not fight drag and drop.",
        at: H.hoursAgo(11), href: "../index.html?card=card_104", projectId: "website-redesign", cardId: "card_104"
      },
      {
        id: "n_a2", type: "mention", read: false, actorId: "david",
        text: "mentioned you in WEB-101", excerpt: "Hero copy is ready for review. I kept the project-scoped access claim because it is the part customers ask about most.",
        at: H.hoursAgo(20), href: "../index.html?card=card_101", projectId: "website-redesign", cardId: "card_101"
      },
      {
        id: "n_a3", type: "assignment", read: false, actorId: "charlie",
        text: "assigned you to WEB-106", excerpt: "QA mobile menu and focus states · due tomorrow",
        at: H.hoursAgo(12), href: "../index.html?card=card_106", projectId: "website-redesign", cardId: "card_106"
      },
      {
        id: "n_a4", type: "import", read: true, actorId: "charlie",
        text: "completed an import", excerpt: "3 cards created in Website Kanban. No rows were skipped or conflicted.",
        at: H.hoursAgo(48), href: "import.html?sample=clean&stage=done", projectId: "website-redesign"
      },
      {
        id: "n_a5", type: "restore", read: true, actorId: "charlie",
        text: "restored WEB-096", excerpt: "Restored to Not started before the 24-hour deadline.",
        at: H.hoursAgo(72), href: "../index.html", projectId: "website-redesign", cardId: "card_096"
      },
      {
        id: "n_a6", type: "invite", read: true, actorId: "eve",
        text: "accepted an invitation", excerpt: "Eve joined Website Redesign as Viewer.",
        at: H.hoursAgo(96), href: "people.html", projectId: "website-redesign"
      }
    ],
    charlie: [
      {
        id: "n_c1", type: "mention", read: false, actorId: "alice",
        text: "mentioned you in WEB-106", excerpt: "Can you confirm the focus fix before we close this one?",
        at: H.hoursAgo(3), href: "../index.html?card=card_106", projectId: "website-redesign", cardId: "card_106"
      },
      {
        id: "n_c2", type: "assignment", read: true, actorId: "alice",
        text: "assigned you to WEB-107", excerpt: "Define type scale and spacing tokens",
        at: H.hoursAgo(54), href: "../index.html?card=card_107", projectId: "website-redesign", cardId: "card_107"
      },
      {
        id: "n_c3", type: "restore", read: true, actorId: "alice",
        text: "restored WEB-096", excerpt: "Restored to Not started before the 24-hour deadline.",
        at: H.hoursAgo(72), href: "../index.html", projectId: "website-redesign", cardId: "card_096"
      }
    ],
    david: [
      {
        id: "n_d1", type: "mention", read: false, actorId: "charlie",
        text: "mentioned you in WEB-101", excerpt: "Can you also check the empty-state line? It should say no cards match, not that the column is empty.",
        at: H.hoursAgo(8), href: "../index.html?card=card_101", projectId: "website-redesign", cardId: "card_101"
      },
      {
        id: "n_d2", type: "assignment", read: false, actorId: "charlie",
        text: "assigned you to WEB-105", excerpt: "Set up analytics events · due in 8 days",
        at: H.hoursAgo(22), href: "../index.html?card=card_105", projectId: "website-redesign", cardId: "card_105"
      },
      {
        id: "n_d3", type: "mention", read: true, actorId: "alice",
        text: "mentioned you in WEB-106", excerpt: "The keyboard fix is ready for your retest.",
        at: H.hoursAgo(30), href: "../index.html?card=card_106", projectId: "website-redesign", cardId: "card_106"
      },
      {
        id: "n_d4", type: "comment", read: true, actorId: "charlie",
        text: "replied to your comment", excerpt: "Good. Add one event for restore so we can tell a restored card from a new one.",
        at: H.hoursAgo(52), href: "../index.html?card=card_105", projectId: "website-redesign", cardId: "card_105"
      }
    ],
    eve: [
      {
        id: "n_e1", type: "mention", read: false, actorId: "alice",
        text: "mentioned you in WEB-106", excerpt: "Viewer read-only check — can you confirm the composer is hidden on your side?",
        at: H.hoursAgo(26), href: "../index.html?card=card_106", projectId: "website-redesign", cardId: "card_106"
      },
      {
        id: "n_e2", type: "invite", read: true, actorId: "alice",
        text: "invited you to Website Redesign", excerpt: "You joined as Viewer. Read-only access includes cards, comments and images.",
        at: H.hoursAgo(96), href: "people.html", projectId: "website-redesign"
      }
    ]
  };

  const accessEvents = [
    { id: "ev_1", scope: "access", category: "access", actorId: "alice", icon: "shield", text: "granted Charlie Manager access", at: H.hoursAgo(144), projectId: "website-redesign", target: "Charlie Manager" },
    { id: "ev_2", scope: "access", category: "access", actorId: "alice", icon: "user-plus", text: "invited Eve Viewer", at: H.hoursAgo(96), projectId: "website-redesign", target: "Eve Viewer" },
    { id: "ev_3", scope: "access", category: "access", actorId: "eve", icon: "check", text: "accepted the invitation as Viewer", at: H.hoursAgo(95), projectId: "website-redesign", target: "Eve Viewer" },
    { id: "ev_4", scope: "access", category: "trash", actorId: "charlie", icon: "trash", text: "moved WEB-097 to trash", at: H.hoursAgo(5.8), projectId: "website-redesign", cardId: "card_097", target: "WEB-097" },
    { id: "ev_5", scope: "access", category: "trash", actorId: "charlie", icon: "restore", text: "restored WEB-096 to Not started", at: H.hoursAgo(72), projectId: "website-redesign", target: "WEB-096" },
    { id: "ev_6", scope: "access", category: "import", actorId: "charlie", icon: "upload", text: "imported 3 cards into Website Kanban", at: H.hoursAgo(48), projectId: "website-redesign", target: "Website Kanban" },
    { id: "ev_7", scope: "access", category: "settings", actorId: "charlie", icon: "columns", text: "renamed column Backlog to Not started", at: H.hoursAgo(216), projectId: "website-redesign", target: "Not started" },
    { id: "ev_8", scope: "access", category: "access", actorId: "alice", icon: "archive", text: "archived Brand Refresh", at: H.hoursAgo(144), projectId: "brand-refresh", target: "Brand Refresh" },
    { id: "ev_9", scope: "access", category: "access", actorId: "alice", icon: "folder", text: "created Brand Refresh", at: H.hoursAgo(2160), projectId: "brand-refresh", target: "Brand Refresh" }
  ];

  const trash = [
    {
      id: "trash_web_097",
      cardId: "card_097",
      key: "WEB-097",
      title: "Remove legacy pricing banner",
      description: "Retire the old pricing banner and its mobile variant after the new page ships.",
      projectId: "website-redesign",
      boardId: "board_website",
      columnId: "col_backlog",
      deletedBy: "charlie",
      deletedAt: H.hoursAgo(5.8),
      commentCount: 2,
      imageCount: 1
    }
  ];

  const importSamples = {
    errors: {
      id: "sample_errors",
      name: "website-cards-with-errors.xlsx",
      size: "18.4 KB",
      rows: [
        { row: 2, externalId: "EXT-1001", title: "Refresh homepage hero", priority: "high", due: H.isoDate(7), assignees: ["david@acme.test"], status: "Not started", result: "ready" },
        { row: 3, externalId: "EXT-1002", title: "Update pricing FAQ", priority: "medium", due: H.isoDate(12), assignees: ["alice@acme.test", "charlie@acme.test"], status: "In progress", result: "ready" },
        { row: 4, externalId: "EXT-1003", title: "QA keyboard flow", priority: "urgent", due: H.isoDate(3), assignees: ["david@acme.test"], status: "Testing", result: "ready" },
        { row: 5, externalId: "EXT-1004", title: "Confirm holiday campaign dates", priority: "medium", due: "Next Friday", assignees: ["alice@acme.test"], status: "Not started", result: "invalid", field: "Due Date", message: "Ambiguous date text. Use a real Excel date or strict YYYY-MM-DD." },
        { row: 6, externalId: "EXT-0999", title: "Legacy pricing banner", priority: "low", due: H.isoDate(4), assignees: ["charlie@acme.test"], status: "Completed", result: "conflict", field: "External ID", message: "Already imported with a different payload. Use a new External ID or edit the existing card." }
      ]
    },
    clean: {
      id: "sample_clean",
      name: "website-cards-ready.xlsx",
      size: "16.1 KB",
      rows: [
        { row: 2, externalId: "EXT-1001", title: "Refresh homepage hero", priority: "high", due: H.isoDate(7), assignees: ["david@acme.test"], status: "Not started", result: "ready" },
        { row: 3, externalId: "EXT-1002", title: "Update pricing FAQ", priority: "medium", due: H.isoDate(12), assignees: ["alice@acme.test", "charlie@acme.test"], status: "In progress", result: "ready" },
        { row: 4, externalId: "EXT-1003", title: "QA keyboard flow", priority: "urgent", due: H.isoDate(3), assignees: ["david@acme.test"], status: "Testing", result: "ready" }
      ]
    }
  };

  const createdCards = [];
  const importResults = [];

  const cardEvents = [];
  FB.cards.forEach((card) => {
    card.activity.forEach((event) => {
      cardEvents.push({
        id: event.id,
        scope: "card",
        category: event.icon === "plus" ? "cards"
          : event.icon === "user" ? "assignments"
          : event.icon === "calendar" ? "due"
          : event.icon === "comment" ? "comments"
          : event.icon === "move" ? "moves"
          : event.icon === "image" ? "images"
          : event.icon === "check" ? "status"
          : "cards",
        actorId: event.actorId,
        icon: event.icon,
        text: event.text,
        at: event.at,
        projectId: "website-redesign",
        boardId: "board_website",
        cardId: card.id
      });
    });
  });

  function project(id) {
    return projects.find((p) => p.id === id) || null;
  }

  function board(id) {
    return boards.find((b) => b.id === id) || null;
  }

  function member(personId, projectId) {
    const p = projectId ? project(projectId) : null;
    if (p && !p.memberIds.includes(personId)) return null;
    return members.find((m) => m.personId === personId) || null;
  }

  function canAccessProject(personId, projectId) {
    const p = project(projectId);
    return Boolean(p && p.memberIds.includes(personId));
  }

  function inboxFor(personId) {
    return inbox[personId] || [];
  }

  function unreadCount(personId) {
    return inboxFor(personId).filter((item) => !item.read).length;
  }

  function trashForProject(projectId) {
    return trash.filter((item) => item.projectId === projectId);
  }

  function nextCardKey() {
    const max = FB.cards.reduce((value, card) => {
      const n = Number((card.key || "").split("-")[1]);
      return Number.isFinite(n) ? Math.max(value, n) : value;
    }, 100);
    return `WEB-${max + createdCards.length + 1}`;
  }

  window.SD = {
    projects,
    boards,
    members,
    pendingInvites,
    inbox,
    accessEvents,
    cardEvents,
    trash,
    importSamples,
    createdCards,
    importResults,
    project,
    board,
    member,
    canAccessProject,
    inboxFor,
    unreadCount,
    trashForProject,
    nextCardKey
  };
})();
