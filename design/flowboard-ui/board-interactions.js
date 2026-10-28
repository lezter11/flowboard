/* Shared hover and keyboard-focus details; content never creates markup. */
(function () {
  "use strict";
  const tip = document.querySelector("#boardHoverTip");
  if (!tip) return;
  let owner = null;
  let hideTimer;
  let dismissed = null;
  const triggerFor = (node) => node instanceof Element ? node.closest("[data-tooltip], [title]") : null;

  function hide() {
    clearTimeout(hideTimer);
    if (owner) {
      const ids = (owner.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== tip.id);
      if (ids.length) owner.setAttribute("aria-describedby", ids.join(" "));
      else owner.removeAttribute("aria-describedby");
    }
    owner = null;
    tip.hidden = true;
  }
  function show(trigger) {
    if (!trigger?.isConnected || trigger === dismissed || trigger.closest("[inert], [hidden]")) return;
    const content = trigger.getAttribute("title") || trigger.dataset.tooltip;
    if (!content) return;
    hide();
    owner = trigger;
    trigger.dataset.tooltip = content;
    trigger.removeAttribute("title");
    tip.textContent = content;
    const ids = new Set((trigger.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
    ids.add(tip.id);
    trigger.setAttribute("aria-describedby", [...ids].join(" "));
    tip.hidden = false;
    const anchor = trigger.getBoundingClientRect();
    const rect = tip.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - rect.width / 2, window.innerWidth - rect.width - 8));
    const top = anchor.bottom + rect.height + 8 <= window.innerHeight
      ? anchor.bottom + 6 : Math.max(8, anchor.top - rect.height - 6);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  function enter(event) {
    if (event.pointerType === "touch" || event.sourceCapabilities?.firesTouchEvents) return;
    if (tip.contains(event.target)) { clearTimeout(hideTimer); return; }
    const trigger = triggerFor(event.target);
    if (!trigger || trigger.contains(event.relatedTarget)) return;
    clearTimeout(hideTimer);
    if (trigger === owner && !tip.hidden) return;
    if (trigger === dismissed) return;
    dismissed = null;
    // Capture hover immediately; no click, focus or delayed timer is required.
    show(trigger);
  }
  function leave(event) {
    const trigger = triggerFor(event.target);
    if (trigger?.contains(event.relatedTarget) || tip.contains(event.relatedTarget)) return;
    if (trigger === dismissed) dismissed = null;
    if (trigger !== owner && !tip.contains(event.target)) return;
    if (owner?.contains(event.relatedTarget)) return;
    hideTimer = setTimeout(() => {
      if (owner?.contains(document.activeElement)) return;
      hide();
    }, 160);
  }
  // Mouse fallback also covers browsers that don't dispatch Pointer Events.
  document.addEventListener("pointerover", enter, true);
  document.addEventListener("pointerout", leave, true);
  document.addEventListener("mouseover", enter, true);
  document.addEventListener("mouseout", leave, true);
  document.addEventListener("focusin", (event) => {
    dismissed = null;
    const trigger = triggerFor(event.target);
    if (trigger) show(trigger);
    else hide();
  });
  document.addEventListener("focusout", (event) => {
    if (!owner?.contains(event.relatedTarget)) hide();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { const previous = owner; hide(); dismissed = previous; }
  });
  document.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  FB.hideBoardTooltip = hide;
})();
