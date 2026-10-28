"use strict";

// Focused tests of the local inbox preview controller. The VM exposes its
// closure helpers only in-memory; product files and browser storage stay untouched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../screens/inbox.js");
const source = fs.readFileSync(sourcePath, "utf8").replace(
  "  window.FBPage = {",
  `  window.__inboxTest = { items, sourceBoard, buildThreads, haystack, matches, describe, loadReadState, saveReadState, state };\n  window.FBPage = {`
);

function harness({ actor = "alice", grants = ["board-a"], records = null, persisted = {} } = {}) {
  const storage = new Map(Object.entries(persisted));
  const project = { id: "project-a", name: "Project A", boardIds: ["board-a", "board-b"] };
  const boards = [
    { id: "board-a", projectId: "project-a", name: "Board A" },
    { id: "board-b", projectId: "project-a", name: "Board B" },
    { id: "wrong-project", projectId: "project-b", name: "Wrong project" }
  ];
  const card = { id: "card-1", boardId: "board-a", key: "WEB-1", title: "Private card", columnId: "todo", priority: "high", assignees: [] };
  const window = {
    SD: { inboxFor: (id) => id === actor ? (records || []) : [{ id: "other-user-only", type: "mention", projectId: "project-a", boardId: "board-a", text: "secret-other-user" }], project: (id) => id === "project-a" ? project : null, members: [] },
    FB: { card: (id) => id === card.id ? card : null, column: () => ({ name: "To do" }), helpers: { dueInfo: () => null } },
    Screens: { currentUser: () => ({ id: actor }), role: "member", personName: (id) => id, icon: () => "", relativeTime: () => "now", plural: (n, word) => `${n} ${word}` },
    Portfolio: { project: (id) => id === "project-a" ? project : null, board: (id) => grants.includes(id) ? boards.find((b) => b.id === id) || null : null, boardHref: (boardId, cardId) => `board.html?board=${boardId}${cardId ? `&card=${cardId}` : ""}` },
    matchMedia: () => ({ matches: true }), location: { search: "", href: "https://local.test/inbox.html", pathname: "/inbox.html" }
  };
  const context = {
    window,
    document: { documentElement: { dataset: {} } },
    sessionStorage: { getItem: (key) => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, value) },
    URLSearchParams, URL, Date, Map, Object, Array, Boolean, String, Math, JSON, Set
  };
  vm.runInNewContext(source, context, { filename: sourcePath });
  return { api: window.__inboxTest, storage, window };
}

const cardEvent = (overrides = {}) => ({ id: "event-1", type: "mention", read: false, actorId: "bob", text: "mentioned you", excerpt: "needle detail", at: "2026-10-27T10:00:00Z", projectId: "project-a", boardId: "board-a", cardId: "card-1", ...overrides });

test("filters events whose project or provenance board is missing, inaccessible, or mismatched", () => {
  const { api } = harness({ records: [
    cardEvent(),
    cardEvent({ id: "hidden", boardId: "board-b" }),
    cardEvent({ id: "wrong-project-board", boardId: "wrong-project" }),
    cardEvent({ id: "unknown-project", projectId: "missing" }),
    { id: "boardless-import", type: "import", projectId: "project-a", text: "import" }
  ] });
  assert.deepEqual(Array.from(api.items(), (item) => item.id), ["event-1"]);
});

test("inbox source is scoped to the current actor, including search haystack", () => {
  const { api } = harness({ records: [cardEvent()] });
  const thread = api.buildThreads()[0];
  assert.equal(thread.items[0].id, "event-1");
  assert.match(api.haystack(thread), /needle detail/);
  assert.doesNotMatch(api.haystack(thread), /secret-other-user/);
  assert.equal(api.matches(thread, "needle detail"), true);
  assert.equal(api.matches(thread, "secret-other-user"), false);
});

test("card detail links resolve through the event's verified source board", () => {
  const { api } = harness({ records: [cardEvent()] });
  const view = api.describe(api.buildThreads()[0]);
  assert.equal(view.board.id, "board-a");
  assert.equal(view.cta.href, "board.html?board=board-a&card=card-1");
});

test("read state loads and saves in an actor-specific session key", () => {
  const key = "flowboard-inbox-read-alice";
  const { api, storage } = harness({ actor: "alice", persisted: { [key]: JSON.stringify({ "event-1": true }) } });
  api.loadReadState();
  assert.equal(api.state.read["event-1"], true);
  api.state.read["event-2"] = true;
  api.saveReadState();
  assert.deepEqual(JSON.parse(storage.get(key)), { "event-1": true, "event-2": true });
  const bob = harness({ actor: "bob", persisted: { [key]: JSON.stringify({ "event-1": true }) } });
  bob.api.loadReadState();
  assert.equal(Object.keys(bob.api.state.read).length, 0);
});
