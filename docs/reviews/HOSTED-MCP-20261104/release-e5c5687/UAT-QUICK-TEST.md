# Flowboard hosted connector: quick UAT test

**Prepared for candidate e5c5687. Wait for the Architect's deployment confirmation.** No Terminal, API token, client secret or local server is needed.

1. In Claude, open **Customize → Connectors → + Add → Add custom connector**. Name it **Flowboard UAT** and enter:

   `https://flowboard-app-uat.pages.dev/api/v1/mcp`

2. Choose **Sign in now**. Leave manually supplied client credentials and request headers empty. Automatic registration is supported. Follow the browser to Google sign-in, select your Flowboard project and approve the requested access.
3. Start a new Claude chat and enable **only Flowboard UAT** for this test. Ask:

   > Use Flowboard UAT to show the boards and columns I can access in my approved project. Do not create anything yet.

4. Choose a test board and column from that result. Ask:

   > Create one card titled "Hosted connector UAT test" in board [board name], column [column name]. Ask me if the destination is unclear.

   Open the board in Flowboard and check that exactly one card appears. Then ask Claude to search for that exact title.
5. In Flowboard, open **Settings → Connections** and disconnect this connection. Ask Claude to call Flowboard UAT again. It must require reconnecting or return an authorization error. An answer repeated from chat memory does not test disconnection.

For Claude Team/Enterprise, the Claude organization owner adds the connector once; each colleague then connects using their own Flowboard account. Current Claude setup labels and organization requirements: [official custom connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

This release discovers projects/boards/columns, searches and creates cards. Current project membership, role and board access are checked on every call. You approve one project per connection; naming another project never grants access. Updating cards and company machine-to-machine credentials remain separate work.

Report the step, approximate time and visible safe error if something fails. Do not share callback URLs, cookies, authorization codes or tokens. Use synthetic demo cards.
