/* Adapt the shared demo portfolio identity to the standalone board shell. */
(function () {
  "use strict";
  const role = new URLSearchParams(location.search).get("role");
  if (role && FB.roleMeta[role]) FB.state.role = role;
  window.Screens = {
    get role() { return FB.state.role; },
    currentUser() { return FB.currentUser(); },
    can(action) { return FB.can(action === "editCard" ? "edit" : action); }
  };
})();
