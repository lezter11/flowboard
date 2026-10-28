"use strict";

// Exercise the People preview controller in an isolated VM. Synthetic project
// memberships keep the roster boundary explicit and mutation APIs fail fast.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../screens/people.js");
const source = fs.readFileSync(sourcePath, "utf8");

function fixture() {
  const projects = [
    { id: "p1", name: "Alpha Project", ownerId: "alice", memberIds: ["alice", "bob", "cara"] },
    { id: "p2", name: "Beta Project", ownerId: "dave", memberIds: ["dave", "erin"] }
  ];
  const people = {
    alice: { id: "alice", name: "Alice Owner", role: "Member" },
    bob: { id: "bob", name: "Bob Manager", role: "Member" },
    cara: { id: "cara", name: "Cara Viewer", role: "Viewer" },
    dave: { id: "dave", name: "Dave Owner", role: "Owner" },
    erin: { id: "erin", name: "Erin Member", role: "Member" },
    stray: { id: "stray", name: "Secret Outside Person", role: "Manager" }
  };
  return { projects, people, members: [
    { personId: "bob", role: "Manager" },
    { personId: "cara", role: "Viewer" },
    { personId: "erin", role: "Member" },
    { personId: "stray", role: "Manager" }
  ] };
}

function harness({ role = "owner", projectId = "p1", valid = true, theme = "dark" } = {}) {
  const data = fixture(), elements = new Map(), navigation = [], writes = [];
  const makeElement = () => ({
    innerHTML: "", textContent: "", value: "", hidden: false,
    listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; },
    replaceChildren() { this.innerHTML = ""; this.textContent = ""; }
  });
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, makeElement());
    return elements.get(selector);
  };
  const window = {
    Screens: {
      role,
      projectContext: { valid, projectId },
      currentUser: () => ({ id: role === "owner" ? "alice" : "bob" }),
      screenHref: (name) => `${name}.html${window.Screens.role === "owner" ? "" : `?role=${window.Screens.role}`}`,
      escape: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
      icon: (name) => `[${name}]`, avatar: (id) => `[avatar:${id}]`,
      openDialog: () => {}, closeDialog: () => {}, toast: () => {}
    },
    Portfolio: {
      project: (id) => data.projects.find((project) => project.id === id) || null,
      projects: () => data.projects,
      createProject: () => writes.push("createProject"), updateProject: () => writes.push("updateProject"),
      addMember: () => writes.push("addMember"), removeMember: () => writes.push("removeMember"),
      candidateMembers: () => Object.values(data.people), availableMembers: () => data.projects[0].memberIds.map(id => data.people[id]),
      boards: () => [{id:"b1",name:"Web"},{id:"b2",name:"Marketing"}], boardMembers: () => ["alice","bob"],
      setProjectMembers: (id, ids) => { writes.push({kind:"project",id,ids}); return true; },
      setBoardMembers: (id, ids) => { writes.push({kind:"board",id,ids}); return true; }
    },
    SD: {
      members: data.members,
      project: (id) => data.projects.find((project) => project.id === id) || null,
      member: (userId, projectId) => data.members.find((member) => member.personId === userId && projectId === "p1") || null
    },
    FB: { person: (id) => data.people[id] || null }
  };
  const document = { querySelector: element, documentElement: { dataset: { theme } } };
  const context = { window, document, URLSearchParams, Object, Array, String, Boolean, location: { set href(value) { navigation.push(value); } } };
  vm.runInNewContext(source, context, { filename: sourcePath });
  window.FBPage.init();
  return { window, elements, navigation, writes, data };
}

test("roster is limited to the selected project and assigns the project owner role", () => {
  const { elements } = harness();
  const html = elements.get("#teamList").innerHTML;
  assert.match(html, /Alice Owner/);
  assert.match(html, /Bob Manager/);
  assert.match(html, /Cara Viewer/);
  assert.doesNotMatch(html, /Erin Member|Secret Outside Person/);
  assert.match(html, /role-owner/);
  assert.equal(elements.get("#teamCount").textContent, "3 people");
  assert.equal(elements.get("#peopleSub").textContent, "Alpha Project");
  assert.equal(elements.get("#managerLabel").textContent, "manager");
  assert.equal(elements.get("#memberLabel").textContent, "members");
  assert.equal(elements.get("#viewerLabel").textContent, "viewer");
  assert.match(elements.get("#peopleProject").innerHTML, /Alpha Project/);
  assert.doesNotMatch(elements.get("#peopleProject").innerHTML, /Beta Project/);
});

test("name search and role selection compose and clear back to the full project roster", () => {
  const { elements } = harness();
  const search = elements.get("#peopleSearch"), role = elements.get("#peopleRole");
  search.value = "bo"; search.listeners.input({ target: search });
  assert.match(elements.get("#teamList").innerHTML, /Bob Manager/);
  assert.doesNotMatch(elements.get("#teamList").innerHTML, /Alice Owner|Cara Viewer/);
  role.value = "Manager"; role.listeners.change({ target: role });
  assert.match(elements.get("#teamList").innerHTML, /Bob Manager/);
  assert.equal(elements.get("#peopleResultCount").textContent, "1 matching person");
  assert.equal(elements.get("#clearPeopleFilters").hidden, false);
  elements.get("#clearPeopleFilters").listeners.click();
  assert.equal(search.value, "");
  assert.equal(role.value, "");
  assert.equal(elements.get("#teamCount").textContent, "3 people");
});

