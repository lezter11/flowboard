"use strict";

// Focused tests for the trash preview controller. The VM exposes closure
// helpers only in memory, so product data and browser storage stay untouched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../screens/trash.js");
const source = fs.readFileSync(sourcePath, "utf8").replace(
  "  window.FBPage={",
  "  window.__trashTest = { items, status, timeLeft, render, state };\n  window.FBPage={"
);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const fixedDate = class extends Date {
  static now() { return NOW; }
};

function fixture() {
  return {
    projects: [
      { id: "p1", name: "Alpha Project", ownerId: "alice" },
      { id: "p2", name: "Beta Project", ownerId: "bob" }
    ],
    boards: [
      { id: "b1", projectId: "p1", name: "Alpha Board" },
      { id: "b2", projectId: "p2", name: "Beta Board" },
      { id: "b-wrong", projectId: "p2", name: "Board in another project" }
    ],
    trash: [
      { id: "valid-alpha", title: "Alpha needle", key: "AL-1", projectId: "p1", boardId: "b1", deletedBy: "alice", deletedAt: new Date(NOW - 2 * HOUR).toISOString() },
      { id: "valid-beta", title: "Beta search", key: "BE-1", projectId: "p2", boardId: "b2", deletedBy: "bob", deletedAt: new Date(NOW - 3 * HOUR).toISOString() },
      { id: "mismatched-board", title: "Invalid provenance", key: "X-1", projectId: "p1", boardId: "b-wrong", deletedBy: "alice", deletedAt: new Date(NOW - HOUR).toISOString() },
      { id: "missing-project", title: "Missing project", key: "X-2", projectId: "missing", boardId: "b1", deletedBy: "alice", deletedAt: new Date(NOW - HOUR).toISOString() },
      { id: "missing-board", title: "Missing board", key: "X-3", projectId: "p1", boardId: "unknown", deletedBy: "alice", deletedAt: new Date(NOW - HOUR).toISOString() }
    ]
  };
}

function harness({ search = "", role = "owner", userId = "alice", trash = null } = {}) {
  const data = trash || fixture();
  const elements = new Map();
  const makeElement = () => ({
    innerHTML: "", textContent: "", value: "", hidden: false, dataset: {},
    classList: { toggle() {} }, addEventListener() {},
    querySelector() { return null; }
  });
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, makeElement());
    return elements.get(selector);
  };
  const person = (id) => ({ alice: { id: "alice", name: "Alice" }, bob: { id: "bob", name: "Bob" } })[id] || null;
  const project = (id) => data.projects.find((p) => p.id === id) || null;
  const board = (id) => data.boards.find((b) => b.id === id) || null;
  const window = {
    SD: {
      trash: data.trash,
      project: (id) => project(id),
      member: (id, projectId) => id === "charlie" && projectId === "p1" ? { role: "Manager" }
        : id === "charlie" && projectId === "p2" ? { role: "Member" } : null
    }, FB: { person },
    Portfolio: { projects: () => data.projects, project, board },
    Screens: {
      role,
      currentUser: () => ({ id: userId, name: userId }),
      can: (permission) => permission === "browseTrash" && ["owner", "manager"].includes(role),
      escape: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
      icon: () => "[icon]", formatDateTime: (value) => String(value),
      accessDenied: () => "denied", screenHref: (name) => `${name}.html`
    },
    setInterval() { return 1; }
  };
  window.window = window;
  const document = {
    querySelector: (selector) => element(selector),
    querySelectorAll: () => []
  };
  const context = {
    window, document, URLSearchParams, URL, Date: fixedDate,
    Math, Object, Array, Boolean, String, Number, JSON, CSS: { escape: (s) => s },
    location: { search, href: `https://local.test/trash.html${search}`, pathname: "/trash.html" },
    history: { replaceState() {} }
  };
  vm.runInNewContext(source, context, { filename: sourcePath });
  return { api: window.__trashTest, elements, data, window };
}

test("trash requires browse permission and rejects unknown or cross-project board provenance", () => {
  const { api } = harness();
  assert.deepEqual(Array.from(api.items(), (item) => item.id), []); // project selection is required until render chooses the owner default
  api.state.project = "p1";
  assert.deepEqual(Array.from(api.items(), (item) => item.id), ["valid-alpha"]);
  assert.deepEqual(Array.from(harness({ role: "member" }).api.items(), (item) => item.id), []);
  assert.deepEqual(Array.from(harness({ role: "viewer" }).api.items(), (item) => item.id), []);
});

test("project selection scopes trash rows to that project only", () => {
  const alpha = harness({ search: "?project=p1" });
  assert.equal(alpha.api.state.project, "p1");
  assert.deepEqual(Array.from(alpha.api.items(), (item) => item.id), ["valid-alpha"]);
  const beta = harness({ search: "?project=p2" });
  beta.api.render();
  assert.equal(beta.api.state.project, ""); // p2 is not owned by Alice
  assert.deepEqual(Array.from(beta.api.items(), (item) => item.id), []);
});

test("manager trash eligibility is project-specific and requires the matching project membership", () => {
  const alpha = harness({ role: "manager", userId: "charlie", search: "?project=p1" });
  assert.deepEqual(Array.from(alpha.api.items(), (item) => item.id), ["valid-alpha"]);
  const beta = harness({ role: "manager", userId: "charlie", search: "?project=p2" });
  beta.api.render();
  assert.equal(beta.api.state.project, "");
  assert.deepEqual(Array.from(beta.api.items(), (item) => item.id), []);
});

test("the 24-hour recovery window expires at the exact deadline", () => {
  const { api } = harness();
  const before = { deadline: new Date(NOW + 1).toISOString() };
  const at = { deadline: new Date(NOW).toISOString() };
  assert.equal(api.status(before).key, "soon");
  assert.equal(api.status(before).remaining, 1);
  assert.equal(api.status(at).key, "expired");
  assert.equal(api.status(at).remaining, 0);

  const deletion = new Date(NOW - DAY).toISOString();
  const exactExpiry = { id: "exact", title: "At 24 hours", key: "X-4", projectId: "p1", boardId: "b1", deletedAt: deletion };
  const withExact = harness({ search: "?project=p1", trash: { ...fixture(), trash: [exactExpiry] } });
  assert.equal(withExact.api.items()[0].deadline, new Date(NOW).toISOString());
  assert.equal(withExact.api.status(withExact.api.items()[0]).key, "expired");
});

test("search filters title, key, project and board within the selected project", () => {
  const { api, elements } = harness();
  api.render();
  assert.match(elements.get("#trashList").innerHTML, /valid-alpha/);
  assert.doesNotMatch(elements.get("#trashList").innerHTML, /valid-beta/);
  assert.doesNotMatch(elements.get("#trashList").innerHTML, /Invalid provenance/);
  api.state.q = "alpha board";
  api.render();
  assert.match(elements.get("#trashList").innerHTML, /valid-alpha/);
  assert.doesNotMatch(elements.get("#trashList").innerHTML, /valid-beta/);
  assert.equal(elements.get("#trashCount").textContent, "1 card");
  assert.equal(elements.get("#statTotal").textContent, 1);
});

test("preview rows expose disabled restore controls and rendering does not mutate sample data", () => {
  const { api, elements, data } = harness();
  const before = JSON.stringify(data);
  api.render();
  const markup = elements.get("#trashList").innerHTML;
  assert.match(markup, /class="restore-preview"[^>]*disabled/);
  assert.equal(JSON.stringify(data), before);
});
