"use strict";

// Exercise the preview controller in an isolated VM. Synthetic Portfolio data
// makes actor/project/board visibility explicit and records any attempted writes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../screens/my-tasks.js");
const source = fs.readFileSync(sourcePath, "utf8").replace(
  "  window.FBPage = {",
  "  window.__tasksTest = { assigned, bucket, matches, row, state };\n  window.FBPage = {"
);

const cards = [
  { id: "a1", key: "WEB-1", title: "Overdue urgent", projectId: "p1", projectName: "Alpha", boardId: "b1", boardName: "Web", columnName: "Doing", category: "active", priority: "urgent", due: "2026-10-26", assignees: ["alice"] },
  { id: "a2", key: "WEB-2", title: "Today high", projectId: "p1", projectName: "Alpha", boardId: "b1", boardName: "Web", columnName: "Todo", category: "todo", priority: "high", due: "2026-10-27", assignees: ["alice"] },
  { id: "a3", key: "OPS-3", title: "Later medium", projectId: "p1", projectName: "Alpha", boardId: "b2", boardName: "Ops", columnName: "Todo", category: "todo", priority: "medium", due: "2026-11-10", assignees: ["alice"] },
  { id: "a4", key: "MKT-4", title: "No date", projectId: "p2", projectName: "Beta", boardId: "b3", boardName: "Marketing", columnName: "Done", category: "done", priority: "low", due: null, assignees: ["alice"] },
  { id: "b1", key: "WEB-9", title: "Other actor secret", projectId: "p1", projectName: "Alpha", boardId: "b1", boardName: "Web", columnName: "Todo", category: "todo", priority: "high", due: "2026-10-27", assignees: ["bob"] },
  { id: "x1", key: "EXT-1", title: "Inaccessible board secret", projectId: "p1", projectName: "Alpha", boardId: "hidden", boardName: "Hidden", columnName: "Todo", category: "todo", priority: "high", due: "2026-10-27", assignees: ["alice"] }
];

function harness(search = "") {
  const projects = [{ id: "p1", name: "Alpha", status: "active" }, { id: "p2", name: "Beta", status: "active" }, { id: "old", name: "Archived", status: "archived" }];
  const calls = [];
  const window = {
    Screens: { currentUser: () => ({ id: "alice" }), escape: (v) => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"), icon: () => "" },
    FB: { helpers: { daysUntil: (date) => { if (!date) return null; return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse("2026-10-27T00:00:00Z")) / 86400000); }, formatShort: (date) => date } },
    Portfolio: {
      projects: () => projects,
      cards: ({ projectId }) => { calls.push(["cards", projectId]); return cards.filter(c => c.projectId === projectId && c.boardId !== "hidden"); },
      cardHref: (card) => `board.html?board=${card.boardId}&card=${card.id}`,
      createCard: () => { throw new Error("read-only view attempted a write"); }, updateCard: () => { throw new Error("read-only view attempted a write"); }
    }
  };
  const context = { window, URLSearchParams, URL, Date, Object, Array, String, Math, Set, location: { search, href: `https://local.test/my-tasks.html${search}`, pathname: "/my-tasks.html" } };
  vm.runInNewContext(source, context, { filename: sourcePath });
  return { api: window.__tasksTest, calls };
}

test("assigned portfolio includes only the current actor and active accessible projects/boards", () => {
  const { api, calls } = harness();
  assert.deepEqual(Array.from(api.assigned(), c => c.id), ["a1", "a2", "a3", "a4"]);
  assert.deepEqual(calls, [["cards", "p1"], ["cards", "p2"]]);
  assert.equal(api.assigned().some(c => /secret/.test(c.title)), false);
});

test("groups due dates into overdue, today, week, later and no-date buckets", () => {
  const { api } = harness();
  assert.deepEqual(Array.from(cards.slice(0, 4), c => api.bucket(c)), ["overdue", "today", "later", "none"]);
  assert.equal(api.bucket({ due: "2026-11-03" }), "week");
});

test("priority, due and project filters compose", () => {
  const { api } = harness();
  api.state.priority = "high";
  api.state.due = "today";
  assert.equal(api.matches(cards[1]), true);
  assert.equal(api.matches(cards[0]), false);
  api.state.project = "p2";
  assert.equal(api.matches(cards[1]), false);
  assert.equal(api.matches(cards[3]), false); // completed card is outside open-task filtering, too
});

test("task rows link to the source board/card and escape displayed content", () => {
  const { api } = harness();
  const html = api.row({ ...cards[1], title: `<Open>` }, false);
  assert.match(html, /href="board\.html\?board=b1&amp;card=a2"/);
  assert.match(html, /&lt;Open&gt;/);
  assert.match(html, /Open WEB-2 on Web/);
});

test("preview data reads do not call any mutation API", () => {
  const { api } = harness();
  api.assigned().forEach(card => { api.bucket(card); api.matches(card); api.row(card, card.category === "done"); });
  assert.equal(api.assigned().length, 4);
});
