/* Board shell only: collapsible navigation and progressive fullscreen. */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const { state } = FB;
    const rail = document.querySelector("#rail");
    const workspace = document.querySelector(".workspace");
    const menu = document.querySelector("#menuBtn");
    const close = document.querySelector("#navCloseBtn");
    const scrim = document.querySelector("#railScrim");
    const fullscreen = document.querySelector("#fullscreenBtn");
    const status = document.querySelector("#workspaceModeStatus");
    const root = document.documentElement;
    state.navCollapsed = true;
    state.navOpen = false;
    state.workspaceFullscreen = false;
    let nativeSession = false;
    let pending = false;
    const overlayNavigation = () => window.matchMedia("(max-width: 980px)").matches || state.workspaceFullscreen;
    let previousOverlay = overlayNavigation();

    function renderNavigation() {
      FB.hideBoardTooltip?.();
      const overlay = overlayNavigation();
      const visible = overlay ? state.navOpen : !state.navCollapsed;
      const hadFocus = rail.contains(document.activeElement);
      document.body.classList.toggle("nav-collapsed", state.navCollapsed);
      document.body.classList.toggle("nav-drawer-open", overlay && state.navOpen);
      rail.classList.toggle("is-open", overlay && state.navOpen);
      rail.inert = !visible;
      rail.setAttribute("aria-hidden", String(!visible));
      workspace.inert = overlay && state.navOpen;
      close.hidden = !overlay;
      scrim.hidden = !(overlay && state.navOpen);
      menu.setAttribute("aria-expanded", String(visible));
      const label = visible ? "Hide navigation" : "Show navigation";
      menu.setAttribute("aria-label", label);
      menu.title = label;
      if (overlay && state.navOpen) {
        rail.setAttribute("role", "dialog");
        rail.setAttribute("aria-modal", "true");
      } else {
        rail.removeAttribute("role");
        rail.removeAttribute("aria-modal");
      }
      if (!visible && hadFocus) menu.focus({ preventScroll: true });
      previousOverlay = overlay;
    }

    function closeNavigation(returnFocus = true) {
      state.navOpen = false;
      renderNavigation();
      if (returnFocus) menu.focus({ preventScroll: true });
    }
    FB.closeNavigation = closeNavigation;

    menu.addEventListener("click", () => {
      if (overlayNavigation()) {
        state.navOpen = !state.navOpen;
        renderNavigation();
        if (state.navOpen) close.focus({ preventScroll: true });
      } else {
        state.navCollapsed = !state.navCollapsed;
        renderNavigation();
      }
    });
    close.addEventListener("click", () => closeNavigation());
    scrim.addEventListener("click", () => closeNavigation());
    rail.addEventListener("keydown", (event) => {
      if (!overlayNavigation() || !state.navOpen) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); closeNavigation(); return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(rail.querySelectorAll("a[href], button")).filter((el) => !el.disabled && !el.hidden && !el.closest("[hidden]"));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });

    function updateFullscreenButton() {
      const active = state.workspaceFullscreen;
      const label = active ? (document.fullscreenElement === root ? "Exit fullscreen" : "Exit expanded view") : "Enter fullscreen";
      fullscreen.setAttribute("aria-pressed", String(active));
      fullscreen.setAttribute("aria-label", label);
      fullscreen.title = label;
    }
    function setFullscreenLayout(active) {
      state.workspaceFullscreen = active;
      document.body.classList.toggle("board-fullscreen", active);
      closeNavigation(false);
      updateFullscreenButton();
      status.textContent = active ? "Board expanded" : "Board window restored";
    }
    function anotherLayerIsOpen() {
      return Boolean(state.activeCardId) || Array.from(document.querySelectorAll(".dialog-layer")).some((layer) => !layer.hidden);
    }
    fullscreen.addEventListener("click", async () => {
      if (pending) return;
      pending = true; fullscreen.disabled = true;
      try {
        if (state.workspaceFullscreen) {
          if (document.fullscreenElement === root && typeof document.exitFullscreen === "function") {
            try {
              await document.exitFullscreen();
              if (!document.fullscreenElement) { nativeSession = false; setFullscreenLayout(false); }
            } catch (error) { status.textContent = "Use Escape to leave browser fullscreen."; }
          } else setFullscreenLayout(false);
        } else {
          setFullscreenLayout(true);
          if (typeof root.requestFullscreen === "function" && typeof document.exitFullscreen === "function") {
            try {
              await root.requestFullscreen();
              nativeSession = document.fullscreenElement === root;
              updateFullscreenButton();
            } catch (error) { status.textContent = "Board expanded to the window. Browser fullscreen is unavailable."; }
          } else status.textContent = "Board expanded to the window.";
        }
      } finally { pending = false; fullscreen.disabled = false; }
    });
    document.addEventListener("fullscreenchange", () => {
      if (document.fullscreenElement === root) {
        nativeSession = true; setFullscreenLayout(true);
      } else if (nativeSession) {
        nativeSession = false; setFullscreenLayout(false);
        if (!anotherLayerIsOpen()) fullscreen.focus({ preventScroll: true });
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.defaultPrevented && !pending && state.workspaceFullscreen && !document.fullscreenElement && !state.navOpen && !anotherLayerIsOpen()) {
        setFullscreenLayout(false); fullscreen.focus({ preventScroll: true });
      }
    });
    window.addEventListener("resize", () => {
      if (overlayNavigation() !== previousOverlay) state.navOpen = false;
      renderNavigation();
    });
    renderNavigation();
    updateFullscreenButton();
  });
})();
