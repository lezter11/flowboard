"use strict";

// Exercise the read-only activity preview in an isolated VM. Fixtures model
// cards on several boards and project-level access events without browser APIs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../screens/activity.js");
const source = fs.readFileSync(sourcePath, "utf8").replace(
  "  window.FBPage={",
  "  window.__activityTest = { accessibleEvents, filteredEvents, item, state, render };\n  window.FBPage={"
);

const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
const fixture = () => ({
  projects: [
    { id: "p1", name: "Alpha Project", boardIds: ["b1", "b2"] },
    { id: "p2", name: "Beta Project", boardIds: ["b3"] }
  ],
  boards: [
    { id: "b1", projectId: "p1", name: "Web Board" },
    { id: "b2", projectId: "p1", name: "Ops Board" },
    { id: "b3", projectId: "p2", name: "Marketing Board" }
  ],
  cardsByBoard: {
    b1: [{ id: "c1", key: "WEB-1", title: "Refresh hero", activity: [
      { id: "card-recent", icon: "comment", actorId: "bob", text: "commented on the hero", at: ago(1) },
      { id: "card-old", icon: "move", actorId: "alice", text: "moved the hero", at: ago(20) }
    ] }],
    b2: [{ id: "c2", key: "OPS-2", title: "Review deploy", activity: [
      { id: "card-ops", icon: "check", actorId: "alice", text: "marked deploy ready", at: ago(2) }
    ] }],
    b3: [{ id: "c3", key: "MKT-3", title: "Campaign launch", activity: [
      { id: "card-beta", icon: "plus", actorId: "bob", text: "created campaign", at: ago(1) }
    ] }]
  },
  accessEvents: [
    { id: "access-project", scope: "access", category: "access", actorId: "alice", text: "granted Bob Manager access", at: ago(1), projectId: "p1" },
    { id: "trash-valid", scope: "access", category: "trash", actorId: "bob", text: "moved WEB-1 to trash", at: ago(3), projectId: "p1", boardId: "b1" },
    { id: "wrong-project-board", scope: "access", category: "trash", actorId: "bob", text: "wrong board", at: ago(1), projectId: "p1", boardId: "b3" },
    { id: "ambiguous-boardless-trash", scope: "access", category: "trash", actorId: "bob", text: "unknown board", at: ago(1), projectId: "p1" },
    { id: "invalid-project", scope: "access", category: "access", actorId: "alice", text: "unknown project", at: ago(1), projectId: "missing" }
  ]
});

function harness({ search = "", role = "Owner" } = {}) {
  const data = fixture();
  const calls = [];
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      innerHTML: "", textContent: "", value: "", hidden: false,
      addEventListener: () => {}
    });
    return elements.get(selector);
  };
  const people = { alice: { id: "alice", name: "Alice" }, bob: { id: "bob", name: "Bob" } };
  const project = (id) => data.projects.find((p) => p.id === id) || null;
  const board = (id) => data.boards.find((b) => b.id === id) || null;
  const window = {
    SD: { accessEvents: data.accessEvents, project: (id) => project(id) },
    FB: {
      person: (id) => people[id] || null,
      createCard: () => calls.push("createCard"), updateCard: () => calls.push("updateCard"),
      deleteCard: () => calls.push("deleteCard")
    },
    Screens: {
      can: (permission) => permission === "manageProject" && role === "Owner",
      escape: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
      icon: (name) => `[${name}]`, personName: (id) => people[id]?.name || id,
      relativeTime: (at) => at
    },
    Portfolio: {
      projects: () => data.projects,
      project,
      boards: (projectId) => data.boards.filter((b) => b.projectId === projectId),
      board,
      fullBoardData: (boardId) => ({ cards: data.cardsByBoard[boardId] || [] }),
      boardHref: (boardId, cardId) => `board.html?board=${boardId}&card=${cardId}`
    }
  };
  const context = {
    window,
    document: { querySelector: (selector) => selector === "#crumbs a" ? null : element(selector) },
    URLSearchParams, Date, Intl,
    location: { search }
  };
  vm.runInNewContext(source, context, { filename: sourcePath });
  return { api: window.__activityTest, calls, data, elements, window };
}

test("activity is assembled from the project boards and rejects access events with invalid board provenance", () => {
  const { api } = harness();
  const events = api.accessibleEvents();
  assert.deepEqual(Array.from(events, (event) => event.id), [
    "card-recent", "card-old", "card-ops", "card-beta", "access-project", "trash-valid"
  ]);
  assert.equal(events.find((event) => event.id === "card-ops").boardId, "b2");
  assert.equal(events.find((event) => event.id === "trash-valid").boardId, "b1");
});

test("access and board-admin events appear only to project managers; actor filter includes their actions", () => {
  const owner = harness();
  assert.equal(owner.api.accessibleEvents().some((event) => event.id === "access-project"), true);
  owner.api.state.actor = "alice";
    assert.deepEqual(Array.from(owner.api.filteredEvents(), (event) => event.id), ["access-project", "card-ops", "card-old"]);

  const member = harness({ role: "Member" });
  assert.equal(member.api.accessibleEvents().some((event) => event.scope === "access"), false);
  assert.equal(member.api.accessibleEvents().some((event) => event.id === "card-recent"), true);
});

test("project selection and category, date, and text filters compose", () => {
  const { api } = harness({ search: "?project=p1" });
  assert.equal(api.state.project, "p1");
  assert.equal(api.filteredEvents().every((event) => event.projectId === "p1"), true);
  api.state.category = "comments";
  assert.deepEqual(Array.from(api.filteredEvents(), (event) => event.id), ["card-recent"]);

  api.state.category = "all";
  api.state.date = "7";
  assert.equal(api.filteredEvents().some((event) => event.id === "card-old"), false);
  api.state.q = "web board";
  assert.deepEqual(Array.from(api.filteredEvents(), (event) => event.id), ["card-recent", "trash-valid"]);
  api.state.q = "unknown board";
  assert.deepEqual(Array.from(api.filteredEvents(), (event) => event.id), []);
});

test("card events link to their originating board and card", () => {
  const { api } = harness();
  const cardEvent = api.accessibleEvents().find((event) => event.id === "card-recent");
  assert.match(api.item(cardEvent), /href="board\.html\?board=b1&amp;card=c1"/);
  const accessEvent = api.accessibleEvents().find((event) => event.id === "access-project");
  assert.doesNotMatch(api.item(accessEvent), /class="event-card"/);
});

test("rendering the activity feed does not call mutation APIs or alter preview data", () => {
  const { api, calls, data } = harness();
  const before = JSON.stringify(data);
  api.render();
  api.state.category = "trash";
  api.render();
  assert.deepEqual(calls, []);
  assert.equal(JSON.stringify(data), before);
});
