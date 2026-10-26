/* Flowboard UI artifact — screen library hub link routing. */
(function () {
  "use strict";

  function applyLinks() {
    document.querySelectorAll("a[data-screen]").forEach((anchor) => {
      if (anchor.hasAttribute("data-fixed-role")) return;
      const params = {};
      if (anchor.dataset.params) {
        new URLSearchParams(anchor.dataset.params).forEach((value, key) => { params[key] = value; });
      }
      anchor.href = window.Screens.screenHref(anchor.dataset.screen, params);
    });
  }

  window.FBPage = {
    init() { applyLinks(); },
    render() { applyLinks(); }
  };
})();
