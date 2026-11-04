# Flowboard in Claude — UAT test guide

**Prepared only. The new hosted browser-sign-in connector is NOT DEPLOYED yet.** Start these steps only after the Architect announces its reviewed UAT deployment. The existing local MCP connection remains a separate setup.

No Terminal commands or copied tokens are needed for this connector.

1. In Claude, open **Customize → Connectors**, then add a custom connector. Enter the name **Flowboard UAT** and this server URL:

   `https://flowboard-app-uat.pages.dev/api/v1/mcp`

2. Choose browser sign-in if Claude asks how to authenticate. Leave manually supplied OAuth client credentials empty; Flowboard supports automatic public-client registration. Connect and sign into Flowboard using Google.
3. Read the permission screen, choose the one project you want Claude to use, and approve. You can deny without granting access. A project choice never adds board access you do not already have.
4. In a new Claude chat, enable Flowboard and ask:

   > Show my Flowboard project, its boards and columns. Do not create anything yet.

5. Pick a test board and column, then ask:

   > Create one card titled “Hosted connector UAT test” in project [name], board [name], column [name]. Ask me if the destination is unclear.

6. Open that board in Flowboard, check the card, and ask Claude to search for its exact title. This first version supports project/board/column discovery, searching and creating cards. Updating an existing card and company machine-to-machine access are separate future work.
7. Open your personal **Connections** page in Flowboard and disconnect this connection. A later Claude request must require reconnecting or fail authorization. Signing out of the website alone does not disconnect continuing access.

**For a colleague on Claude Team or Enterprise:** an organization Owner must first add the custom connector in organization settings. Members then connect with their own Flowboard account. Labels can vary by Claude layout; [Claude’s current custom-connector guide](https://claude.com/docs/connectors/custom/add-unlisted) describes both layouts and organization access. [Authentication requirements](https://claude.com/docs/connectors/building/authentication) explain automatic registration and sign-in.

**Useful failure checks:** deny once, start a fresh connection and approve; try a board you cannot access and expect no card/data; disconnect and retry. Do not copy a callback URL, token, browser cookie or code into chat/screenshots. Report the step, time, visible safe error and board name instead.

**Access reminder:** use synthetic demo records. The consent screen explains whether offline access was requested; access lasts at most30days and can be disconnected earlier. Current project membership, board grants and role permissions are checked on every tool call.

This is a release-preparation guide, not evidence that a real Claude connection, Google login or refresh has passed on the future deployment.