test("manager project, role and dark-theme links preserve the intended navigation context", () => {
  const { elements, navigation } = harness({ role: "manager" });
  const actions = elements.get("#peopleActions").innerHTML;
  assert.match(actions, /href="project\.html\?project=p1&amp;role=manager&amp;theme=dark"/);
  assert.match(elements.get("#crumbs a").href, /project\.html\?project=p1&role=manager&theme=dark/);
  const select = elements.get("#peopleProject");
  select.value = "p2";
  select.listeners.change({ target: select });
  assert.deepEqual(navigation, []); // the manager has no membership in Beta Project
});

test("only owners and project managers can open their manageable projects", () => {
  const manager = harness({ role: "manager", projectId: "p1" });
  assert.equal(manager.elements.get("#peopleUnavailable").hidden, true);
  assert.match(manager.elements.get("#teamList").innerHTML, /Bob Manager/);
  assert.doesNotMatch(manager.elements.get("#peopleProject").innerHTML, /Beta Project/);

  for (const role of ["member", "viewer"]) {
    const denied = harness({ role, projectId: "p1" });
    assert.equal(denied.elements.get("#peopleContent").hidden, true, `${role} should not open People`);
    assert.equal(denied.elements.get("#peopleUnavailable").hidden, false);
    assert.equal(denied.elements.get("#teamList").innerHTML, "");
    assert.equal(denied.elements.get("#peopleProject").innerHTML, "");
  }
});

test("owner management actions stay on the People page", () => {
  const { elements } = harness({ role: "owner" });
  assert.match(elements.get("#peopleActions").innerHTML, /data-manage="members"/);
  assert.match(elements.get("#peopleActions").innerHTML, /data-manage="boards"/);
  assert.match(elements.get("#peopleActions").innerHTML, /Manage members/);
});

test("invalid or revoked project context clears stale data and preserves role on fallback links", () => {
  const { elements, window } = harness({ role: "manager", projectId: "p-missing", valid: false });
  assert.equal(elements.get("#peopleContent").hidden, true);
  assert.equal(elements.get("#peopleUnavailable").hidden, false);
  assert.equal(elements.get("#peopleSub").textContent, "");
  assert.equal(elements.get("#peopleActions").innerHTML, "");
  assert.equal(elements.get("#teamList").innerHTML, "");
  assert.equal(elements.get("#peopleProject").innerHTML, "");
  assert.deepEqual(["#statMembers", "#statManagers", "#statMembersOnly", "#statViewers"].map(id => elements.get(id).textContent), ["0", "0", "0", "0"]);
  assert.equal(elements.get("#teamCount").textContent, "");
  assert.equal(elements.get("#peopleResultCount").textContent, "");
  assert.equal(elements.get("#unavailableProjects").href, "projects.html?role=manager");
  assert.equal(elements.get("#crumbs a").href, "projects.html?role=manager");

  // A role change can invalidate a project after the roster has already rendered.
  const revoked = harness({ role: "owner" });
  assert.notEqual(revoked.elements.get("#teamList").innerHTML, "");
  revoked.window.Screens.role = "member";
  revoked.window.FBPage.render();
  assert.equal(revoked.elements.get("#peopleContent").hidden, true);
  assert.equal(revoked.elements.get("#teamList").innerHTML, "");
  assert.equal(revoked.elements.get("#peopleProject").innerHTML, "");
  assert.deepEqual(["#statMembers", "#statManagers", "#statMembersOnly", "#statViewers"].map(id => revoked.elements.get(id).textContent), ["0", "0", "0", "0"]);
  assert.equal(revoked.elements.get("#unavailableProjects").href, "projects.html?role=member");
});

test("preview roster interactions do not call mutation APIs or change fixture data", () => {
  const { elements, writes, data } = harness();
  const before = JSON.stringify(data);
  const search = elements.get("#peopleSearch");
  search.value = "nobody"; search.listeners.input({ target: search });
  elements.get("#teamList").listeners.click({ target: { closest: () => ({}) } });
  assert.deepEqual(writes, []);
  assert.equal(JSON.stringify(data), before);
});

test("member and board changes are separate drafts saved only on explicit confirmation", () => {
  const { elements, writes } = harness();
  const action = kind => elements.get("#peopleActions").listeners.click({target:{closest:()=>({dataset:{manage:kind}})}});
  action("members");
  elements.get("#peopleManageList").listeners.change({target:{dataset:{person:"cara"},checked:false}});
  assert.equal(writes.length, 0);
  elements.get("#peopleManageSave").listeners.click();
  assert.equal(writes[0].kind,"project");
  assert.equal(writes[0].id,"p1");
  assert.ok(!writes[0].ids.includes("cara"));
  action("boards");
  elements.get("#peopleManageList").listeners.change({target:{dataset:{person:"bob"},checked:false}});
  assert.equal(elements.get("#peopleBoardSelect").disabled,true);
  elements.get("#peopleManageSave").listeners.click();
  assert.equal(writes[1].kind,"board");
  assert.equal(writes[1].id,"b1");
  assert.ok(!writes[1].ids.includes("bob"));
});

test("revoked access prevents saving an open management draft", () => {
  const {elements,window,writes}=harness();
  elements.get("#peopleActions").listeners.click({target:{closest:()=>({dataset:{manage:"members"}})}});
  window.Screens.role="member";
  elements.get("#peopleManageSave").listeners.click();
  assert.equal(writes.length,0);
});
