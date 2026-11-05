# Flowboard in Claude: hosted UAT quickstart

**Deployed to UAT: dce1a67, 2026-11-04. Real Google/Claude acceptance is ready for you to test.** No Terminal, API token, client secret or local server is needed.

1. In Claude, open **Customize → Connectors → + Add → Add custom connector**. Name it **Flowboard UAT** and enter:

   `https://flowboard-app-uat.pages.dev/api/v1/mcp`

2. Choose **Sign in now**. Leave manually supplied client credentials and request headers empty. If Claude asks which OAuth client to use, choose **Register automatically**. Follow the browser to Google sign-in, select your Flowboard project and approve the requested access.
3. Start a new Claude chat and enable **only Flowboard UAT** for this test. Ask:

   > Use Flowboard UAT to show the boards and columns I can access in my approved project. Do not create anything yet.

4. Choose a test board and column from that result. Ask:

   > Create one card titled "Hosted connector UAT test" in board [board name], column [column name]. Ask me if the destination is unclear.

   Open the board in Flowboard and check that exactly one card appears. Then ask Claude to search for that exact title.
5. In Flowboard, open **Settings → Connections** and disconnect this connection. Ask Claude to call Flowboard UAT again. It must require reconnecting or return an authorization error. An answer repeated from chat memory does not test disconnection.

For Claude Team/Enterprise, the Claude organization owner adds the connector once; each colleague then connects using their own Flowboard account. Current Claude setup labels and organization requirements: [official custom connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

This release discovers projects/boards/columns, searches and creates cards. Current project membership, role and board access are checked on every call. You approve one project per connection; naming another project never grants access. Updating cards and company machine-to-machine credentials remain separate work.

## Copy a card prompt

Flowboard **Settings → Connections → Create a card from your AI app** includes a selectable template and a **Copy sample prompt** button. Hosted browser sign-in currently supports **Claude**. Use this prompt in another AI app only if it already has a working, supported Flowboard connection, such as the separate existing local integration; adding the hosted URL alone does not enable other AI apps. Connect Flowboard first, replace the bracketed details, and remove optional lines you do not need:

```text
Create exactly one card using my connected Flowboard project.

Project: [approved project name]
Board: [board name]
Column/status: [column name]
Title: [short card title]
Priority: High
Due date: [YYYY-MM-DD, or remove this line]
Assignment: [teammate name, or remove this line; I will assign them in Flowboard]
Description: [details, or remove this line]

First look up the boards and columns I can access. Ask me if the destination or title is missing or ambiguous; do not guess. Use the exact board and column IDs you find.
The connector cannot set assignees yet. Create the card unassigned and remind me to assign it in Flowboard if I requested an assignment. Do not claim it was assigned.
If creation times out or its outcome is unclear, reuse the same operation ID and unchanged input when retrying; do not create a second card.
```

**Required from you:** the title and an unambiguous board and column/status within your approved project. Include the project name to avoid confusion; the AI resolves the actual resource IDs and generates the retry identifier, so you do not need to find those yourself.

**Optional:** description, priority (`None`, `Low`, `Medium`, `High`, `Urgent`) and a real calendar due date in `YYYY-MM-DD` format. Omitted values mean an empty description, no priority and no due date. Dates have no time or timezone.

**Assignment needs a manual follow-up:** the current MCP create tool does not accept assignees. It creates an unassigned card; open that card in Flowboard and assign an eligible teammate. A name in the prompt or description is not an assignment and never grants access. This template also does not add comments, images or existing-card updates.

Report the step, approximate time and visible safe error if something fails. Do not share callback URLs, cookies, authorization codes or tokens. Use synthetic demo cards.

Deployment evidence: [release summary](reviews/HOSTED-MCP-20261104/release-dce1a67/SUMMARY.md). The older [local stdio setup](MCP_QUICKSTART.md) remains a developer alternative.
