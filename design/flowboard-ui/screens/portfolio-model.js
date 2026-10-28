/* Synthetic portfolio model: local design evidence, never authorization or API data.
   Project → boards → columns → cards. Board access is granted separately from the project. */
(function () {
  "use strict";
  const FB = window.FB, SD = window.SD;
  const initialWebsiteCards = FB.cards.slice();
  const initialWebsiteColumns = FB.columns.map(column => ({ ...column }));
  const key = "flowboard-portfolio-demo-v2";
  const TONES = ["icy", "petal", "thistle", "sky", "pink", "slate"];
  let stored = {};
  try { stored = JSON.parse(sessionStorage.getItem(key) || "{}"); } catch (_) {}

  const projectMembership = stored.projectMembers && typeof stored.projectMembers === "object" ? stored.projectMembers : {};
  const custom = Array.isArray(stored.projects) ? stored.projects.filter(p => p && /^demo_/.test(p.id) && typeof p.name === "string").map(p => ({
    ...p, name: p.name.slice(0, 100), description: String(p.description || "").slice(0, 2000),
    ownerId: "alice", memberIds: [...new Set(["alice", ...(Array.isArray(projectMembership[p.id]) ? projectMembership[p.id] : [])])], boardIds: [], status: "active",
    mark: p.name.slice(0, 2).toUpperCase(), tone: TONES.includes(p.tone) ? p.tone : "thistle"
  })) : [];
  const customBoards = Array.isArray(stored.boards) ? stored.boards.filter(b => b && /^demo_board_/.test(b.id) && typeof b.name === "string").map(b => ({
    ...b, name: b.name.slice(0, 100), description: String(b.description || "").slice(0, 2000),
    status: "active", tone: TONES.includes(b.tone) ? b.tone : "icy"
  })) : [];
  const archived = stored.archived && typeof stored.archived === "object" ? stored.archived : {};
  const membership = stored.boardMembers && typeof stored.boardMembers === "object" ? stored.boardMembers : {};
  const seedMembers = {
    "fashion-web": ["alice", "charlie", "david"],
    "fashion-marketing": ["alice", "david", "eve"],
    "fashion-operations": ["alice"],
    "board_website": ["alice", "charlie", "david", "eve"],
    "board_brand": ["alice", "eve"]
  };
  const fashion = {
    id: "my-fashion", name: "My Fashion", description: "One brand. Three teams moving together.",
    status: "active", mark: "MF", tone: "thistle", ownerId: "alice",
    memberIds: ["alice", "charlie", "david", "eve"],
    boardIds: ["fashion-web", "fashion-marketing", "fashion-operations"]
  };
  const examples = [
    { id: "fashion-web", projectId: fashion.id, name: "Web", description: "Storefront, checkout and customer experience", tone: "icy", status: "active" },
    { id: "fashion-marketing", projectId: fashion.id, name: "Marketing", description: "Campaigns, content and launches", tone: "petal", status: "active" },
    { id: "fashion-operations", projectId: fashion.id, name: "Operations", description: "Orders, suppliers and daily operations", tone: "thistle", status: "active" }
  ];
  const sample = [
    ["fashion-web", "WEB", "todo", "Ready", "Review product-page content", "medium", 3, "david"],
    ["fashion-web", "WEB", "active", "Building", "Improve mobile checkout", "high", 1, "charlie"],
    ["fashion-web", "WEB", "active", "Review", "Check storefront accessibility", "medium", 5, "david"],
    ["fashion-web", "WEB", "done", "Published", "Publish the spring collection", "low", null, "charlie"],
    ["fashion-marketing", "MKT", "todo", "Planned", "Plan the weekend campaign", "medium", 4, "eve"],
    ["fashion-marketing", "MKT", "active", "Creating", "Prepare the product photo brief", "high", -1, "david"],
    ["fashion-marketing", "MKT", "done", "Live", "Send the launch newsletter", "low", null, "eve"],
    ["fashion-operations", "OPS", "todo", "Queue", "Confirm packaging quantities", "medium", 6, "alice"],
    ["fashion-operations", "OPS", "active", "In progress", "Follow up with the print supplier", "urgent", 0, "alice"],
    ["fashion-operations", "OPS", "done", "Resolved", "Update the returns checklist", "low", null, "alice"]
  ].map((r, i) => ({
    id: `fashion-card-${i + 1}`, key: `${r[1]}-${i + 1}`, boardId: r[0], projectId: fashion.id,
    category: r[2], columnId: `${r[0]}-${r[2]}-${r[3].toLowerCase().replace(/\s/g, "-")}`,
    columnName: r[3], title: r[4], priority: r[5], due: r[6] === null ? null : FB.helpers.isoDate(r[6]),
    assignees: [r[7]], description: "", sample: true
  }));

  const user = () => window.Screens.currentUser();
  const canAggregate = () => window.Screens.role === "owner";
  const allProjects = () => [fashion, ...SD.projects, ...custom].map(p => ({
    ...p,
    memberIds: Array.isArray(projectMembership[p.id])
      ? [...new Set([p.ownerId, ...projectMembership[p.id].filter(id => Boolean(FB.person(id)))])]
      : p.memberIds,
    status: Object.hasOwn(archived, p.id) ? (archived[p.id] ? "archived" : "active") : p.status
  }));
  const seedBoards = () => [...examples, ...SD.boards];
  const rawBoards = () => [...seedBoards(), ...customBoards];
  const rawProject = id => allProjects().find(p => p.id === id);
  const owns = p => Boolean(p && canAggregate() && p.ownerId === user().id);

  function boardTone(board) {
    if (board && TONES.includes(board.tone)) return board.tone;
    const index = rawBoards().findIndex(b => board && b.id === board.id);
    return TONES[(index < 0 ? 0 : index) % TONES.length];
  }
  function grantIds(b, p) {
    const ids = Object.hasOwn(membership, b.id) ? membership[b.id] : seedMembers[b.id] || [];
    return [...new Set([p.ownerId, ...(Array.isArray(ids) ? ids : []).filter(id => p.memberIds.includes(id))])];
  }
  function canReadBoard(b, p) { return owns(p) || Boolean(p && p.memberIds.includes(user().id) && grantIds(b, p).includes(user().id)); }
  function scopedProject(p) {
    return { ...p, boardIds: rawBoards().filter(b => b.projectId === p.id && canReadBoard(b, p)).map(b => b.id) };
  }
  function projects() { return allProjects().filter(p => owns(p) || p.memberIds.includes(user().id)).map(scopedProject); }
  const project = id => projects().find(p => p.id === id) || null;
  function boards(projectId) {
    return rawBoards().filter(b => {
      const p = rawProject(b.projectId);
      return p && canReadBoard(b, p) && (!projectId || b.projectId === projectId);
    }).map(b => ({ ...b, tone: boardTone(b) }));
  }
  const board = id => boards().find(b => b.id === id) || null;
  function boardMembers(boardId) {
    const b = rawBoards().find(item => item.id === boardId), p = b && rawProject(b.projectId);
    return b && owns(p) ? grantIds(b, p) : [];
  }
  function availableMembers(projectId) {
    const p = rawProject(projectId);
    return owns(p) ? p.memberIds.map(id => FB.person(id)).filter(Boolean).map(person => ({ id: person.id, name: person.name, role: person.role })) : [];
  }
  function candidateMembers(projectId) {
    return owns(rawProject(projectId)) ? Object.values(FB.people).map(person => ({ id: person.id, name: person.name, role: person.role })) : [];
  }
  function setProjectMembers(projectId, ids) {
    const p = rawProject(projectId);
    if (!owns(p) || p.status === "archived" || !Array.isArray(ids) || ids.some(id => !FB.person(id))) return false;
    const previous = [...p.memberIds];
    const next = [...new Set([p.ownerId, ...ids])];
    const priorStored = projectMembership[projectId];
    const priorBoardMembers = {};
    rawBoards().filter(b => b.projectId === projectId).forEach(b => { priorBoardMembers[b.id] = membership[b.id]; });
    projectMembership[projectId] = next;
    p.memberIds = next;
    const removed = new Set(previous.filter(id => !next.includes(id)));
    if (removed.size) rawBoards().filter(b => b.projectId === projectId).forEach(b => {
      membership[b.id] = grantIds(b, p).filter(id => !removed.has(id));
    });
    if (persist()) return true;
    if (priorStored === undefined) delete projectMembership[projectId]; else projectMembership[projectId] = priorStored;
    p.memberIds = previous;
    for (const [boardId, value] of Object.entries(priorBoardMembers)) {
      if (value === undefined) delete membership[boardId]; else membership[boardId] = value;
    }
    return false;
  }
  function setBoardMembers(boardId, ids) {
    const b = rawBoards().find(item => item.id === boardId), p = b && rawProject(b.projectId);
    if (!owns(p) || p.status === "archived" || !Array.isArray(ids) || ids.some(id => !p.memberIds.includes(id))) return false;
    const previous = membership[boardId];
    membership[boardId] = [...new Set([p.ownerId, ...ids])];
    if (!persist()) { if (previous === undefined) delete membership[boardId]; else membership[boardId] = previous; return false; }
    return true;
  }
  function baseCategory(columnId) {
    const category = FB.column(columnId)?.category;
    return ["todo", "active", "done"].includes(category) ? category : columnId === "col_backlog" ? "todo" : columnId === "col_completed" ? "done" : "active";
  }
  const boardStoreKey = "flowboard-workspace-boards-v1";
  function boardSnapshots() {
    try { const data=JSON.parse(sessionStorage.getItem(boardStoreKey)||"{}"); return data && typeof data==="object" ? data : {}; } catch (_) { return {}; }
  }
  function sourceCards() {
    const snapshots=boardSnapshots();
    const website=snapshots.board_website && Array.isArray(snapshots.board_website.cards) ? snapshots.board_website.cards : initialWebsiteCards;
    const restored=Object.entries(snapshots).filter(([id,snapshot])=>id!=="board_website" && Array.isArray(snapshot?.cards)).flatMap(([id,snapshot]) => {
      const b=rawBoards().find(entry=>entry.id===id);
      if(!b)return [];
      return snapshot.cards.map(card=>({...card,boardId:id,projectId:b.projectId}));
    });
    return [
      ...website.map(c => ({ ...c, projectId: "website-redesign", boardId: "board_website" })),
      ...sample.filter(c=>!Array.isArray(snapshots[c.boardId]?.cards)),
      ...restored,
      ...SD.createdCards
    ].map(c=>{
      const snapshot=snapshots[c.boardId];
      const sourceColumn=Array.isArray(snapshot?.columns) ? snapshot.columns.find(col=>col.id===c.columnId) : c.boardId==="board_website" ? initialWebsiteColumns.find(column=>column.id===c.columnId) : null;
      return {...c,columnName:sourceColumn?.name || c.columnName || "Unknown",category:sourceColumn?.category || (c.boardId==="board_website" ? baseCategory(c.columnId) : c.category || "active")};
    });
  }
  function cards(filters = {}) {
    const scopeId = filters.projectId || board(filters.boardId)?.projectId || projects().find(p => p.status === "active")?.id;
    if (!scopeId) return [];
    const seen = new Set();
    return sourceCards().filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; }).flatMap(c => {
      const p = project(c.projectId), b = board(c.boardId);
      if (!p || !b || b.projectId !== p.id || p.id !== scopeId) return [];
      if (!filters.includeArchived && (p.status === "archived" || b.status === "archived")) return [];
      if ((filters.projectId && p.id !== filters.projectId) || (filters.boardId && b.id !== filters.boardId)) return [];
      if ((filters.category && c.category !== filters.category) || (filters.priority && c.priority !== filters.priority)) return [];
      if (filters.q && !`${c.title} ${c.key} ${p.name} ${b.name}`.toLowerCase().includes(filters.q.toLowerCase().trim())) return [];
      return [{
        id: c.id, key: c.key, title: c.title, priority: c.priority, due: c.due,
        assignees: [...c.assignees], projectId: p.id, boardId: b.id, boardTone: b.tone,
        columnId: c.columnId, columnName: c.columnName, category: c.category,
        projectName: p.name, boardName: b.name, projectStatus: p.status
      }];
    });
  }
  function statsFor(projectId, boardId) {
    const p = project(projectId);
    if (!p) return { total: 0, open: 0, done: 0, overdue: 0, percent: 0 };
    const list = cards({ projectId, boardId, includeArchived: p.status === "archived" });
    const done = list.filter(c => c.category === "done").length;
    return {
      total: list.length,
      open: list.length - done,
      done,
      overdue: list.filter(c => c.category !== "done" && c.due && FB.helpers.daysUntil(c.due) < 0).length,
      percent: list.length ? Math.round((done / list.length) * 100) : 0
    };
  }
  const boardStats = boardId => {
    const b = board(boardId);
    return b ? statsFor(b.projectId, b.id) : { total: 0, open: 0, done: 0, overdue: 0, percent: 0 };
  };
  const projectStats = projectId => statsFor(projectId);
  function projectPeople(projectId) {
    const p = rawProject(projectId);
    if (!owns(p)) return [];
    const list = rawBoards().filter(b => b.projectId === p.id);
    return p.memberIds.map(id => {
      const person = FB.person(id);
      if (!person) return null;
      const count = list.filter(b => grantIds(b, p).includes(id)).length;
      return {
        id: person.id, name: person.name, role: person.role, initials: person.initials,
        tone: person.tone, boardCount: count, boardTotal: list.length,
        percent: list.length ? Math.round((count / list.length) * 100) : 0
      };
    }).filter(Boolean);
  }
  function myAccess(projectId) {
    const p = project(projectId);
    if (!p) return { boards: 0, names: [] };
    const list = boards(projectId);
    return { boards: list.length, names: list.map(b => b.name) };
  }
  function summary(projectId) {
    projectId = projectId || projects().find(p => p.status === "active")?.id;
    if (!projectId) return { projects: 0, boards: 0, total: 0, open: 0, done: 0, overdue: 0, percent: 0 };
    const cs = statsFor(projectId);
    return { projects: 1, boards: boards(projectId).length, ...cs };
  }
  function portfolioSummary() {
    const list = projects().filter(p => p.status === "active");
    return list.reduce((acc, p) => {
      const s = statsFor(p.id), b = boards(p.id).length;
      acc.projects += 1; acc.boards += b; acc.cards += s.total; acc.open += s.open;
      acc.done += s.done; acc.overdue += s.overdue;
      return acc;
    }, { projects: 0, boards: 0, cards: 0, open: 0, done: 0, overdue: 0 });
  }
  function persist() {
    try { sessionStorage.setItem(key, JSON.stringify({ projects: custom, boards: customBoards, archived, boardMembers: membership, projectMembers: projectMembership })); return true; } catch (_) { return false; }
  }
  function href(file, params = {}) {
    const q = new URLSearchParams();
    if (window.Screens.role !== "owner") q.set("role", window.Screens.role);
    const theme = document.documentElement.dataset.theme;
    if (theme === "dark") q.set("theme", theme);
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    return file + (q.size ? "?" + q.toString() : "");
  }
  function addProject(input) {
    if (!canAggregate()) return null;
    const name = String(input.name || "").trim();
    if (!name || name.length > 100 || projects().some(p => p.name.toLowerCase() === name.toLowerCase())) return null;
    const p = {
      id: `demo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name,
      description: String(input.description || "").trim().slice(0, 2000),
      ownerId: "alice", memberIds: ["alice"], boardIds: [], status: "active",
      mark: name.slice(0, 2).toUpperCase(), tone: TONES[custom.length % TONES.length]
    };
    custom.push(p);
    if (!persist()) { custom.pop(); return null; }
    return p;
  }
  function addBoard(input) {
    if (!canAggregate()) return null;
    const p = rawProject(input.projectId);
    if (!p || !owns(p) || p.status === "archived") return null;
    const name = String(input.name || "").trim();
    if (!name || name.length > 100) return null;
    if (rawBoards().some(b => b.projectId === p.id && b.name.toLowerCase() === name.toLowerCase())) return null;
    const ids = Array.isArray(input.memberIds) ? input.memberIds.filter(id => p.memberIds.includes(id)) : [];
    const boardId = `demo_board_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const record = {
      id: boardId, projectId: p.id, name,
      description: String(input.description || "").trim().slice(0, 2000),
      status: "active", tone: TONES[customBoards.length % TONES.length]
    };
    customBoards.push(record);
    membership[boardId] = [...new Set([p.ownerId, ...ids])];
    if (!persist()) { customBoards.pop(); delete membership[boardId]; return null; }
    return { ...record };
  }
  function setArchived(id, value) {
    if (!owns(rawProject(id)) || !project(id)) return false;
    const previous = archived[id];
    archived[id] = Boolean(value);
    if (persist()) return true;
    if (previous === undefined) delete archived[id]; else archived[id] = previous;
    return false;
  }
  function columns(boardId) {
    if (!board(boardId)) return [];
    const saved=boardSnapshots()[boardId];
    if(Array.isArray(saved?.columns) && saved.columns.length) return saved.columns.map(c=>({...c}));
    if (boardId === "board_website") return initialWebsiteColumns.map(c => ({ ...c, category: c.category || (c.id === "col_backlog" ? "todo" : c.id === "col_completed" ? "done" : "active") }));
    return [...new Map(sample.filter(c => c.boardId === boardId).map(c => [c.columnId, { id: c.columnId, name: c.columnName, category: c.category }])).values()];
  }
  function fullBoardData(boardId) {
    const b=board(boardId),p=b && project(b.projectId);
    if(!b || !p) return null;
    const seen=new Set();
    const rows=sourceCards().filter(c=>c.boardId===b.id && c.projectId===p.id && !seen.has(c.id) && seen.add(c.id));
    return {board:b,project:p,columns:columns(b.id),cards:rows.map(c=>({...c,description:c.description||"",assignees:[...(c.assignees||[])],images:[...(c.images||[])],comments:[...(c.comments||[])],activity:[...(c.activity||[])],createdAt:c.createdAt||new Date().toISOString()}))};
  }
  function saveBoardData(boardId, data) {
    const b=board(boardId),p=b && project(b.projectId);
    if(!b || !p || b.status==="archived" || p.status==="archived" || !window.Screens.can("editCard") || !data || !Array.isArray(data.columns) || !Array.isArray(data.cards)) return false;
    const snapshot=boardSnapshots();
    snapshot[boardId]={columns:data.columns.map(c=>({...c})),cards:data.cards.map(c=>({...c,projectId:p.id,boardId:b.id}))};
    try { sessionStorage.setItem(boardStoreKey, JSON.stringify(snapshot)); return true; } catch (_) { return false; }
  }
  window.Portfolio = {
    projects, project, boards, board, columns, cards, summary, portfolioSummary,
    boardStats, projectStats, projectPeople, myAccess, boardTone, canAggregate, candidateMembers, setProjectMembers,
    addProject, addBoard, setArchived, boardMembers, availableMembers, setBoardMembers,
    projectHref: id => href("project.html", { project: id }),
    boardHref: (boardId, cardId) => { const b=board(boardId); return b ? href("../index.html", { project:b.projectId,board:b.id,card:cardId }) : href("projects.html"); },
    fullBoardData, saveBoardData,
    /* One project workspace: no board opens Overview; a board opens that board tab;
       no board opens the read-only All boards tab. */
    workHref: ({ projectId, boardId } = {}) => boardId ? window.Portfolio.boardHref(boardId) : href("../index.html", {
      project: projectId || projects().find(p => p.status === "active")?.id,
      scope: "all"
    }),
    cardHref: c => !project(c.projectId) || !board(c.boardId) || board(c.boardId).projectId !== c.projectId
      ? href("projects.html") : window.Portfolio.boardHref(c.boardId, c.id)
  };
})();
