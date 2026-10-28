/* Flowboard UI artifact — invitation preview and acceptance states.
   Design-only. No token is read, stored or sent; no membership is created. */
(function () {
  "use strict";

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const escape = window.Screens.escape;
  const icon = window.Screens.icon;
  const params = new URLSearchParams(window.location.search);

  const PROJECT = window.SD.project("website-redesign");
  const INVITER = window.FB.person("alice");
  const INVITED_EMAIL = "maya.chen@acme.test";
  const SIGNED_IN = { name: "Maya Chen", email: INVITED_EMAIL, initials: "MC", tone: "eve" };
  const OTHER_ACCOUNT = { name: "David Member", email: "david@acme.test", initials: "DM", tone: "david" };
  const EXPIRES_AT = new Date(Date.now() + 6 * 24 * 3600000).toISOString();

  const VALID_STATES = ["valid", "accepted", "expired", "revoked", "mismatch", "already", "invalid"];
  const state = {
    status: VALID_STATES.includes(params.get("state")) ? params.get("state") : "valid",
    signed: params.get("signed") === "1"
  };

  function projectMark() {
    return `<span class="project-mark ${escape(PROJECT.tone)}" aria-hidden="true">${escape(PROJECT.mark)}</span>`;
  }

  function avatarHTML(person) {
    return `<span class="avatar ${escape(person.tone)}" aria-hidden="true">${escape(person.initials)}</span>`;
  }

  function accountRow(person, label) {
    return `<div class="invite-account">
      ${avatarHTML(person)}
      <span>${escape(label)} <strong>${escape(person.name)}</strong> · ${escape(person.email)}</span>
    </div>`;
  }

  function metaGrid() {
    return `<div class="invite-meta">
      <div class="invite-meta-item">
        <div class="label">Invited by</div>
        <div class="value">${escape(INVITER.name)}<small>Owner · Acme Corp</small></div>
      </div>
      <div class="invite-meta-item">
        <div class="label">Invited email</div>
        <div class="value">${escape(INVITED_EMAIL)}<small>Only this account can accept</small></div>
      </div>
      <div class="invite-meta-item">
        <div class="label">Role</div>
        <div class="value">Member<small>Project-scoped grant</small></div>
      </div>
      <div class="invite-meta-item">
        <div class="label">Expires</div>
        <div class="value">${escape(window.Screens.formatDeadline(EXPIRES_AT))}<small>Server clock · 6 days left</small></div>
      </div>
    </div>`;
  }

  function roleNote() {
    return `<div class="invite-role">
      ${icon("shield")}
      <span><strong>What a Member can do</strong>
      <span>Create and edit cards, comment and upload private images. People, trash, imports, project settings and board structure stay with Owners and Managers.</span></span>
    </div>`;
  }

  function privacyNote() {
    return `<div class="invite-privacy">
      ${icon("lock")}
      <span>Before you accept, this page shows only the project name, inviter, role and expiry. Member lists, card content and the project description stay private until the grant exists.</span>
    </div>`;
  }

  function stateNote(tone, title, copy) {
    return `<div class="auth-note ${tone} invite-state-note">${icon(tone === "danger" ? "x-circle" : tone === "warn" ? "clock" : "info")}<span><strong>${escape(title)}</strong> ${escape(copy)}</span></div>`;
  }

  function actionsHTML() {
    if (state.status === "valid" && !state.signed) {
      const next = encodeURIComponent("invitation.html?state=valid&signed=1");
      return `<div class="invite-actions">
        <a class="btn primary" href="signin.html?next=${next}">${icon("key")} Sign in to accept</a>
        <a class="btn" href="index.html">Not now</a>
      </div>`;
    }
    if (state.status === "valid" && state.signed) {
      return `<div class="invite-actions">
        <button class="btn primary" type="button" data-accept>${icon("check-circle")} Accept invitation</button>
        <a class="btn" href="projects.html">Not now</a>
      </div>`;
    }
    if (state.status === "accepted" || state.status === "already") {
      return `<div class="invite-actions">
        <a class="btn primary" href="project.html?project=website-redesign">${icon("folder")} Open Website Redesign</a>
        <a class="btn" href="../index.html">${icon("board")} Open board</a>
      </div>`;
    }
    if (state.status === "mismatch") {
      return `<div class="invite-actions">
        <a class="btn primary" href="signin.html">${icon("key")} Sign in with a different account</a>
        <a class="btn" href="index.html">Not now</a>
      </div>`;
    }
    if (state.status === "expired" || state.status === "revoked" || state.status === "invalid") {
      return `<div class="invite-actions">
        <a class="btn primary" href="signin.html">${icon("arrow-left")} Back to sign in</a>
        <a class="btn" href="index.html">Open the screen library</a>
      </div>`;
    }
    return "";
  }

  function content() {
    switch (state.status) {
      case "accepted":
        return {
          title: "You're in.",
          copy: "You joined Website Redesign as a Member. The invitation link can no longer be used.",
          body: `${stateNote("success", "Invitation accepted", "Access is project-scoped. If the Owner changes your role later, this page will not update your grant.")}
            ${metaGrid()}${actionsHTML()}
            <div class="invite-privacy">${icon("info")}<span>This is a design fixture. No membership row, session or activity record was created.</span></div>`
        };
      case "already":
        return {
          title: "You're already a member.",
          copy: "You already have access to Website Redesign as a Member. There is nothing to accept.",
          body: `${stateNote("info", "Existing grant", "The invitation may still be pending for another email. It cannot add a second role to the same account.")}
            ${metaGrid()}${actionsHTML()}`
        };
      case "expired":
        return {
          title: "This invitation expired.",
          copy: "Invitation links have a fixed server deadline. Ask Alice Owner to send a new invitation if you still need access.",
          body: `${stateNote("warn", "Expired on the server clock", "The browser cannot extend or refresh the deadline. Resending creates a new invitation token.")}
            ${actionsHTML()}${privacyNote()}`
        };
      case "revoked":
        return {
          title: "This invitation was revoked.",
          copy: "An Owner or Manager removed this invitation before it was accepted. A new invitation would create a new grant.",
          body: `${stateNote("danger", "No access was granted", "Revocation is deliberate. The invitation cannot be reactivated with the same link.")}
            ${actionsHTML()}${privacyNote()}`
        };
      case "mismatch":
        return {
          title: "This invitation is for a different account.",
          copy: "It was sent to maya.chen@acme.test, but you are signed in as david@acme.test.",
          body: `${stateNote("warn", "Email mismatch", "The signed-in email must match the invited email. Signing in with the right account will re-check the invitation.")}
            ${metaGrid()}${actionsHTML()}
            ${accountRow(OTHER_ACCOUNT, "Signed in as")}`
        };
      case "invalid":
        return {
          title: "This invitation link is not valid.",
          copy: "The link may be incomplete, already used, or replaced by a newer invitation. Ask an Owner or Manager for a new one.",
          body: `${stateNote("danger", "No invitation preview", "For privacy, an invalid token does not reveal whether a project exists or who was invited.")}
            ${actionsHTML()}`
        };
      case "valid":
      default:
        return {
          title: "Join Website Redesign.",
          copy: "Alice Owner invited you to collaborate on this project. Accepting adds one project-scoped Member grant.",
          body: `${metaGrid()}${roleNote()}${actionsHTML()}
            ${state.signed
              ? accountRow(SIGNED_IN, "Signed in as")
              : `<div class="invite-account">${icon("key")}<span>Not signed in. Sign in with <strong>${escape(INVITED_EMAIL)}</strong> to accept.</span></div>`}
            ${privacyNote()}`
        };
    }
  }

  function cardHTML() {
    const view = content();
    return `<article class="invite-card" data-state="${escape(state.status)}">
      <div class="invite-banner">
        <p class="eyebrow">Project invitation <span class="badge">${state.signed ? "Signed in" : "Signed out"}</span></p>
        <h1>${escape(view.title)}</h1>
        <p>${escape(view.copy)}</p>
        <div class="invite-project">
          ${projectMark()}
          <span class="invite-project-copy">
            <strong>${escape(PROJECT.name)}</strong>
            <span>Acme Corp · 1 board · Project-only access</span>
          </span>
        </div>
      </div>
      <div class="invite-body">${view.body}</div>
    </article>`;
  }

  function syncPreviewButtons() {
    $$("[data-invite-state]").forEach((button) => {
      const active = button.dataset.inviteState === state.status
        && (button.dataset.signed === "1") === state.signed;
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    if (state.status === "valid") url.searchParams.delete("state");
    else url.searchParams.set("state", state.status);
    if (state.signed) url.searchParams.set("signed", "1");
    else url.searchParams.delete("signed");
    history.replaceState(null, "", url.pathname.split("/").pop() + url.search + url.hash);
  }

  function render() {
    const mount = $("#inviteCard");
    if (mount) mount.innerHTML = cardHTML();
    syncPreviewButtons();
  }

  function setState(status, signed) {
    if (!VALID_STATES.includes(status)) return;
    state.status = status;
    state.signed = Boolean(signed);
    updateUrl();
    render();
  }

  function accept(button) {
    if (button.getAttribute("aria-busy") === "true") return;
    button.setAttribute("aria-busy", "true");
    button.disabled = true;
    button.innerHTML = `${icon("refresh")} Accepting…`;
    window.setTimeout(() => {
      setState("accepted", true);
      window.Screens.toast("Invitation accepted in the design preview. No membership was created.", {
        tone: "success",
        icon: "check-circle"
      });
    }, 900);
  }

  function syncThemeButton() {
    const button = $("#inviteTheme");
    if (!button) return;
    const dark = document.documentElement.dataset.theme === "dark";
    button.setAttribute("aria-pressed", String(dark));
    button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  }

  function bind() {
    render();
    syncThemeButton();

    const card = $("#inviteCard");
    if (card) {
      card.addEventListener("click", (event) => {
        const acceptButton = event.target.closest("[data-accept]");
        if (acceptButton) accept(acceptButton);
      });
    }

    const preview = $(".invite-state-grid");
    if (preview) {
      preview.addEventListener("click", (event) => {
        const button = event.target.closest("[data-invite-state]");
        if (!button) return;
        setState(button.dataset.inviteState, button.dataset.signed === "1");
      });
    }

    const theme = $("#inviteTheme");
    if (theme) {
      theme.addEventListener("click", () => {
        const dark = document.documentElement.dataset.theme === "dark";
        window.Screens.setTheme(dark ? "light" : "dark", true);
        syncThemeButton();
      });
    }

    window.Screens.onTheme(syncThemeButton);
  }

  window.FBPage = {
    init() {
      bind();
    },
    render() {
      render();
      syncThemeButton();
    }
  };
})();
