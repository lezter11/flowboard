/* Flowboard UI artifact — project people, roles, invitations and role matrix. */
(function () {
  "use strict";

  const SD = window.SD;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const escape = window.Screens.escape;
  const PROJECT_ID = "website-redesign";

  function me() { return window.Screens.currentUser(); }
  function project() { return SD.project(PROJECT_ID); }
  function canManage() { return window.Screens.can("managePeople"); }
  function isOwner() { return window.Screens.role === "owner"; }

  function memberRecord(personId) {
    return SD.members.find((member) => member.personId === personId) || null;
  }

  function roster() {
    const current = project();
    if (!current) return [];
    return current.memberIds
      .map((id) => memberRecord(id))
      .filter(Boolean);
  }

  function pending() {
    return SD.pendingInvites.filter((invite) => invite.projectId === PROJECT_ID);
  }

  function roleOptions() {
    return isOwner() ? ["Manager", "Member", "Viewer"] : ["Member", "Viewer"];
  }

  function roleTone(role) {
    return role === "Owner" ? "info" : role === "Manager" ? "active" : role === "Viewer" ? "" : "plain";
  }

  function renderHeader() {
    const current = project();
    const people = roster();
    $("#peopleSub").innerHTML = `<span>${people.length} project ${people.length === 1 ? "person" : "people"}</span><span class="dot" aria-hidden="true"></span><span>Roles are per project</span><span class="dot" aria-hidden="true"></span><span>${canManage() ? "Administration available" : "Read-only roster"}</span>`;
    $("#peopleRoleBadge").textContent = `${window.Screens.roleLabel()} preview`;
    const fixture = memberRecord(me().id);
    const mismatch = fixture && fixture.role.toLowerCase() !== window.Screens.role;
    const previewNote = $("#peoplePreviewNote");
    previewNote.hidden = !mismatch;
    if (mismatch) {
      $("#peoplePreviewNoteText").innerHTML = `<strong>Preview fixture mismatch.</strong> The fixed ${escape(window.Screens.roleLabel())} preview uses ${escape(me().name)}, whose local roster grant is now ${escape(fixture.role)}. Roster edits do not change preview identities; reload this page to restore the synthetic roster.`;
    }
    $("#peopleScopeBar").className = `review-bar${canManage() ? "" : " note"}`;
    $("#peopleScopeCopy").innerHTML = isOwner()
      ? "<strong>Owner preview.</strong> You can invite people, grant or remove Manager, and change any non-owner role. Ownership transfer is later scope."
      : window.Screens.role === "manager"
        ? "<strong>Manager preview.</strong> You can invite Member/Viewer and change Member/Viewer grants. Manager grants stay Owner-only, and you cannot edit a peer Manager."
        : "<strong>Read-only roster.</strong> You can see who is on this project, but you cannot invite people, change roles or remove grants.";
    $("#teamCount").textContent = `${people.length} ${people.length === 1 ? "person" : "people"}`;
    $("#teamSub").textContent = canManage()
      ? "Roles are per project. Changes take effect on the next authorized request."
      : "Roles are per project. Your role can read this roster but cannot change it.";
    $("#matrixRoleBadge").textContent = window.Screens.roleLabel();
    $("#peopleActions").innerHTML = [
      canManage() ? `<button class="btn primary" type="button" id="inviteBtn">${window.Screens.icon("user-plus")}Invite people</button>` : "",
      `<a class="btn" href="${window.Screens.screenHref("project", { project: PROJECT_ID })}">${window.Screens.icon("folder")}Project overview</a>`
    ].join("");
    const invite = $("#inviteBtn");
    if (invite) invite.addEventListener("click", openInvite);
  }

  function roleControl(member) {
    const person = window.FB.person(member.personId);
    const isYou = member.personId === me().id;
    if (member.role === "Owner") {
      return `<span class="status-chip info plain">Owner</span><span class="tiny faint nowrap">Workspace owner</span>`;
    }
    if (!canManage() || isYou) {
      return `<span class="status-chip ${roleTone(member.role)} plain">${escape(member.role)}</span>${isYou ? '<span class="badge accent">You</span>' : ""}`;
    }
    if (!isOwner() && member.role === "Manager") {
      return `<span class="status-chip active plain">Manager</span><span class="tiny faint nowrap" title="Only the Owner can change a Manager grant">${window.Screens.icon("lock")} Owner only</span>`;
    }
    const options = roleOptions().map((role) => `<option value="${role}"${role === member.role ? " selected" : ""}>${role}</option>`).join("");
    return `<label class="sr-only" for="role-${member.personId}">Role for ${escape(person ? person.name : member.personId)}</label>
      <select class="role-select" id="role-${member.personId}" data-role-person="${member.personId}">${options}</select>`;
  }

  function removeButton(member) {
    if (!canManage()) return "";
    if (member.role === "Owner" || member.personId === me().id) return "";
    if (!isOwner() && member.role === "Manager") return "";
    return `<button class="icon-btn" type="button" data-remove-member="${member.personId}" aria-label="Remove ${escape(window.Screens.personName(member.personId))}" title="Remove from project">
      ${window.Screens.icon("x")}
    </button>`;
  }

  function renderTeam() {
    const list = roster();
    $("#teamList").innerHTML = list.map((member) => {
      const person = window.FB.person(member.personId);
      if (!person) return "";
      const isYou = member.personId === me().id;
      return `<div class="person-row${isYou ? " is-you" : ""}" data-person-id="${member.personId}">
        ${window.Screens.avatar(member.personId, "lg")}
        <div class="person-copy">
          <strong>${escape(person.name)}${isYou ? ' <span class="badge accent">You</span>' : ""}</strong>
          <span>${escape(member.email)} · ${member.role === "Owner" ? "full workspace access" : `joined ${escape(window.Screens.formatDate(member.joinedAt))}`}</span>
        </div>
        <div class="person-actions">
          ${roleControl(member)}
          ${removeButton(member)}
        </div>
        <span class="tiny faint nowrap" style="min-width:74px;text-align:right;">${member.role === "Owner" ? "Always active" : `Active ${escape(window.Screens.relativeTime(member.lastActive))}`}</span>
      </div>`;
    }).join("");
  }

  function renderPending() {
    const panel = $("#pendingPanel");
    if (!canManage()) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const list = pending();
    $("#pendingCount").textContent = `${list.length} pending`;
    $("#pendingList").innerHTML = list.length
      ? list.map((invite) => {
        const initials = invite.name.split(/\s+/).map((word) => word[0]).slice(0, 2).join("").toUpperCase();
        return `<div class="pending-row" data-invite-id="${invite.id}">
          <span class="pending-avatar" aria-hidden="true">${escape(initials)}</span>
          <div class="person-copy">
            <strong>${escape(invite.name)} <span class="status-chip pending plain">Pending</span></strong>
            <span>${escape(invite.email)} · invited ${escape(window.Screens.relativeTime(invite.invitedAt))} by ${escape(window.Screens.personName(invite.invitedBy))}</span>
          </div>
          <div class="person-actions">
            <span class="status-chip ${invite.role === "Viewer" ? "" : "active"} plain">${escape(invite.role)}</span>
            <button class="btn sm" type="button" data-resend-invite="${invite.id}">Resend</button>
            <button class="btn sm ghost" type="button" data-revoke-invite="${invite.id}">Revoke</button>
          </div>
        </div>`;
      }).join("")
      : `<div class="empty-state" style="padding:22px 12px;">
          ${window.Screens.icon("mail")}
          <strong>No pending invitations</strong>
          <span>Invite a Member or Viewer. Only accepted invitations appear in the project roster.</span>
          <button class="btn sm" type="button" data-open-invite>Invite someone</button>
        </div>`;
    $$("[data-open-invite]", $("#pendingList")).forEach((button) => button.addEventListener("click", openInvite));
  }

  function renderSummary() {
    const list = roster();
    const counts = {
      Owner: list.filter((member) => member.role === "Owner").length,
      Manager: list.filter((member) => member.role === "Manager").length,
      Member: list.filter((member) => member.role === "Member").length,
      Viewer: list.filter((member) => member.role === "Viewer").length
    };
    $("#statMembers").textContent = list.length;
    $("#statManagers").textContent = counts.Manager;
    $("#statMembersOnly").textContent = counts.Member;
    $("#statViewers").textContent = counts.Viewer;
    $("#statPending").textContent = canManage() ? pending().length : "—";
    $("#roleHint").textContent = `${list.length} people`;
    const segments = [
      { key: "Owner", count: counts.Owner, color: "var(--ink-soft)" },
      { key: "Manager", count: counts.Manager, color: "var(--dot-progress)" },
      { key: "Member", count: counts.Member, color: "var(--dot-testing)" },
      { key: "Viewer", count: counts.Viewer, color: "var(--faint)" }
    ].filter((segment) => segment.count > 0);
    $("#roleBar").innerHTML = segments.length
      ? segments.map((segment) => `<span style="flex:${segment.count};background:${segment.color}" title="${segment.key}: ${segment.count}"></span>`).join("")
      : '<span style="flex:1;background:var(--surface-3)"></span>';
    $("#roleLegend").innerHTML = segments.map((segment) => `<span><i style="background:${segment.color}"></i>${segment.key} ${segment.count}</span>`).join("") || "<span>No project people</span>";
  }

  const MATRIX_ROWS = [
    ["Read project, boards and cards", true, true, true, true],
    ["Create, edit, assign and move cards", true, true, true, false],
    ["Comment and upload private images", true, true, true, false],
    ["Delete card and restore before 24h", true, true, false, false],
    ["Invite Member or Viewer", true, true, false, false],
    ["Grant or remove Manager", true, false, false, false],
    ["Configure boards and columns", true, true, false, false],
    ["Create, archive or reopen project", true, false, false, false],
    ["Upload and confirm Excel imports", true, true, false, false],
    ["See project access events", true, true, false, false]
  ];

  function renderMatrix() {
    const current = window.Screens.roleLabel();
    const head = ["Action", "Owner", "Manager", "Member", "Viewer"].map((label) => {
      const isCurrent = label === current;
      return `<th${isCurrent ? ' class="is-current"' : ""}>${label}${isCurrent ? " · you" : ""}</th>`;
    }).join("");
    const body = MATRIX_ROWS.map((row) => {
      const action = row[0];
      const cells = row.slice(1).map((allowed, index) => {
        const label = ["Owner", "Manager", "Member", "Viewer"][index];
        const isCurrent = label === current;
        return `<td${isCurrent ? ' class="is-current"' : ""}>${allowed
          ? `<span class="yes" title="Allowed">${window.Screens.icon("check")}<span class="sr-only">Allowed</span></span>`
          : `<span class="no" title="Not allowed">${window.Screens.icon("x")}<span class="sr-only">Not allowed</span></span>`}</td>`;
      }).join("");
      return `<tr><td>${escape(action)}</td>${cells}</tr>`;
    }).join("");
    $("#roleMatrix").innerHTML = `<table class="role-matrix"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function render() {
    renderHeader();
    renderSummary();
    renderTeam();
    renderPending();
    renderMatrix();
    bindTeam();
    bindPending();
  }

  function bindTeam() {
    $$("[data-role-person]", $("#teamList")).forEach((select) => {
      select.addEventListener("change", async (event) => {
        const personId = select.dataset.rolePerson;
        const member = memberRecord(personId);
        if (!member) return;
        const previous = member.role;
        const next = select.value;
        if (next === previous) return;
        const person = window.FB.person(personId);
        const accepted = await window.Screens.confirm({
          title: next === "Manager" ? `Grant Manager to ${person ? person.name : personId}?` : `Change role to ${next}?`,
          copy: next === "Manager"
            ? "Managers can configure this project, invite Member/Viewer and delete or restore cards. They cannot grant Manager or edit a peer Manager. This is a local prototype change."
            : `The ${next.toLowerCase()} grant for ${person ? person.name : personId} takes effect on the next authorized request. Existing cards, comments and images stay with the project.`,
          confirmLabel: next === "Manager" ? "Grant Manager" : "Change role",
          tone: next === "Manager" ? "primary" : "primary",
          icon: "shield"
        });
        if (!accepted) {
          select.value = previous;
          return;
        }
        member.role = next;
        render();
        window.Screens.toast(`${person ? person.name : personId} is now ${next}. Prototype state only.`, { tone: "success", icon: "users" });
      });
    });
    $$("[data-remove-member]", $("#teamList")).forEach((button) => {
      button.addEventListener("click", () => removeMember(button.dataset.removeMember));
    });
  }

  function bindPending() {
    $$("[data-resend-invite]", $("#pendingList")).forEach((button) => {
      button.addEventListener("click", () => {
        const invite = pending().find((entry) => entry.id === button.dataset.resendInvite);
        if (!invite) return;
        invite.invitedAt = new Date().toISOString();
        render();
        window.Screens.toast(`Invitation to ${invite.email} marked for resend. No email was sent.`, { icon: "mail" });
      });
    });
    $$("[data-revoke-invite]", $("#pendingList")).forEach((button) => {
      button.addEventListener("click", () => revokeInvite(button.dataset.revokeInvite));
    });
  }

  async function removeMember(personId) {
    const member = memberRecord(personId);
    if (!member || !canManage()) return;
    if (member.role === "Owner" || personId === me().id) return;
    if (!isOwner() && member.role === "Manager") return;
    const person = window.FB.person(personId);
    const accepted = await window.Screens.confirm({
      title: `Remove ${person ? person.name : personId} from Website Redesign?`,
      copy: "Their project grant is removed on the next authorized request. Cards, comments and images they created stay in the project. This does not delete their account.",
      confirmLabel: "Remove from project",
      tone: "danger",
      icon: "x-circle"
    });
    if (!accepted) return;
    const current = project();
    current.memberIds = current.memberIds.filter((id) => id !== personId);
    render();
    window.Screens.toast(`${person ? person.name : personId} removed from Website Redesign.`, { icon: "user-check" });
  }

  async function revokeInvite(id) {
    const invite = pending().find((entry) => entry.id === id);
    if (!invite) return;
    const accepted = await window.Screens.confirm({
      title: `Revoke the invitation to ${invite.email}?`,
      copy: "The pending grant is removed. If the person already accepted elsewhere, that account is unchanged. This prototype sends no email.",
      confirmLabel: "Revoke invitation",
      tone: "danger",
      icon: "mail"
    });
    if (!accepted) return;
    SD.pendingInvites.splice(SD.pendingInvites.indexOf(invite), 1);
    render();
    window.Screens.toast(`Invitation to ${invite.email} revoked.`, { icon: "x-circle" });
  }

  function openInvite() {
    if (!canManage()) return;
    $("#inviteForm").reset();
    $("#inviteRole").value = "Member";
    $("#inviteEmailError").hidden = true;
    $("#inviteEmail").classList.remove("is-invalid");
    window.Screens.openDialog("inviteLayer");
  }

  function submitInvite(event) {
    event.preventDefault();
    if (!canManage()) return;
    const emailField = $("#inviteEmail");
    const email = emailField.value.trim().toLowerCase();
    const role = $("#inviteRole").value;
    const error = $("#inviteEmailError");
    error.hidden = true;
    emailField.classList.remove("is-invalid");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      error.textContent = "Enter a valid email address.";
      error.hidden = false;
      emailField.classList.add("is-invalid");
      emailField.focus();
      return;
    }
    if (SD.members.some((member) => member.email.toLowerCase() === email)) {
      error.textContent = "This person is already on the project.";
      error.hidden = false;
      emailField.classList.add("is-invalid");
      emailField.focus();
      return;
    }
    if (pending().some((invite) => invite.email.toLowerCase() === email)) {
      error.textContent = "An invitation is already pending for this email.";
      error.hidden = false;
      emailField.classList.add("is-invalid");
      emailField.focus();
      return;
    }

    const local = email.split("@")[0].replace(/[._-]+/g, " ").trim();
    const name = local.split(/\s+/).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") || email;
    SD.pendingInvites.push({
      id: `inv_${Date.now()}`,
      name,
      email,
      role,
      invitedBy: me().id,
      invitedAt: new Date().toISOString(),
      projectId: PROJECT_ID,
      status: "pending"
    });
    window.Screens.closeDialog("inviteLayer");
    render();
    window.Screens.toast(`Invitation recorded for ${email} as ${role}. No email was sent.`, { tone: "success", icon: "mail" });
  }

  window.FBPage = {
    init() {
      $("#inviteForm").addEventListener("submit", submitInvite);
      $$("[data-close-dialog]").forEach((button) => {
        button.addEventListener("click", () => window.Screens.closeDialog(button.dataset.closeDialog));
      });
      render();
      if (new URLSearchParams(window.location.search).get("invite") === "1" && canManage()) {
        setTimeout(openInvite, 60);
      }
    },
    render() {
      render();
    },
    beforeRoleChange() {
      window.Screens.closeDialog("inviteLayer");
      return true;
    }
  };
})();
