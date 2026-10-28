/* Flowboard sign-in design preview. No identity provider is contacted. */
(function () {
  "use strict";

  const alert = document.querySelector("#signinAlert");
  const status = document.querySelector("#signinStatus");
  const button = document.querySelector("#googleSignIn");
  const messages = {
    "callback-error": "Google sign-in could not be completed. Try again.",
    expired: "Your session expired. Sign in again to continue.",
    denied: "This account does not have access. Ask the project owner or manager for an invitation."
  };

  const requestedState = new URLSearchParams(window.location.search).get("state");
  if (alert && Object.prototype.hasOwnProperty.call(messages, requestedState)) {
    alert.textContent = messages[requestedState];
    alert.hidden = false;
  }

  if (button && status) {
    button.addEventListener("click", function () {
      status.textContent = "Google sign-in is not connected in this design preview.";
      status.hidden = false;
    });
  }
})();
